import { describe, expect, it } from 'vitest';
import type { Task, TaskStatus } from '../../types';
import { LIVE_CHIPS } from './demoAnswers';
import { LIVE_SOURCE, isLiveChip, liveChipAnswer } from './liveAnswers';
import type { BriefWidget, NeedsWidget, TaskListWidget, TextWidget } from './types';

function task(id: string, status: TaskStatus, extra: Partial<Task> = {}): Task {
  return { id, task: `Task ${id}`, tool: '', status, owner: '', source: 'Claude Code', detail: '', ...extra };
}
const tasks = [task('a', 'Needs you'), task('b', 'Working'), task('c', 'Failed'), task('d', 'Done'), task('e', 'Queued')];
const ctx = { tasks, people: {} };

describe('Live suggestions', () => {
  it('are exactly Brief me, What needs me? and What’s not done?', () => {
    expect(LIVE_CHIPS.map((c) => c.label)).toEqual(['Brief me', 'What needs me?', 'What’s not done?']);
  });

  it('answer Brief me from the server tasks, with the live source', () => {
    const w = liveChipAnswer('Brief me', ctx) as BriefWidget;
    expect(w.kind).toBe('brief');
    expect(w.total).toBe(5);
    expect(w.source).toBe(LIVE_SOURCE);
    expect(w.next?.id).toBe('a');
  });

  it('answer What needs me? with the waiting tasks, and count a pending permission', () => {
    const w = liveChipAnswer('What needs me?', { ...ctx, pendingPermissionTaskIds: ['b'] }) as NeedsWidget;
    expect(w.kind).toBe('needs');
    expect(w.tasks.map((t) => t.id).sort()).toEqual(['a', 'b']);
    expect(w.source).toBe(LIVE_SOURCE);
  });

  it('answer What’s not done? without the done task', () => {
    const w = liveChipAnswer('What’s not done?', ctx) as TaskListWidget;
    expect(w.tasks.map((t) => t.id)).not.toContain('d');
    expect(w.source).toBe(LIVE_SOURCE);
  });

  it('say nothing needs you, with the live source, when nothing does', () => {
    const w = liveChipAnswer('What needs me?', { tasks: [task('b', 'Working')], people: {} }) as TextWidget;
    expect(w).toMatchObject({ kind: 'text', text: 'Nothing needs you right now.', source: LIVE_SOURCE });
  });

  it('never use the demo source', () => {
    for (const q of ['Brief me', 'What needs me?', 'What’s not done?']) {
      expect(JSON.stringify(liveChipAnswer(q, ctx))).not.toContain('demo');
    }
  });

  it('send free questions to Ask: null', () => {
    expect(liveChipAnswer('Why did the deploy fail?', ctx)).toBeNull();
    expect(liveChipAnswer('What is claude-code doing?', ctx)).toBeNull();
    expect(liveChipAnswer('Rename a task', ctx)).toBeNull();
    expect(isLiveChip('brief me!')).toBe(true);
    expect(isLiveChip('hello')).toBe(false);
  });
});
