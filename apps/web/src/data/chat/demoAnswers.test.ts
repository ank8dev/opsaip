import { describe, expect, it } from 'vitest';
import { mockWorkspace } from '../../mocks';
import { peopleById } from '../selectors';
import type { Person, Task, TaskStatus } from '../../types';
import {
  CHIPS, DEMO_SOURCE, LIVE_CHIPS, MAX_ROWS, UNKNOWN_QUESTION, decideProposal, demoAnswer, matchQuestion, type AnswerContext,
} from './demoAnswers';
import type { AgentWidget, BriefWidget, NeedsWidget, ProposalWidget, TaskListWidget, TextWidget } from './types';

const demo: AnswerContext = { tasks: mockWorkspace.activity, people: peopleById(mockWorkspace.team) };
const count = (tasks: readonly Task[], s: TaskStatus) => tasks.filter((t) => t.status === s).length;
const titles = (tasks: readonly Task[]) => new Set(tasks.map((t) => t.task));

/** Freeze deeply, so an answer that mutates its input throws. */
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function task(id: string, status: TaskStatus, extra: Partial<Task> = {}): Task {
  return { id, task: `Task ${id}`, tool: '', status, owner: '', source: '', detail: '', ...extra };
}

describe('chips', () => {
  it('has the five suggestions; Live keeps the questions and drops Rename', () => {
    expect(CHIPS.map((c) => c.label)).toEqual([
      'Brief me', 'What needs me?', 'What’s not done?', 'What is claude-code doing?', 'Rename a task',
    ]);
    expect(LIVE_CHIPS.map((c) => c.id)).toEqual(['brief', 'needs', 'open']);
  });

  it('every chip answers from the demo data, with the demo source line', () => {
    for (const chip of CHIPS) {
      const w = demoAnswer(chip.label, demo);
      expect(w.kind).not.toBe('text');
      expect(w.source).toBe(DEMO_SOURCE);
    }
  });
});

describe('Brief me', () => {
  const w = demoAnswer('Brief me', demo) as BriefWidget;

  it('counts every status from the data', () => {
    expect(w.kind).toBe('brief');
    expect(w.total).toBe(mockWorkspace.activity.length);
    for (const s of ['Needs you', 'Working', 'Failed', 'Queued', 'Done'] as const) {
      expect(w.counts.find((c) => c.status === s)?.count ?? 0).toBe(count(mockWorkspace.activity, s));
    }
    expect(w.counts.reduce((n, c) => n + c.count, 0)).toBe(w.total);
  });

  it('starts with the most important task that needs you: the highest priority, then the longest wait', () => {
    const needs = mockWorkspace.activity.filter((t) => t.status === 'Needs you' && t.priority === 'Urgent');
    const oldest = [...needs].sort((a, b) => String(a.since).localeCompare(String(b.since)))[0];
    expect(w.next?.id).toBe(oldest.id);
    expect(w.next?.title).toBe(oldest.task);
    expect(w.next?.owner).toBe(demo.people[oldest.owner].name);
  });

  it('follows the data: other tasks, other numbers and names', () => {
    const tasks = [task('a', 'Working'), task('b', 'Done'), task('c', 'Done'), task('d', 'Failed', { priority: 'Low' })];
    const b = demoAnswer('brief me', { tasks, people: {} }) as BriefWidget;
    expect(b.total).toBe(4);
    expect(b.counts).toEqual([
      { status: 'Working', count: 1 }, { status: 'Failed', count: 1 }, { status: 'Done', count: 2 },
    ]);
    expect(b.next?.id).toBe('d'); // nothing needs you, so the failed one
  });

  it('with no needs-you and no failed task there is nothing to start with', () => {
    expect((demoAnswer('Brief me', { tasks: [task('a', 'Working')], people: {} }) as BriefWidget).next).toBeNull();
  });

  it('says so when there are no tasks', () => {
    expect(demoAnswer('Brief me', { tasks: [], people: {} })).toMatchObject({ kind: 'text', text: 'I do not see any tasks yet.' });
  });
});

