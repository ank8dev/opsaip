// Short human text for what an agent wants to do, shown in Opsaip while a
// permission request waits for the person. Plain text: clients must show it
// as text, never as HTML (it comes from the agent).

/** Longest permission summary, in UTF-16 code units (String.length). */
export const MAX_SUMMARY_CHARS = 300;
/** Longest tool name shown, in UTF-16 code units (String.length). */
export const MAX_TOOL_CHARS = 100;

/**
 * What the tool call would do, in one line of at most MAX_SUMMARY_CHARS:
 * the command for Bash, the path for file tools, the URL or query for web
 * tools, the questions for AskUserQuestion, else the input as compact JSON.
 * Never throws.
 */
export function summarizeToolCall(tool: string, input: unknown): string {
  const fields = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
  const pick = (...names: string[]): string | undefined => {
    for (const name of names) {
      const value = fields[name];
      if (typeof value === 'string' && value.trim() !== '') return value;
    }
    return undefined;
  };
  let text: string | undefined;
  switch (tool) {
    case 'Bash':
      text = pick('command');
      break;
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      text = pick('file_path', 'notebook_path');
      break;
    case 'WebFetch':
      text = pick('url');
      break;
    case 'WebSearch':
      text = pick('query');
      break;
    case 'AskUserQuestion': {
      // A clarifying question: { questions: [{ question, options, ... }] }. Show the questions.
      const questions = Array.isArray(fields.questions) ? fields.questions : [];
      const asked = questions
        .map((entry: unknown) => (entry as { question?: unknown } | null)?.question)
        .filter((question): question is string => typeof question === 'string' && question.trim() !== '');
      text = asked.length > 0 ? asked.join(' / ') : undefined;
      break;
    }
    default:
      text = undefined;
  }
  if (text === undefined) {
    try {
      text = JSON.stringify(input) ?? '';
    } catch {
      text = '';
    }
  }
  return truncate(oneLine(text), MAX_SUMMARY_CHARS);
}

/**
 * Longest full request (describeToolCall) the person can be shown, counted
 * as JSON-encoded characters: a saved chat card holds it, and the server
 * takes a card of at most 20 000 characters (chatStore.ts MAX_WIDGET_CHARS).
 * A longer request is denied, never shown in part: Allow would approve text
 * the person could not see.
 */
export const MAX_DETAIL_JSON_CHARS = 10_000;

/** Bash input fields that do not change what runs: with only these, the command alone is the whole request. */
const BASH_SHOWN_FIELDS = new Set(['command', 'description', 'timeout']);

/**
 * Everything a tool call would do, for the person to read before Allow:
 * Allow approves exactly this input. For Bash, the command as it will run
 * (newlines kept), when the input holds nothing else that matters; for
 * everything else, the whole input as indented JSON. Never cut. Never throws.
 */
export function describeToolCall(tool: string, input: unknown): string {
  if (tool === 'Bash' && typeof input === 'object' && input !== null) {
    const fields = input as Record<string, unknown>;
    if (typeof fields.command === 'string' && Object.keys(fields).every((name) => BASH_SHOWN_FIELDS.has(name))) {
      return fields.command;
    }
  }
  try {
    return JSON.stringify(input, null, 2) ?? '';
  } catch {
    return '';
  }
}

/** The text with every run of whitespace (newlines included) as one space, trimmed. */
export function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * At most `max` characters, counted like core counts them (UTF-16 code units,
 * String.length), so a truncated note always passes core's length check.
 * Cut with "…" at the end when longer, never inside a surrogate pair.
 */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  let cut = max - 1;
  const last = text.charCodeAt(cut - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut -= 1; // a high surrogate: keep the pair whole
  return `${text.slice(0, cut)}…`;
}
