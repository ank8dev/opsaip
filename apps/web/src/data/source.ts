// Where workspace data comes from. Today: the mocks. Later: the Opsaip server.
// This is the one place to change when the API exists — e.g.
//   const res = await fetch(`${import.meta.env.VITE_OPSAIP_API_URL}/workspace`);
//   return (await res.json()) as Workspace;

import type { Workspace } from '../types';
import { mockWorkspace } from '../mocks';

export function loadWorkspace(): Workspace {
  return mockWorkspace;
}