describe('What needs me?', () => {
  const w = demoAnswer('What needs me?', demo) as NeedsWidget;
  const needs = mockWorkspace.activity.filter((t) => t.status === 'Needs you');

  it('lists the Needs you tasks with the agent note, most important first', () => {
    expect(w.kind).toBe('needs');
    expect(w.tasks.length + w.more).toBe(needs.length);
    for (const row of w.tasks) {
      const src = needs.find((t) => t.id === row.id)!;
      expect(row).toMatchObject({ title: src.task, agent: src.source, detail: src.detail, status: 'Needs you' });
    }
    expect(w.tasks[0].priority).toBe('Urgent');
    expect(w.tasks.map((r) => r.priority)).toEqual([...w.tasks.map((r) => r.priority)].sort(
      (a, b) => ['Urgent', 'High', 'Normal', 'Low'].indexOf(a!) - ['Urgent', 'High', 'Normal', 'Low'].indexOf(b!),
    ));
  });

  it('only names tasks and people that exist in the data', () => {
    const known = titles(mockWorkspace.activity);
    const people = new Set(mockWorkspace.team.map((p) => p.name));
    for (const row of w.tasks) {
      expect(known.has(row.title)).toBe(true);
      expect(people.has(row.owner)).toBe(true);
    }
  });

  it('shows at most MAX_ROWS and counts the rest', () => {
    const many = Array.from({ length: MAX_ROWS + 3 }, (_, i) => task(`n${String(i).padStart(2, '0')}`, 'Needs you'));
    const m = demoAnswer('What needs me?', { tasks: many, people: {} }) as NeedsWidget;
    expect(m.tasks).toHaveLength(MAX_ROWS);
    expect(m.more).toBe(3);
  });

  it('says plainly when nothing needs you', () => {
    expect(demoAnswer('What needs me?', { tasks: [task('a', 'Working')], people: {} })).toMatchObject({
      kind: 'text', text: 'Nothing needs you right now.',
    });
  });

  it('shows tasks you started as "You"', () => {
    const mine = task('local-1', 'Needs you', { owner: 'me' });
    expect((demoAnswer('What needs me?', { tasks: [mine], people: {} }) as NeedsWidget).tasks[0].owner).toBe('You');
  });
});

describe('What’s not done?', () => {
  const w = demoAnswer('What’s not done?', demo) as TaskListWidget;
  const open = mockWorkspace.activity.filter((t) => t.status !== 'Done');

  it('counts and lists every task that is not Done, by status', () => {
    expect(w.kind).toBe('tasks');
    expect(w.title).toBe(`${open.length} tasks are not done`);
    expect(w.tasks.length + w.more).toBe(open.length);
    expect(w.tasks.some((t) => t.status === 'Done')).toBe(false);
    expect(w.tasks.every((t) => titles(open).has(t.title))).toBe(true);
    // Needs you first, as in the sidebar
    expect(w.tasks[0].status).toBe('Needs you');
  });

  it('accepts a plain apostrophe and no question mark', () => {
    expect(demoAnswer("what's not done", demo)).toEqual(w);
  });

  it('uses the singular for one task, and says when all is done', () => {
    expect((demoAnswer("What's not done?", { tasks: [task('a', 'Queued'), task('b', 'Done')], people: {} }) as TaskListWidget).title).toBe('1 task is not done');
    expect(demoAnswer("What's not done?", { tasks: [task('b', 'Done')], people: {} })).toMatchObject({ text: 'Everything is done.' });
  });
});

