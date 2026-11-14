// Request bodies of the Conductor endpoints. Never throw; reasons never echo
// the input (it can be a prompt).
import { parseNewTask } from '@opsaip/core';

/**
 * Longest prompt or follow-up, in UTF-16 code units (String.length). 12 000
 * ASCII characters fit in the 16 KB body limit with room for the title and
 * the JSON around them; text with many non-ASCII characters takes up to 3
 * bytes each and hits the body limit (413) first.
 */
export const MAX_PROMPT_CHARS = 12_000;

export type Parsed<T> = { ok: true; value: T } | { ok: false; reason: string };

/**
 * POST /v1/runs: { "title": "...", "prompt": "..." }.
 * title: the parseNewTask rules (1 to 200 characters, not only whitespace,
 * stored trimmed). prompt: 1 to MAX_PROMPT_CHARS characters, not only
 * whitespace, kept as sent. Other fields are ignored.
 */
export function parseNewRun(input: unknown): Parsed<{ title: string; prompt: string }> {
  try {
    if (!isObject(input)) return fail('run must be an object');
    const { title, prompt } = input;
    // Only the title goes to parseNewTask: a run's agent is chosen by the server.
    const task = parseNewTask({ title });
    if (!task.ok) return fail(task.reason);
    const problem = textProblem('prompt', prompt);
    if (problem !== undefined) return fail(problem);
    return { ok: true, value: { title: task.task.title, prompt: prompt as string } };
  } catch {
    return fail('run could not be read');
  }
}

/** POST /v1/runs/:id/permission: { "allow": true|false, "permissionId": "..." }. */
export function parsePermissionAnswer(input: unknown): Parsed<{ allow: boolean; permissionId: string }> {
  try {
    if (!isObject(input)) return fail('answer must be an object');
    const { allow, permissionId } = input;
    if (typeof allow !== 'boolean') return fail('allow must be true or false');
    if (typeof permissionId !== 'string' || permissionId.length === 0 || permissionId.length > 100) {
      return fail('permissionId must be a string of 1 to 100 characters');
    }
    return { ok: true, value: { allow, permissionId } };
  } catch {
    return fail('answer could not be read');
  }
}

/** POST /v1/runs/:id/message: { "text": "..." }, the prompt rules. */
export function parseFollowUp(input: unknown): Parsed<{ text: string }> {
  try {
    if (!isObject(input)) return fail('message must be an object');
    const problem = textProblem('text', input.text);
    if (problem !== undefined) return fail(problem);
    return { ok: true, value: { text: input.text as string } };
  } catch {
    return fail('message could not be read');
  }
}

function textProblem(name: string, value: unknown): string | undefined {
  if (value === undefined) return `${name} is missing`;
  if (typeof value !== 'string') return `${name} must be a string`;
  if (value.length === 0) return `${name} must not be empty`;
  if (value.length > MAX_PROMPT_CHARS) return `${name} must be at most ${MAX_PROMPT_CHARS} characters`;
  if (value.trim().length === 0) return `${name} must not be only whitespace`;
  return undefined;
}

function isObject(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

function fail<T>(reason: string): Parsed<T> {
  return { ok: false, reason };
}
