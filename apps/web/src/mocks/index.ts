// Sample data: a fictional voice-AI startup called Tessera (11 people,
// 22 tasks, 24 MCP links). Nothing here comes from a real team or tool.
// Each JSON file has the same shape the Opsaip server will return.

import type {
  Branch, Channel, Link, McpConnection, Member, Person, Repo, RepoAccess,
  StatusMapRow, Task, TranscriptMessage, Workspace,
} from '../types';
import team from './team.json';
import activity from './activity.json';
import transcripts from './transcripts.json';
import mcp from './mcp.json';
import repo from './repo.json';
import repoAccess from './repo_access.json';
import branches from './branches.json';
import members from './members.json';
import channels from './channels.json';
import links from './links.json';
import statusMap from './status_map.json';
import { clients, installs, kit, newcomers } from './connections';
import { memories, sessions } from './memory';

export const mockWorkspace: Workspace = {
  team: team as Person[],
  activity: activity as Task[],
  clients,
  kit,
  installs,
  newcomers,
  memories,
  sessions,
  transcripts: transcripts as TranscriptMessage[],
  mcp: mcp as McpConnection[],
  repo: (repo as Repo[])[0] ?? null,
  repoAccess: repoAccess as RepoAccess[],
  branches: branches as Branch[],
  members: members as Member[],
  channels: channels as Channel[],
  links: links as Link[],
  statusMap: statusMap as StatusMapRow[],
};
