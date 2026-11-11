import { AGENT_TASK_STATUSES, isAgentTaskStatus } from './agentTaskStatus';
import type { StatusReport } from './applyReport';

export type ParseReportResult = { ok: true; report: StatusReport } | { ok: false; reason: string };

/** Longest taskId accepted, in UTF-16 code units (String.length). */
export const MAX_TASK_ID_LENGTH = 200;
/** Longest optional fields accepted, in UTF-16 code units (String.length). */
export const MAX_TITLE_LENGTH = 200;
export const MAX_AGENT_LENGTH = 100;
export const MAX_NOTE_LENGTH = 500;

// The accepted ISO 8601 profile (the RFC 3339 one): full date, "T", time with
// seconds, optional fraction, and an explicit offset. A timestamp without an
// offset is rejected because it would mean "local time" of an unknown machine.
//   2026-11-01T10:05:00Z   2026-11-01T10:05:00.123+03:00
const ISO_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-](\d{2}):(\d{2}))$/;

/**
 * Turn raw JSON from the network into a StatusReport, or say why it is not one.
 * Never throws. Required: taskId, status, at. Optional: title (only with
 * status "queued"), agent, note; an optional field that is present must be a
 * non-blank string within its length limit (null is not "absent", it is
 * rejected). Any other field is ignored and not copied.
 * Reasons never echo the input values, so a hostile payload cannot flood logs.
 */
export function parseReport(input: unknown): ParseReportResult {
  try {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      return fail('report must be an object');
    }
    const { taskId, status, at, title, agent, note } = input as Record<string, unknown>;

    if (taskId === undefined) return fail('taskId is missing');
    const taskIdProblem = textProblem('taskId', taskId, MAX_TASK_ID_LENGTH);
    if (taskIdProblem !== undefined) return fail(taskIdProblem);

    if (status === undefined) return fail('status is missing');
    if (!isAgentTaskStatus(status)) {
      return fail(`status must be one of: ${AGENT_TASK_STATUSES.join(', ')}`);
    }

    if (at === undefined) return fail('at is missing');
    if (typeof at !== 'string') return fail('at must be a string');
    if (!isIsoTimestamp(at)) {
      return fail('at must be an ISO 8601 timestamp like 2026-11-01T10:05:00Z');
    }

    if (title !== undefined) {
      if (status !== 'queued') return fail('title is only allowed with status "queued"');
      const problem = textProblem('title', title, MAX_TITLE_LENGTH);
      if (problem !== undefined) return fail(problem);
    }
    if (agent !== undefined) {
      const problem = textProblem('agent', agent, MAX_AGENT_LENGTH);
      if (problem !== undefined) return fail(problem);
    }
    if (note !== undefined) {
      const problem = textProblem('note', note, MAX_NOTE_LENGTH);
      if (problem !== undefined) return fail(problem);
    }

    // Build a new object: only the known fields, never the input itself.
    // An absent optional field stays absent (no `title: undefined` key).
    // The casts are safe: textProblem returned undefined, so each is a string.
    const report: StatusReport = { taskId: taskId as string, status, at };
    if (title !== undefined) report.title = title as string;
    if (agent !== undefined) report.agent = agent as string;
    if (note !== undefined) report.note = note as string;
    return { ok: true, report };
  } catch {
    // A getter or Proxy on the input threw. JSON.parse never makes those,
    // but the parameter is `unknown`, so reject instead of throwing.
    return fail('report could not be read');
  }
}

/**
 * Why `value` is not an acceptable text field, or undefined if it is: a string,
 * not empty, at most `max` characters, not only whitespace. The value itself
 * is never trimmed: "  a " stays as sent.
 */
function textProblem(name: string, value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return `${name} must be a string`;
  if (value.length === 0) return `${name} must not be empty`;
  if (value.length > max) return `${name} must be at most ${max} characters`;
  // After the length check, so trim() never runs on an oversized string.
  if (value.trim().length === 0) return `${name} must not be only whitespace`;
  return undefined;
}

function fail(reason: string): ParseReportResult {
  return { ok: false, reason };
}

function isIsoTimestamp(value: string): boolean {
  const match = ISO_TIMESTAMP.exec(value);
  if (match === null) return false;
  const [, year, month, day, hour, minute, second, offsetHour, offsetMinute] = match.map(Number);

  // Date.parse alone is not enough: it accepts 2026-02-30 (as March 2) and 24:00.
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > daysInMonth(year, month)) return false;
  // No leap second (:60): a JavaScript Date cannot represent it.
  if (hour > 23 || minute > 59 || second > 59) return false;
  // offsetHour is NaN for "Z"; NaN > 23 is false, so "Z" passes.
  if (offsetHour > 23 || offsetMinute > 59) return false;

  // Final guard: applyReport compares instants with Date.parse, so whatever
  // passes here must be something Date.parse understands.
  return Number.isFinite(Date.parse(value));
}

// Plain arithmetic, not Date.UTC: Date.UTC maps years 0-99 to 1900-1999.
function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}
