// Pure functions over workspace data: sorting, counting, time. No React here,
// so they are easy to test and could move to the server unchanged.

import type { AgentClient, AnyTask, Install, KitItem, McpConnection, Person, Priority, StatusMapRow, Task, TaskStatus, Workspace } from '../types';

// ---- Order and importance ----

const ORDER: Record<TaskStatus, number> = { 'Needs you': 0, Working: 1, Failed: 2, Queued: 3, Done: 4 };
const PRIO: Record<Priority, number> = { Urgent: 0, High: 1, Normal: 2, Low: 3 };

export const byStatus = (a: Task, b: Task) => (ORDER[a.status] ?? 9) - (ORDER[b.status] ?? 9);
export const prioOf = (t: Task) => (t.priority ? PRIO[t.priority] : 2);
export const byImportance = (a: Task, b: Task) =>
  prioOf(a) - prioOf(b) || String(a.since ?? '').localeCompare(String(b.since ?? ''));

/** What reaches the attention tray, set in Settings → Notifications. */
export type TrayLevel = 'urgent' | 'high' | 'all';
export function isImportant(t: Task, level: TrayLevel): boolean {
  const p = prioOf(t);
  return level === 'all' || (level === 'urgent' ? p === 0 : p <= 1);
}

// ---- Lookups ----

export function peopleById(team: Person[]): Record<string, Person> {
  return Object.fromEntries(team.map((p) => [p.id, p]));
}

export function firstName(name: string | undefined): string {
  return String(name ?? '').split(' ')[0];
}

// ---- Counts (were dash.calc in the prototype) ----

export function navCounts(ws: Workspace, tasks: Task[]) {
  return {
    agents: tasks.filter((t) => t.status !== 'Done').length,
    team: ws.team.length,
    mcp: ws.mcp.filter((c) => c.status === 'Connected').length,
    repo: ws.branches.filter((b) => b.state === 'Open').length,
  };
}

/** Connected / total MCP links in one direction. */
export function mcpSummary(mcp: McpConnection[], direction: 'in' | 'out') {
  const all = mcp.filter((c) => c.direction === direction);
  return { connected: all.filter((c) => c.status === 'Connected').length, total: all.length };
}

/** Tasks an agent connection reported, or tasks that use a tool server. */
export function tasksForConnection(c: McpConnection, tasks: Task[]): Task[] {
  return tasks.filter((t) => (c.direction === 'in' ? t.source === c.name && t.owner === c.owner : t.tool === c.name));
}

/** Agents working or waiting for someone, per teammate. */
export function runningAgents(personId: string, tasks: Task[]): number {
  return tasks.filter((t) => t.owner === personId && (t.status === 'Working' || t.status === 'Needs you')).length;
}

export function mapState(statusMap: StatusMapRow[], status: string, tool: string): string {
  const row = statusMap.find((m) => m.status === status);
  const key = tool.toLowerCase() as keyof StatusMapRow;
  return row?.[key] || status;
}

// ---- Time ----

export const pad2 = (n: number) => String(n).padStart(2, '0');

export interface Clock {
  text: string;      // their local time, "14:05"
  min: number;       // minutes since their midnight
  working: boolean;  // inside their work hours
}

export function clockFor(p: Person, now = new Date()): Clock {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: p.tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
    const hh = Number(parts.find((x) => x.type === 'hour')?.value);
    const mm = Number(parts.find((x) => x.type === 'minute')?.value);
    return { text: `${pad2(hh)}:${pad2(mm)}`, min: hh * 60 + mm, working: hh >= p.start && hh < p.end };
  } catch {
    return { text: '', min: 0, working: false };
  }
}

/** "now", "5m ago", "3h ago", "2d ago" */
export function ago(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const m = Math.max(0, Math.round((now - t) / 60000));
  if (m < 1) return 'now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

/** How long a task has waited in its status: "12m", "3h", "2d". */
export function waitingFor(t: AnyTask, now = Date.now()): string {
  const ms = now - Date.parse(t.since ?? '');
  if (Number.isNaN(ms) || ms < 0) return '';
  const m = Math.round(ms / 60000);
  return m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
}

export function greeting(now = new Date()): string {
  const h = now.getHours();
  return h < 5 ? 'Good evening.' : h < 12 ? 'Good morning.' : h < 18 ? 'Good afternoon.' : 'Good evening.';
}

// ---- the team kit: who runs which agent client and what their agents can reach ----

const LIVE_MIN = 15;   // a plugin seen this recently counts as live
const STALE_MIN = 1440;

/** How fresh a "last seen" is: live (a plugin, within 15 min), recent, or stale (over a day, or never). */
export function freshness(iso: string | undefined, source?: AgentClient['source'], now = Date.now()): 'live' | 'recent' | 'stale' {
  const m = (now - Date.parse(iso ?? '')) / 60000;
  if (Number.isNaN(m) || m > STALE_MIN) return 'stale';
  return source === 'plugin' && m <= LIVE_MIN ? 'live' : 'recent';
}

/** "last seen 5m ago", "last seen just now", "never seen" */
export function lastSeen(iso: string | undefined, now = Date.now()): string {
  const a = iso ? ago(iso, now) : '';
  return a ? `last seen ${a === 'now' ? 'just now' : a}` : 'never seen';
}

/** One cell of the kit matrix: a teammate and a kit item, and where Opsaip last saw it. */
export interface KitCell {
  item: KitItem;
  client?: AgentClient;
  install?: Install;
  seen?: string;
  source?: AgentClient['source'];
}

export function kitCell(ws: Workspace, personId: string, item: KitItem): KitCell {
  if (item.kind === 'agent') {
    const client = ws.clients.find((c) => c.person === personId && c.name === item.name);
    return { item, client, seen: client?.last_seen, source: client?.source };
  }
  const install = ws.installs.find((i) => i.person === personId && i.item === item.id);
  const client = install ? ws.clients.find((c) => c.id === install.client) : undefined;
  return { item, client, install, seen: install?.last_seen, source: client?.source };
}

/** The kit items a teammate's agents have never reported. */
export function missingFromKit(ws: Workspace, personId: string): KitItem[] {
  return ws.kit.filter((k) => k.in_kit && !kitCell(ws, personId, k).seen);
}

/** Everyone missing something from the kit, most missing first. */
export function kitDrift(ws: Workspace): { person: Person; missing: KitItem[] }[] {
  return ws.team
    .map((person) => ({ person, missing: missingFromKit(ws, person.id) }))
    .filter((d) => d.missing.length)
    .sort((a, b) => b.missing.length - a.missing.length);
}

/** "Linear MCP", "Linear MCP and GitHub MCP", "Linear MCP, GitHub MCP and Sentry MCP", "A, B and 3 more" */
export function listNames(items: { name: string }[], max = 3): string {
  const n = items.map((i) => i.name);
  if (n.length <= 1) return n.join('');
  if (n.length <= max) return `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`;
  return `${n.slice(0, max - 1).join(', ')} and ${n.length - max + 1} more`;
}
