// Update check: asks GitHub for the latest release once a day. Nothing about
// the user or the server is sent, nothing is downloaded or installed, and the
// result lives in memory only.

export const RELEASES_API = 'https://api.github.com/repos/ank8dev/opsaip/releases/latest';
export const RELEASES_URL_PREFIX = 'https://github.com/ank8dev/opsaip/releases';
export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const CHECK_TIMEOUT_MS = 10_000;

export interface Version {
  major: number;
  minor: number;
  patch: number;
  /** Has a "-prerelease" part. */
  pre: boolean;
}

/** "v1.2.3", "1.2.3", "1.2.3-rc.1" (build metadata after "+" is ignored). Anything else is undefined. */
export function parseSemver(text: unknown): Version | undefined {
  if (typeof text !== 'string') return undefined;
  const m = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/.exec(text);
  if (m === null) return undefined;
  const [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (![major, minor, patch].every(Number.isSafeInteger)) return undefined;
  return { major, minor, patch, pre: m[4] !== undefined };
}

/** True when `latest` is a newer stable version than `current`. A prerelease is never newer; garbage is never newer. */
export function isNewer(latest: string, current: string): boolean {
  const a = parseSemver(latest);
  const b = parseSemver(current);
  if (a === undefined || b === undefined || a.pre) return false;
  if (a.major !== b.major) return a.major > b.major;
  if (a.minor !== b.minor) return a.minor > b.minor;
  if (a.patch !== b.patch) return a.patch > b.patch;
  return false;
}

/** A release that passed every check, or undefined (draft, prerelease, bad tag, bad url). */
export function validateRelease(json: unknown): { tag: string; url: string } | undefined {
  if (typeof json !== 'object' || json === null) return undefined;
  const r = json as Record<string, unknown>;
  if (r.draft === true || r.prerelease === true) return undefined;
  const version = parseSemver(r.tag_name);
  if (version === undefined || version.pre) return undefined;
  if (typeof r.html_url !== 'string' || !r.html_url.startsWith(RELEASES_URL_PREFIX)) return undefined;
  // "/releases" itself or "/releases/..." only, not "/releases-evil".
  const rest = r.html_url.slice(RELEASES_URL_PREFIX.length);
  if (rest !== '' && !rest.startsWith('/')) return undefined;
  return { tag: r.tag_name as string, url: r.html_url };
}

export interface UpdateStatus {
  enabled: boolean;
  current: string;
  latest: string | null;
  url: string | null;
  newer: boolean;
  checkedAt: string | null;
}

export interface UpdateCheck {
  /** Check now, then once every 24 h. Does nothing when disabled. */
  start(): void;
  /** Stop the timer. */
  stop(): void;
  status(): UpdateStatus;
}

interface Timer {
  unref(): unknown;
}

export interface UpdateCheckOptions {
  /** The running server version. */
  current: string;
  enabled: boolean;
  fetch?: typeof fetch;
  now?: () => number;
  setInterval?: (fn: () => void, ms: number) => Timer;
  clearInterval?: (timer: Timer) => void;
  log?: (line: string) => void;
}

/** OPSAIP_UPDATE_CHECK=off (also "0" and "false", any case) turns the check off. */
export function updateCheckEnabled(env: Readonly<Record<string, string | undefined>>): boolean {
  const value = env.OPSAIP_UPDATE_CHECK?.trim().toLowerCase();
  return !(value === 'off' || value === '0' || value === 'false');
}

export function createUpdateCheck({
  current,
  enabled,
  fetch: doFetch = globalThis.fetch,
  now = Date.now,
  setInterval: setTimer = (fn, ms) => setInterval(fn, ms),
  clearInterval: clearTimer = (timer) => clearInterval(timer as ReturnType<typeof setInterval>),
  log = (line) => console.log(line),
}: UpdateCheckOptions): UpdateCheck {
  let last: { tag: string; url: string; checkedAt: string } | undefined;
  let timer: Timer | undefined;

  async function check(): Promise<void> {
    try {
      const response = await doFetch(RELEASES_API, {
        headers: { accept: 'application/vnd.github+json', 'user-agent': 'opsaip-update-check' },
        signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
      });
      if (!response.ok) {
        log(`opsaip: update check failed (status ${response.status})`);
        return;
      }
      const release = validateRelease(await response.json());
      if (release === undefined) return;
      last = { ...release, checkedAt: new Date(now()).toISOString() };
    } catch {
      // Network error, timeout or invalid JSON: nothing from the error is logged.
      log('opsaip: update check failed (network)');
    }
  }

  return {
    start() {
      if (!enabled || timer !== undefined) return;
      void check();
      timer = setTimer(() => void check(), CHECK_INTERVAL_MS);
      timer.unref();
    },
    stop() {
      if (timer !== undefined) clearTimer(timer);
      timer = undefined;
    },
    status() {
      if (!enabled) {
        return { enabled, current, latest: null, url: null, newer: false, checkedAt: null };
      }
      return {
        enabled,
        current,
        latest: last === undefined ? null : last.tag.replace(/^v/, ''),
        url: last?.url ?? null,
        newer: last !== undefined && isNewer(last.tag, current),
        checkedAt: last?.checkedAt ?? null,
      };
    },
  };
}
