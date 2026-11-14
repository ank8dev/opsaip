// Turn the model's JSON reply into what POST /v1/ask returns. Pure: no I/O,
// no logging. The model's output is untrusted. This file only checks and
// reshapes it; nothing here (or anywhere on the server) executes an action.
// The browser shows it as a proposal, and its Approve button calls
// POST /v1/runs or POST /v1/tasks, which validate again.
import { parseNewTask } from '@opsaip/core';
import { parseNewRun } from './auth/conductor/parseRun';

export type AskAction =
  | { type: 'run'; agent: 'claude-code'; title: string; prompt: string }
  | { type: 'task'; title: string };

export interface AskResult {
  answer: string;
  action: AskAction | null;
}

/** Shown when the model proposes a run for an agent other than Claude Code. */
export const ONLY_CLAUDE_CODE = 'Only Claude Code is available in v0.1.';

/**
 * The Gemini responseSchema for the model's reply (OpenAPI subset;
 * nullable via `nullable: true`).
 */
export const ASK_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    answer: { type: 'STRING' },
    action: {
      type: 'OBJECT',
      nullable: true,
      properties: {
        type: { type: 'STRING', enum: ['run', 'task'] },
        title: { type: 'STRING' },
        prompt: { type: 'STRING' },
        agent: { type: 'STRING' },
      },
      required: ['type', 'title'],
    },
  },
  required: ['answer', 'action'],
} as const;

/**
 * Read the model's text. Strict: a reply that is not a JSON object with a
 * non-empty string "answer" falls back to plain text (the raw text is the
 * answer, no action). An invalid action keeps the answer and drops the
 * action. Unknown fields are dropped. The answer is trimmed and cut at
 * `maxAnswerChars` code points.
 */
export function parseModelReply(raw: string, maxAnswerChars: number): AskResult {
  const parsed = parseJsonObject(raw);
  const answerField = parsed?.answer;
  if (parsed === undefined || typeof answerField !== 'string' || answerField.trim() === '') {
    return { answer: truncate(raw.trim(), maxAnswerChars), action: null };
  }

  const action = readAction(parsed.action);
  if (action.kind === 'wrong-agent') return { answer: ONLY_CLAUDE_CODE, action: null };
  return { answer: truncate(answerField.trim(), maxAnswerChars), action: action.value };
}

type ReadAction = { kind: 'ok'; value: AskAction | null } | { kind: 'wrong-agent' };

function readAction(input: unknown): ReadAction {
  const none: ReadAction = { kind: 'ok', value: null };
  try {
    if (!isObject(input)) return none;
    const { type, title, prompt, agent } = input;

    if (type === 'task') {
      const task = parseNewTask({ title });
      return task.ok ? { kind: 'ok', value: { type: 'task', title: task.task.title } } : none;
    }

    if (type === 'run') {
      if (agent !== undefined && agent !== null) {
        if (typeof agent !== 'string' || normalizeAgent(agent) !== 'claude-code') {
          return { kind: 'wrong-agent' };
        }
      }
      // The same validation as POST /v1/runs, so the limits cannot drift.
      const run = parseNewRun({ title, prompt });
      if (!run.ok) return none;
      return {
        kind: 'ok',
        value: { type: 'run', agent: 'claude-code', title: run.value.title, prompt: run.value.prompt },
      };
    }
    return none;
  } catch {
    return none;
  }
}

/** "Claude Code", "claude_code", " CLAUDE-CODE " -> "claude-code". */
function normalizeAgent(agent: string): string {
  return agent.trim().toLowerCase().replace(/[\s_]+/g, '-');
}

function parseJsonObject(raw: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(raw);
    return isObject(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function truncate(text: string, max: number): string {
  const points = Array.from(text);
  return points.length > max ? `${points.slice(0, max).join('')}…` : text;
}
