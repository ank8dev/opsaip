// The one door to the web app's sample data and pure helpers. The phone shows the
// same fictional team (Tessera) the dashboard does, from the same files.
// Metro watches apps/web/src (see metro.config.js).

import type { AgentClient, Install, KitItem, Memory, Newcomer, Person, Task, Workspace } from '../../../web/src/types';
import team from '../../../web/src/mocks/team.json';
import activity from '../../../web/src/mocks/activity.json';
import { clients, installs, kit, newcomers } from '../../../web/src/mocks/connections';
import { memories } from '../../../web/src/mocks/memory';

export type { AgentClient, Install, KitItem, Memory, Newcomer, Person, Task, TaskStatus, Workspace } from '../../../web/src/types';
export {
  ago, clockFor, firstName, greeting, kitCell, lastSeen, listNames, missingFromKit, byImportance,
} from '../../../web/src/data/selectors';

/** Tessera as the web app sees it. The phone leaves out what is desktop-only (repo, MCP setup). */
export const tessera: Workspace = {
  team: team as Person[],
  activity: activity as Task[],
  clients: clients as AgentClient[],
  kit: kit as KitItem[],
  installs: installs as Install[],
  newcomers: newcomers as Newcomer[],
  memories: memories as Memory[],
  transcripts: [],
  mcp: [],
  repo: null,
  repoAccess: [],
  branches: [],
  members: [],
  channels: [],
  links: [],
  statusMap: [],
  sessions: [],
};