describe('What is claude-code doing?', () => {
  const w = demoAnswer('What is claude-code doing?', demo) as AgentWidget;
  const mine = mockWorkspace.activity.filter((t) => t.source === 'Claude Code');
  const working = mine.filter((t) => t.status === 'Working');

  it('finds the agent in the data, whatever the spelling', () => {
    expect(w.kind).toBe('agent');
    expect(w.agent).toBe('Claude Code');
    expect(demoAnswer('what is claude code doing', demo)).toEqual(w);
    expect(demoAnswer("What's Claude Code doing?", demo)).toEqual(w);
  });

  it('shows its latest working task, how many others it is on, and its counts', () => {
    const latest = [...working].sort((a, b) => Date.parse(b.since!) - Date.parse(a.since!))[0];
    expect(w.current?.id).toBe(latest.id);
    expect(w.alsoWorking).toBe(working.length - 1);
    expect(w.counts.reduce((n, c) => n + c.count, 0)).toBe(mine.length);
    for (const c of w.counts) expect(c.count).toBe(count(mine, c.status));
  });

  it('its last report is the note of its most recently updated task', () => {
    const latest = [...mine].sort((a, b) => Date.parse(b.since!) - Date.parse(a.since!))[0];
    expect(w.last).toMatchObject({ id: latest.id, detail: latest.detail });
  });

  it('works for another agent, and with no working task shows only the last report', () => {
    const codex = demoAnswer('What is Codex doing?', demo) as AgentWidget;
    expect(codex.agent).toBe('Codex');
    const idle = demoAnswer('What is Codex doing?', { tasks: [task('a', 'Done', { source: 'Codex', detail: 'Merged' })], people: {} }) as AgentWidget;
    expect(idle.current).toBeNull();
    expect(idle.last?.detail).toBe('Merged');
  });

  it('does not invent an agent that is not in the data', () => {
    const r = demoAnswer('What is gemini doing?', demo) as TextWidget;
    expect(r.kind).toBe('text');
    expect(r.text).toContain('gemini');
    expect(r.text).toMatch(/do not see an agent/);
    // the claude-code chip on data without that agent
    expect(demoAnswer('What is claude-code doing?', { tasks: [task('a', 'Working', { source: 'Codex' })], people: {} })).toMatchObject({ kind: 'text' });
  });

  it('treats the agent name as text only', () => {
    const r = demoAnswer('What is <b>x</b> doing?', demo) as TextWidget;
    expect(r.text).toContain('<b>x</b>'); // kept literally; the UI renders it as a text node
  });
});

describe('Rename a task', () => {
  const w = demoAnswer('Rename a task', demo) as ProposalWidget;

  it('proposes, from the data, a title for the most important task that is not done', () => {
    expect(w.kind).toBe('proposal');
    expect(w.status).toBe('pending');
    const src = mockWorkspace.activity.find((t) => t.id === w.taskId)!;
    expect(src.status).not.toBe('Done');
    expect(w.before).toBe(src.task);
    expect(w.after).toBe(`[${src.priority}] ${src.task}`);
    expect(w.after).not.toBe(w.before);
    expect(src.priority).toBe('Urgent');
  });

  it('is deterministic, whatever the order of the input', () => {
    expect(demoAnswer('Rename a task', demo)).toEqual(w);
    const shuffled = { ...demo, tasks: [...demo.tasks].reverse() };
    expect(demoAnswer('Rename a task', shuffled)).toEqual(w);
  });

  it('does not change anything: the tasks are untouched', () => {
    const tasks = freeze(mockWorkspace.activity.map((t) => ({ ...t })));
    const before = JSON.stringify(tasks);
    demoAnswer('Rename a task', { tasks, people: demo.people });
    expect(JSON.stringify(tasks)).toBe(before);
  });

  it('after a task has its priority in the title, the next one is proposed', () => {
    const renamed = demo.tasks.map((t) => (t.id === w.taskId ? { ...t, task: w.after } : t));
    const next = demoAnswer('Rename a task', { ...demo, tasks: renamed }) as ProposalWidget;
    expect(next.taskId).not.toBe(w.taskId);
  });

  it('skips Done tasks and tasks without a priority; says so when none is left', () => {
    expect(demoAnswer('Rename a task', { tasks: [task('a', 'Done', { priority: 'High' }), task('b', 'Working')], people: {} })).toMatchObject({ kind: 'text' });
    const p = demoAnswer('Rename a task', { tasks: [task('a', 'Working', { priority: 'Low' })], people: {} }) as ProposalWidget;
    expect(p.after).toBe('[Low] Task a');
  });
});

