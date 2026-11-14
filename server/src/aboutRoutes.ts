// GET /v1/about and GET /v1/update. Both sit behind the bearer guard like
// every /v1 route (auth/requestGuard.ts: default deny).
import type { ServerResponse } from 'node:http';
import type { About } from './about';
import type { UpdateStatus } from './updateCheck';

type Handler = (req: never, res: ServerResponse) => void | Promise<void>;

export interface AboutRoutesOptions {
  about: () => Promise<About>;
  update: () => UpdateStatus;
  sendJson: (res: ServerResponse, status: number, body: unknown) => void;
}

export function aboutRoutes({ about, update, sendJson }: AboutRoutesOptions): Record<string, Record<string, Handler>> {
  return {
    '/v1/about': { GET: async (_req, res) => sendJson(res, 200, await about()) },
    '/v1/update': { GET: (_req, res) => sendJson(res, 200, update()) },
  };
}
