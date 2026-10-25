// The guided tour the landing page offers. When the web build runs inside the landing's iframe,
// the composer opens with a message already typed; sending it starts a short conversation that
// branches through the app: the queue, a release, the team, handing off a task, the connectors.
// Everything stays live — you can leave the path at any point. Outside the landing, nothing changes.

import { Platform } from 'react-native';

/** The web build, embedded in another page (the landing). */
export function embedded(): boolean {
  return Platform.OS === 'web' && typeof window !== 'undefined' && window.parent !== window;
}

/** What the composer holds when the landing opens the app. */
export const TOUR_MESSAGE = 'Hi Opsaip, show me what you can do.';

/** Messages that start (or restart) the tour. */
export const startsTour = (text: string) => text.trim() === TOUR_MESSAGE || /^\s*(tour|show me around|what can you do\??)\s*$/i.test(text);

export type BranchId = 'needs' | 'ship' | 'team' | 'task' | 'tools';

export interface Branch {
  id: BranchId;
  label: string;
  /** What the agent says when you pick it. */
  say: string;
  /** Where it takes you; the thread stays where it is when absent. */
  go?: string;
  /** The hint shown on that screen, with a way back to the tour. */
  tip?: string;
  /** What the tour waits for before it goes on: you deciding, a run you sent finishing, or nothing. */
  wait: 'decision' | 'run' | 'none';
  /** A line typed into the composer for you. */
  draft?: string;
  /** What the agent says when it goes on. */
  after: string;
}

export const BRANCHES: Branch[] = [
  {
    id: 'needs',
    label: 'What needs me',
    say: 'Here’s your queue. I sort everything into Now, Today and Can wait, and hand you one decision at a time. The first one is open: decide it, or tap Not now and I’ll ask when to remind you.',
    wait: 'decision',
    after: 'That’s one off your plate, and GitHub, Linear and Slack already know.',
  },
  {
    id: 'ship',
    label: 'Ship a release',
    say: 'Opening a release that’s waiting on you. Preview checks passed; production waits for your yes.',
    go: '/details/ap-deploy',
    tip: 'Tap Deploy. GitHub, Linear and Slack hear about it on their own.',
    wait: 'none',
    after: 'Nothing goes to production without a person saying yes.',
  },
  {
    id: 'team',
    label: 'My team',
    say: 'Opening Team: who’s at work, which agents they run, and what’s stuck.',
    go: '/team',
    tip: 'Tap anyone to see what their agents are doing right now.',
    wait: 'none',
    after: 'That’s your whole team and every agent, at a glance.',
  },
  {
    id: 'task',
    label: 'Hand off a task',
    say: 'Give me work the way you’d give it to a teammate. I typed one in for you: send it and watch an agent pick it up.',
    wait: 'run',
    draft: 'Fix the flaky login test on web',
    after: 'Done while we talked. You only hear from an agent when it needs you.',
  },
  {
    id: 'tools',
    label: 'Agent toolkit',
    say: 'Every agent on the team gets the same kit over MCP: GitHub, Linear, Slack, Sentry, Notion. Here’s yours.',
    go: '/prefs/connectors',
    tip: 'When a teammate’s agents are missing a tool, I notice and send them the setup link.',
    wait: 'none',
    after: 'Same kit for every agent, so they all work the same way.',
  },
];

export const HELLO = 'Happy to. I conduct your team’s agents: I watch every run, bring you only the calls that need a person, and keep GitHub, Linear and Notion in step. Where should we start?';
export const LOOK_AROUND = 'I’ll look around';
export const ENOUGH = 'That’s enough';
export const SKIP = 'Skip';
export const NEXT = ['Where next?', 'What should we look at next?', 'Next stop?'];
export const FREE = 'Go ahead, tap anything. This is a live sample team and nothing is saved. Send “tour” whenever you want the tour.';
export const END = 'That’s the tour. This is a live sample team: tap anything, or ask me something like “what needs me?”. Nothing you do here is saved.';

export const branchByLabel = (label: string) => BRANCHES.find((b) => b.label === label);

/** The branches you haven't seen yet, as quick replies, with a way out. */
export const nextOptions = (seen: BranchId[]) => [...BRANCHES.filter((b) => !seen.includes(b.id)).map((b) => b.label), ENOUGH];
