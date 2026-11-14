import { describe, expect, it } from 'vitest';
import {
  ASK_DOCS_URL, ASK_PATH, ASK_SOURCE, askProblemReply, askQuestion, askReply, parseRetryAfter, type AskProblem,
} from './ask';

const signal = new AbortController().signal;

/** A fetch that records the request and answers with `res`. */
function fakeFetch(res: Response | Error) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (res instanceof Error) throw res;
    return res;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

describe('askQuestion: the request', () => {
  it('POSTs { question } to /v1/ask with the token, JSON, and no redirects', async () => {
    const { impl, calls } = fakeFetch(json(200, { answer: 'Two.' }));
    const r = await askQuestion('tok-123', 'How many?', signal, impl);
    expect(r).toEqual({ ok: true, answer: 'Two.' });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(ASK_PATH);
    expect(ASK_PATH).toBe('/v1/ask');
    const init = calls[0].init;
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('error');
    expect(init.signal).toBe(signal);
    expect(init.headers).toMatchObject({ authorization: 'Bearer tok-123', 'content-type': 'application/json' });
    expect(JSON.parse(init.body as string)).toEqual({ question: 'How many?' });
  });

  it('never puts the token in the URL or the body', async () => {
    const { impl, calls } = fakeFetch(json(200, { answer: 'ok' }));
    await askQuestion('SECRET-TOKEN', 'q', signal, impl);
    expect(calls[0].url).not.toContain('SECRET-TOKEN');
    expect(calls[0].init.body as string).not.toContain('SECRET-TOKEN');
  });
});

describe('askQuestion: every status maps to one problem', () => {
  const cases: [number, AskProblem][] = [
    [400, 'bad-question'], [401, 'unauthorized'], [413, 'too-large'], [429, 'rate-limited'],
    [502, 'bad-gateway'], [503, 'not-configured'], [504, 'timeout'],
    [415, 'server-error'], [500, 'server-error'], [404, 'server-error'], [418, 'server-error'],
  ];
  it.each(cases)('%i -> %s', async (status, problem) => {
    const { impl } = fakeFetch(json(status, { error: 'x' }));
    expect(await askQuestion('t', 'q', signal, impl)).toEqual({ ok: false, problem });
  });

  it('429 carries Retry-After in seconds', async () => {
    const { impl } = fakeFetch(json(429, { error: 'slow down' }, { 'retry-after': '42' }));
    expect(await askQuestion('t', 'q', signal, impl)).toEqual({ ok: false, problem: 'rate-limited', retryAfter: 42 });
  });

  it('a 429 without a usable Retry-After has none', async () => {
    for (const h of [{}, { 'retry-after': 'Wed, 21 Oct 2026 07:28:00 GMT' }, { 'retry-after': '-5' }, { 'retry-after': '' }] as Record<string, string>[]) {
      const { impl } = fakeFetch(json(429, {}, h));
      expect(await askQuestion('t', 'q', signal, impl)).toEqual({ ok: false, problem: 'rate-limited' });
    }
  });

  it('parseRetryAfter reads whole seconds only', () => {
    expect(parseRetryAfter('7')).toBe(7);
    expect(parseRetryAfter(' 12 ')).toBe(12);
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter('1.5')).toBeUndefined();
    expect(parseRetryAfter('abc')).toBeUndefined();
  });
});

describe('askQuestion: never throws', () => {
  it('a network error, a blocked redirect or an abort is "unreachable"', async () => {
    for (const e of [new TypeError('fetch failed'), new DOMException('aborted', 'AbortError')]) {
      expect(await askQuestion('t', 'q', signal, fakeFetch(e).impl)).toEqual({ ok: false, problem: 'unreachable' });
    }
  });

  it('a 200 that is not JSON, or has no answer, is "bad-response"', async () => {
    const bad = [
      new Response('<html>proxy page</html>', { status: 200 }),
      json(200, {}),
      json(200, { answer: 42 }),
      json(200, { answer: '' }),
      json(200, { answer: '   ' }),
      json(200, ['answer']),
      json(200, null),
    ];
    for (const res of bad) {
      expect(await askQuestion('t', 'q', signal, fakeFetch(res).impl)).toEqual({ ok: false, problem: 'bad-response' });
    }
  });

  it('a body that fails to read after an abort is "unreachable"', async () => {
    const c = new AbortController();
    const res = new Response('{', { status: 200 });
    c.abort();
    expect(await askQuestion('t', 'q', c.signal, fakeFetch(res).impl)).toEqual({ ok: false, problem: 'unreachable' });
  });
});

describe('the answer stays plain text', () => {
  const nasty = '<img src=x onerror=alert(1)> **bold** [link](javascript:alert(1)) <script>x()</script>\nline two';

  it('is returned byte for byte: no parsing, no stripping, no Markdown', async () => {
    const { impl } = fakeFetch(json(200, { answer: nasty }));
    const r = await askQuestion('t', 'q', signal, impl);
    expect(r).toEqual({ ok: true, answer: nasty });
  });

  it('becomes a text widget with the Ask source line and no link', () => {
    const w = askReply({ ok: true, answer: nasty });
    expect(w).toEqual({ kind: 'text', text: nasty, source: ASK_SOURCE });
    expect(w.source).toBe('From your server’s tasks, via Ask');
    expect(w.link).toBeUndefined();
  });
});

describe('what Opsy says for each problem', () => {
  const problems: AskProblem[] = [
    'not-configured', 'bad-question', 'too-large', 'rate-limited', 'bad-gateway', 'timeout',
    'unauthorized', 'server-error', 'unreachable', 'bad-response',
  ];

  it.each(problems)('%s: a short, honest, non-empty sentence with no source line', (p) => {
    const w = askProblemReply(p);
    expect(w.kind).toBe('text');
    expect(w.text.length).toBeGreaterThan(10);
    expect(w.text.length).toBeLessThan(160);
    expect(w.source).toBeUndefined();
  });

  it('every problem has its own text', () => {
    expect(new Set(problems.map((p) => askProblemReply(p).text)).size).toBe(problems.length);
  });

  it('503 says Ask is not set up and links to the README Ask section', () => {
    const w = askProblemReply('not-configured');
    expect(w.text).toMatch(/not set up/);
    expect(w.link).toEqual({ label: 'How to turn Ask on', href: 'https://github.com/ank8dev/opsaip#ask-optional' });
    expect(ASK_DOCS_URL).toBe('https://github.com/ank8dev/opsaip#ask-optional');
  });

  it('only 503 has a link', () => {
    for (const p of problems.filter((x) => x !== 'not-configured')) expect(askProblemReply(p).link).toBeUndefined();
  });

  it('429 says when to try again, with the right plural', () => {
    expect(askProblemReply('rate-limited', 30).text).toMatch(/Try again in 30 seconds\.$/);
    expect(askProblemReply('rate-limited', 1).text).toMatch(/Try again in 1 second\.$/);
    expect(askProblemReply('rate-limited').text).toMatch(/Try again in a minute\.$/);
  });

  it('no reply ever contains the token or a server detail', () => {
    for (const p of problems) expect(askProblemReply(p).text).not.toMatch(/token:|Bearer|stack/i);
  });

  it('askReply maps a failed result to its problem reply', () => {
    expect(askReply({ ok: false, problem: 'timeout' })).toEqual(askProblemReply('timeout'));
    expect(askReply({ ok: false, problem: 'rate-limited', retryAfter: 9 })).toEqual(askProblemReply('rate-limited', 9));
  });
});
