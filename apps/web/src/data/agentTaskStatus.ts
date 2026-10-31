// The lifecycle of one agent task, as the agent reports it. Machine values
// (snake_case), not UI labels. Pure: no React, so it can move to the server.

export type AgentTaskStatus = 'queued' | 'running' | 'waiting_on_human' | 'done' | 'failed';

/** For each status, the statuses a task may move to next. Anything not listed is forbidden. */
const NEXT: Record<AgentTaskStatus, readonly AgentTaskStatus[]> = {
  // An agent picked the task up and started work.
  queued: ['running'],
  // From running, the agent either needs a person, finishes, or gives up.
  running: ['waiting_on_human', 'done', 'failed'],
  // A person answered, so work resumes; or the wait ends without an answer
  // (timeout, canceled) and the task fails instead of hanging forever.
  waiting_on_human: ['running', 'failed'],
  // Done is final: finished work is never reopened. New work is a new task.
  done: [],
  // Retry: a failed task goes back in line rather than straight to running,
  // so it waits for a free agent like any other task.
  failed: ['queued'],
};

export function canTransition(from: AgentTaskStatus, to: AgentTaskStatus): boolean {
  return NEXT[from].includes(to);
}