describe('decideProposal', () => {
  const proposal = demoAnswer('Rename a task', demo) as ProposalWidget;
  const current = demo.tasks.find((t) => t.id === proposal.taskId)!;

  it('approve returns the patch; the task itself is not mutated', () => {
    const frozen = freeze({ ...current });
    const r = decideProposal(proposal, frozen, 'approve');
    expect(r.status).toBe('approved');
    expect(r.patch).toEqual({ task: proposal.after, since: current.since });
    expect(frozen.task).toBe(proposal.before);
  });

  it('cancel changes nothing', () => {
    expect(decideProposal(proposal, current, 'cancel')).toEqual({ status: 'cancelled', patch: null });
  });

  it('computing the proposal changes nothing either: no patch exists before a decision', () => {
    expect(proposal.status).toBe('pending');
    expect(current.task).toBe(proposal.before);
  });

  it('approve is stale if the title changed meanwhile, or the task is gone', () => {
    expect(decideProposal(proposal, { ...current, task: 'Something else' }, 'approve')).toEqual({ status: 'stale', patch: null });
    expect(decideProposal(proposal, null, 'approve')).toEqual({ status: 'stale', patch: null });
  });

  it('a decided proposal never decides again', () => {
    expect(decideProposal({ ...proposal, status: 'cancelled' }, current, 'approve')).toEqual({ status: 'cancelled', patch: null });
    expect(decideProposal({ ...proposal, status: 'approved' }, current, 'cancel')).toEqual({ status: 'approved', patch: null });
  });

  it('keeps no since when the task had none', () => {
    const t = task('x', 'Working', { priority: 'Low' });
    const p = demoAnswer('Rename a task', { tasks: [t], people: {} }) as ProposalWidget;
    expect(decideProposal(p, t, 'approve').patch).toEqual({ task: '[Low] Task x' });
  });
});

describe('any other question', () => {
  it.each(['How is the weather?', 'Delete everything', '', '   ', 'brief', 'What is doing?'])('%j gets the honest reply', (q) => {
    expect(demoAnswer(q, demo)).toEqual({ kind: 'text', text: UNKNOWN_QUESTION, source: DEMO_SOURCE });
  });

  it('the reply says what Opsy understands', () => {
    expect(UNKNOWN_QUESTION).toBe('In the demo I only understand the suggestions below.');
  });

  it('matchQuestion reads chip text in any case, with or without the question mark', () => {
    expect(matchQuestion('  BRIEF ME?? ')).toEqual({ kind: 'chip', id: 'brief' });
    expect(matchQuestion('rename a task.')).toEqual({ kind: 'chip', id: 'rename' });
    expect(matchQuestion('hello')).toBeNull();
  });
});

describe('people without a match', () => {
  it('an owner that is not in people shows no name, never a made-up one', () => {
    const people: Readonly<Record<string, Person>> = {};
    const r = demoAnswer('What needs me?', { tasks: [task('a', 'Needs you', { owner: 'ghost' })], people }) as NeedsWidget;
    expect(r.tasks[0].owner).toBe('');
  });
});

describe('the shared "needs you" rule', () => {
  const ctx: AnswerContext = {
    tasks: [task('a', 'Needs you'), task('b', 'Working'), task('c', 'Working'), task('d', 'Failed')],
    people: {},
    pendingPermissionTaskIds: ['b'],
  };

  it('the Brief counts a task with a pending permission request as needing you', () => {
    const w = demoAnswer('Brief me', ctx) as BriefWidget;
    expect(w.counts).toEqual([
      { status: 'Needs you', count: 2 },
      { status: 'Working', count: 1 },
      { status: 'Failed', count: 1 },
    ]);
  });

  it('What needs me? lists the same two tasks', () => {
    const w = demoAnswer('What needs me?', ctx) as NeedsWidget;
    expect(w.tasks.map((t) => t.id).sort()).toEqual(['a', 'b']);
  });

  it('What’s not done? counts it once, not as Needs you and Working', () => {
    const w = demoAnswer('What’s not done?', ctx) as TaskListWidget;
    expect(w.tasks.filter((t) => t.id === 'b')).toHaveLength(1);
    expect(w.tasks.find((t) => t.id === 'b')?.status).toBe('Needs you');
  });

  it('does not change the tasks it was given', () => {
    const frozen = freeze({ ...ctx, tasks: ctx.tasks.map((t) => ({ ...t })) });
    expect(() => demoAnswer('Brief me', frozen)).not.toThrow();
  });
});
