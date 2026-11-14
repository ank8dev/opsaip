// What is in v0.1, and what is built but not shipped yet.
//
// Every flag below is OFF in a production build: the UI for it is not rendered
// at all (the code stays, so it can come back one flag at a time). To look at
// one while developing, list it in a Vite env var and restart `npm run dev`:
//
//   VITE_OPSAIP_FEATURES="team,mcp,repo" npm run dev
//   VITE_OPSAIP_FEATURES="all" npm run dev
//
// The variable is read in dev only, so a production build cannot switch them on.

export interface Features {
  /** Sidebar > Team. */
  team: boolean;
  /** Sidebar > MCP. */
  mcp: boolean;
  /** Sidebar > Repo. */
  repo: boolean;
  /** Composer mode: Announce (only previews Slack). */
  announce: boolean;
  /** Composer mode: Message (only previews Slack). */
  message: boolean;
  /** "Linked: Linear, GitHub, Notion" in the task window, and the sync wording that goes with it. */
  linkedItems: boolean;
  /** Settings sections that only preview (Profile ... Data & privacy), and every "Preview" / "not saved yet" note. */
  previewSettings: boolean;
  /** The next-step buttons next to the composer's mode button (demo tasks only). */
  quickActions: boolean;
}

const KEYS: (keyof Features)[] = ['team', 'mcp', 'repo', 'announce', 'message', 'linkedItems', 'previewSettings', 'quickActions'];

/** Reads the list from VITE_OPSAIP_FEATURES: "team,mcp", or "all". Unknown names are ignored. */
export function parseFeatures(list: string | undefined): Features {
  const on = new Set((list ?? '').split(',').map((s) => s.trim()).filter(Boolean));
  const all = on.has('all');
  const out = {} as Features;
  for (const k of KEYS) out[k] = all || on.has(k);
  return out;
}

/** The flags as built: all off, unless a developer switched some on. */
export const FEATURES: Readonly<Features> = parseFeatures(
  import.meta.env.DEV ? (import.meta.env.VITE_OPSAIP_FEATURES as string | undefined) : undefined,
);

let override: Partial<Features> = {};

/** Tests only: turn flags on or off for the next renders. Call with no argument to reset. */
export function overrideFeatures(next: Partial<Features> = {}): void {
  override = next;
}

/** The one way to ask whether something is shipped. */
export function feature(name: keyof Features): boolean {
  return override[name] ?? FEATURES[name];
}
