import { MAX_AGENT_LENGTH, MAX_TITLE_LENGTH, textProblem } from './parseReport';

/** What a person sends to create a task. The server adds the id, the time and the source. */
export interface NewTask {
  /** Trimmed, 1 to MAX_TITLE_LENGTH characters. */
  title: string;
  /** 1 to MAX_AGENT_LENGTH characters, as sent. Absent if not given. */
  agent?: string;
}

export type ParseNewTaskResult = { ok: true; task: NewTask } | { ok: false; reason: string };

/**
 * Turn raw JSON from the network (the body of POST /v1/tasks) into a NewTask,
 * or say why it is not one. Never throws.
 *
 * Required: title, a string with 1 to MAX_TITLE_LENGTH characters, not only
 * whitespace. It is stored trimmed: "  Fix login " becomes "Fix login". The
 * limit is checked on the text as sent, like parseReport does, so an
 * oversized string is never trimmed.
 * Optional: agent, a non-blank string of 1 to MAX_AGENT_LENGTH characters,
 * kept as sent (the same rule as in parseReport); null is not "absent", it
 * is rejected.
 *
 * Lengths count UTF-16 code units (String.length), exactly like parseReport.
 *
 * Any other field is ignored and not copied, the same as in parseReport.
 * That includes id, status, updatedAt and source: a client cannot choose
 * them, the server does. (Rejecting unknown fields would break older clients
 * the day a field is added; ignoring them is the rule everywhere in v0.)
 * Reasons never echo the input values.
 */
export function parseNewTask(input: unknown): ParseNewTaskResult {
  try {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      return fail('task must be an object');
    }
    const { title, agent } = input as Record<string, unknown>;

    if (title === undefined) return fail('title is missing');
    const titleProblem = textProblem('title', title, MAX_TITLE_LENGTH);
    if (titleProblem !== undefined) return fail(titleProblem);

    if (agent !== undefined) {
      const problem = textProblem('agent', agent, MAX_AGENT_LENGTH);
      if (problem !== undefined) return fail(problem);
    }

    // The casts are safe: textProblem returned undefined, so each is a string.
    const task: NewTask = { title: (title as string).trim() };
    if (agent !== undefined) task.agent = agent as string;
    return { ok: true, task };
  } catch {
    // A getter or Proxy on the input threw. JSON.parse never makes those,
    // but the parameter is `unknown`, so reject instead of throwing.
    return fail('task could not be read');
  }
}

function fail(reason: string): ParseNewTaskResult {
  return { ok: false, reason };
}
