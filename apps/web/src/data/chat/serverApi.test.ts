import { describe, expect, it } from 'vitest';
import { makeServerApi } from './serverApi';

const signal = new AbortController().signal;

describe('makeServerApi', () => {
  it('without a token every call is unauthorized and sends nothing', async () => {
    let calls = 0;
    const api = makeServerApi(null, (async () => { calls++; return new Response('{}'); }) as unknown as typeof fetch);
    const all = [
      api.createTask('x', signal), api.conductor(signal), api.startRun('x', signal), api.getRun('r', signal),
      api.answerPermission('r', 'p', true, signal), api.followUp('r', 'x', signal), api.cancelRun('r', signal),
    ];
    for (const r of await Promise.all(all)) expect(r).toEqual({ ok: false, problem: 'unauthorized' });
    expect(calls).toBe(0);
  });

  it('with a token it sends it as the Bearer header', async () => {
    const seen: string[] = [];
    const api = makeServerApi('tok-9', (async (_u: string, init: RequestInit) => {
      seen.push((init.headers as Record<string, string>).authorization);
      return new Response(JSON.stringify({ enabled: true }), { status: 200 });
    }) as unknown as typeof fetch);
    expect(await api.conductor(signal)).toEqual({ ok: true, value: { enabled: true } });
    expect(seen).toEqual(['Bearer tok-9']);
  });
});
