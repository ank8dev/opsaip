// Sends status reports to the Opsaip server: POST /v1/reports.
import type { AgentTask, StatusReport } from '@opsaip/core';

/** How long to wait for the server before giving up, in milliseconds. */
export const DEFAULT_TIMEOUT_MS = 10_000;

/** Longest server error text passed on to the agent. */
const MAX_REASON_LENGTH = 500;

export type SendResult = { ok: true; task: AgentTask } | { ok: false; message: string };

export interface ReportClient {
  /** Send one report. Never throws: every failure becomes a message for the agent. */
  send(report: StatusReport): Promise<SendResult>;
}

/**
 * Messages name the server URL and the reason, never the token. The URL has
 * no user:password part (loadConfig refuses one), so it is safe to show.
 */
export function createReportClient(options: {
  reportsUrl: URL;
  token: string;
  timeoutMs?: number;
}): ReportClient {
  const { reportsUrl, token, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
  const where = reportsUrl.href;

  return {
    async send(report) {
      let res: Response;
      try {
        res = await fetch(reportsUrl, {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify(report),
          signal: AbortSignal.timeout(timeoutMs),
          // Never follow a redirect: it could carry the Authorization header
          // somewhere else. A 3xx answer becomes an "answered HTTP 3xx" message.
          redirect: 'manual',
        });
      } catch (error) {
        return { ok: false, message: networkMessage(error, where, timeoutMs) };
      }

      // Read the body as text first: a proxy in front of the server may
      // answer with HTML, and that must not throw.
      let body: unknown;
      try {
        body = JSON.parse(await res.text());
      } catch {
        body = undefined;
      }
      const reason = errorField(body);

      if (res.status === 200) {
        const task = (body as { task?: unknown } | undefined)?.task;
        if (typeof task === 'object' && task !== null) return { ok: true, task: task as AgentTask };
        return { ok: false, message: `the Opsaip server at ${where} sent an unexpected answer` };
      }
      if (res.status === 401) {
        return {
          ok: false,
          message: 'the Opsaip server rejected the access token: check that OPSAIP_TOKEN is the token the server uses',
        };
      }
      if (res.status === 400 || res.status === 409) {
        return { ok: false, message: `the Opsaip server rejected the report: ${reason ?? `HTTP ${res.status}`}` };
      }
      return {
        ok: false,
        message: `the Opsaip server at ${where} answered HTTP ${res.status}${reason === undefined ? '' : `: ${reason}`}`,
      };
    },
  };
}

/** The server's { "error": "..." } text, shortened, or undefined. */
function errorField(body: unknown): string | undefined {
  const error = (body as { error?: unknown } | undefined)?.error;
  if (typeof error !== 'string' || error === '') return undefined;
  return error.length > MAX_REASON_LENGTH ? `${error.slice(0, MAX_REASON_LENGTH)}...` : error;
}

/**
 * fetch failed before any answer. Only fixed text and a system error code
 * (ECONNREFUSED, ENOTFOUND, ...) are used, never error.message: that text
 * comes from deep inside fetch and could quote request details.
 */
function networkMessage(error: unknown, where: string, timeoutMs: number): string {
  const name = (error as { name?: unknown } | null)?.name;
  if (name === 'TimeoutError' || name === 'AbortError') {
    return `the Opsaip server at ${where} did not answer within ${timeoutMs / 1000} s`;
  }
  const code = (error as { cause?: { code?: unknown } } | null)?.cause?.code;
  const detail = typeof code === 'string' && /^[A-Z0-9_]+$/.test(code) ? ` (${code})` : '';
  return `cannot reach the Opsaip server at ${where}${detail}: is it running?`;
}
