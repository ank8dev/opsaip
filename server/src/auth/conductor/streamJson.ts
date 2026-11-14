// Claude Code's stream-json protocol (claude -p --input-format stream-json
// --output-format stream-json --verbose): one JSON object per line, both ways.
// Shapes from the Agent SDK reference (SDKUserMessage, SDKAssistantMessage,
// SDKResultMessage, SDKSystemMessage):
// https://code.claude.com/docs/en/agent-sdk/typescript
//
// Only what Conductor mode needs is read. The parser never throws: unknown
// event types, unknown fields and malformed lines are ignored, so a newer
// Claude Code or a garbled line can never crash the server.

/** Longest line kept from the agent, in characters. A longer line is dropped whole. */
export const MAX_AGENT_LINE_CHARS = 8 * 1024 * 1024;

/** What one line of the agent's output means to a run. */
export type AgentLine =
  /** {"type":"system","subtype":"init",...}: the session is up. */
  | { kind: 'init' }
  /** {"type":"assistant","message":{"content":[{"type":"text","text":"..."}]}}: the agent's text. */
  | { kind: 'message'; text: string }
  /**
   * {"type":"result","subtype":"success"|"error_...","is_error":bool,"result"?:"..."}:
   * the end of a turn. ok only for subtype "success" with is_error not true.
   */
  | { kind: 'result'; ok: boolean; text?: string };

/**
 * The meaning of one output line, or undefined for anything else: not JSON,
 * not an object, an event type Opsaip does not use (user/tool results,
 * stream_event, other system subtypes...), an assistant message without text,
 * or a message from a subagent (parent_tool_use_id set).
 */
export function parseAgentLine(line: string): AgentLine | undefined {
  let event: unknown;
  try {
    event = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (typeof event !== 'object' || event === null || Array.isArray(event)) return undefined;
  const { type, subtype } = event as Record<string, unknown>;

  if (type === 'system' && subtype === 'init') return { kind: 'init' };

  if (type === 'assistant') {
    const { message, parent_tool_use_id: parent } = event as Record<string, unknown>;
    if (parent !== undefined && parent !== null) return undefined;
    const content = (message as { content?: unknown } | null | undefined)?.content;
    if (!Array.isArray(content)) return undefined;
    const text = content
      .filter((block): block is { type: 'text'; text: string } =>
        typeof block === 'object' && block !== null && block.type === 'text' && typeof block.text === 'string',
      )
      .map((block) => block.text)
      .join('\n')
      .trim();
    return text === '' ? undefined : { kind: 'message', text };
  }

  if (type === 'result') {
    const { is_error: isError, result } = event as Record<string, unknown>;
    const ok = subtype === 'success' && isError !== true;
    return typeof result === 'string' && result.trim() !== ''
      ? { kind: 'result', ok, text: result.trim() }
      : { kind: 'result', ok };
  }

  return undefined;
}

/** One stdin line that sends `text` to the agent as the user (SDKUserMessage). */
export function userMessageLine(text: string): string {
  return `${JSON.stringify({
    type: 'user',
    message: { role: 'user', content: text },
    parent_tool_use_id: null,
  })}\n`;
}

/**
 * Split a text stream into lines. Each complete line goes to onLine; a line
 * longer than `maxChars` is not kept in memory: it is dropped whole and
 * onDropped is called once for it. Feed it decoded text (setEncoding('utf8')
 * on the stream, so a character split across chunks stays whole).
 */
export function createLineSplitter(
  onLine: (line: string) => void,
  onDropped: () => void = () => {},
  maxChars: number = MAX_AGENT_LINE_CHARS,
): { push(chunk: string): void } {
  let buffer = '';
  let dropping = false;
  return {
    push(chunk) {
      let text = chunk;
      for (;;) {
        const end = text.indexOf('\n');
        if (end === -1) {
          if (!dropping) {
            buffer += text;
            if (buffer.length > maxChars) {
              buffer = '';
              dropping = true;
              onDropped();
            }
          }
          return;
        }
        const piece = text.slice(0, end);
        text = text.slice(end + 1);
        if (dropping) {
          dropping = false;
          continue;
        }
        const line = buffer + piece;
        buffer = '';
        if (line.length > maxChars) onDropped();
        else if (line.trim() !== '') onLine(line);
      }
    },
  };
}
