// What agents learned and keep: facts shared with the team (project) or only yours (personal),
// and the sessions that started with them. Times are relative to now.

import type { Memory, MemorySession } from '../types';

const minutesAgo = (m: number) => new Date(Date.now() - m * 60000).toISOString();
const DAY = 1440;

export const memories: Memory[] = [
  { id: 'm1', scope: 'project', author: 'p2', created: minutesAgo(2 * DAY), reviewed: true, fact: 'The voice gateway deploys only from release/* branches.', source: { agent: 'Claude Code', session: 'cc-81aa' } },
  { id: 'm2', scope: 'project', author: 'p3', created: minutesAgo(1560), reviewed: true, fact: 'The Fjord Bank pilot runs on the EU cluster (eu-north-1); their call data stays in the EU.', source: { agent: 'Codex', session: 'cx-3c07' } },
  { id: 'm3', scope: 'project', author: 'p11', created: minutesAgo(300), reviewed: false, fact: 'Since 3.1, card numbers in transcripts are redacted before they are stored.', source: { agent: 'Claude Code', session: 'cc-a912' } },
  { id: 'm4', scope: 'project', author: 'p5', created: minutesAgo(180), reviewed: false, fact: 'The nightly accent eval takes about 40 minutes on 2 GPUs.', source: { agent: 'Codex', session: 'cx-77d4' } },
  { id: 'm5', scope: 'project', author: 'p2', created: minutesAgo(1200), reviewed: false, fact: 'Staging resets every Sunday at 03:00 UTC.', source: { agent: 'Codex', session: 'cx-19be' } },
  { id: 'm6', scope: 'project', author: 'p8', created: minutesAgo(6 * DAY), reviewed: true, fact: 'Growth owns the pricing page copy; Hugo signs it off.', source: { agent: 'Claude Code', session: 'cc-5e30' } },
  { id: 'm7', scope: 'personal', author: 'me', created: minutesAgo(4 * DAY), reviewed: true, fact: 'I review frontend pull requests in the morning, Stockholm time.', source: { agent: 'Claude', session: 'cl-0f42' } },
  { id: 'm8', scope: 'personal', author: 'me', created: minutesAgo(540), reviewed: true, fact: 'apps/console uses Vitest, not Jest.', source: { agent: 'Claude Code', session: 'cc-d4b1' } },
];

export const sessions: MemorySession[] = [
  { id: 'cc-81aa', person: 'p2', agent: 'Claude Code', title: 'Deploy agent console 3.2 to production', started: minutesAgo(2900), memories: [] },
  { id: 'cx-3c07', person: 'p3', agent: 'Codex', title: 'Summarize Fjord Bank pilot feedback', started: minutesAgo(1575), memories: ['m1'] },
  { id: 'cc-a912', person: 'p11', agent: 'Claude Code', title: 'Redact card numbers from transcripts', started: minutesAgo(340), memories: ['m1', 'm2'] },
  { id: 'cx-77d4', person: 'p5', agent: 'Codex', title: 'Nightly eval: accent robustness', started: minutesAgo(230), memories: ['m2', 'm3'] },
  { id: 'cx-19be', person: 'p2', agent: 'Codex', title: 'Rotate staging certificates', started: minutesAgo(1230), memories: ['m1'] },
  { id: 'cc-5e30', person: 'p8', agent: 'Claude Code', title: 'Review copy for the pricing page', started: minutesAgo(8650), memories: [] },
  { id: 'cl-0f42', person: 'me', agent: 'Claude', title: 'Plan the review rota', started: minutesAgo(5765), memories: [] },
  { id: 'cc-d4b1', person: 'me', agent: 'Claude Code', title: 'Fix the flaky call list test', started: minutesAgo(565), memories: ['m1', 'm7'] },
  { id: 'cc-e620', person: 'me', agent: 'Claude Code', title: 'Redesign the live call view', started: minutesAgo(40), memories: ['m1', 'm2', 'm3', 'm5', 'm7', 'm8'] },
];
