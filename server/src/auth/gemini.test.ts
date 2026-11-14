// The Gemini adapter against a fake fetch: no network.
import { describe, expect, it, vi } from 'vitest';
import { ProviderError } from './askProvider';
import { createGeminiProvider, GEMINI_API_BASE, GEMINI_MAX_OUTPUT_TOKENS } from './gemini';

const KEY = 'AIza-gemini-test-SECRET-key-0123456789';
const MODEL = 'gemini-3.5-flash-lite';
const PROMPT = { system: 'the rules', user: 'the data and the question' };

function fakeFetch(status: number, body: unknown) {
  return vi.fn<typeof fetch>(async () =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

function answered(...parts: unknown[]) {
  return { candidates: [{ content: { role: 'model', parts }, finishReason: 'STOP' }] };
}

async function failure(promise: Promise<unknown>): Promise<ProviderError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ProviderError);
  return error as ProviderError;
}

describe('Gemini provider', () => {
  it('calls generateContent with the key in the x-goog-api-key header only', async () => {
    const fetchFn = fakeFetch(200, answered({ text: 'Two tasks wait for you.' }));
    const provider = createGeminiProvider(KEY, MODEL, fetchFn);
    const signal = new AbortController().signal;

    expect(await provider.answer(PROMPT, signal)).toBe('Two tasks wait for you.');

    expect(fetchFn).toHaveBeenCalledOnce();
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe(`${GEMINI_API_BASE}${MODEL}:generateContent`);
    expect(String(url)).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent');
    expect(String(url)).not.toContain(KEY);
    expect(init?.method).toBe('POST');
    expect(init?.signal).toBe(signal);
    expect(init?.headers).toEqual({ 'content-type': 'application/json', 'x-goog-api-key': KEY });
    expect(JSON.parse(String(init?.body))).toEqual({
      systemInstruction: { parts: [{ text: 'the rules' }] },
      contents: [{ role: 'user', parts: [{ text: 'the data and the question' }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS },
    });
    expect(String(init?.body)).not.toContain(KEY);
  });

  it('with a response schema, asks for JSON output; the key stays out of the body', async () => {
    const schema = { type: 'OBJECT', properties: { answer: { type: 'STRING' } } };
    const fetchFn = fakeFetch(200, answered({ text: '{"answer":"x","action":null}' }));
    const provider = createGeminiProvider(KEY, MODEL, fetchFn);
    await provider.answer({ ...PROMPT, responseSchema: schema }, new AbortController().signal);
    const [, init] = fetchFn.mock.calls[0];
    expect(JSON.parse(String(init?.body)).generationConfig).toEqual({
      temperature: 0.2,
      maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS,
      responseMimeType: 'application/json',
      responseSchema: schema,
    });
    expect(String(init?.body)).not.toContain(KEY);
    expect(init?.headers).toEqual({ 'content-type': 'application/json', 'x-goog-api-key': KEY });
  });

  it('joins the text parts and leaves out thought parts', async () => {
    const fetchFn = fakeFetch(200, answered({ text: 'thinking...', thought: true }, { text: 'One ' }, { text: 'task. ' }));
    expect(await createGeminiProvider(KEY, MODEL, fetchFn).answer(PROMPT, new AbortController().signal)).toBe(
      'One task.',
    );
  });

  it('an error status becomes a ProviderError with the status only, never the body', async () => {
    // Google error bodies can echo request details; pretend this one echoes the key.
    const fetchFn = fakeFetch(400, { error: { code: 400, message: `API key not valid: ${KEY}` } });
    const error = await failure(createGeminiProvider(KEY, MODEL, fetchFn).answer(PROMPT, new AbortController().signal));
    expect(error.message).toBe('provider answered HTTP 400');
    expect(JSON.stringify(error)).not.toContain(KEY);
    expect(error.cause).toBeUndefined();
  });

  it('a body that is not JSON on an error status is still a ProviderError', async () => {
    const error = await failure(
      createGeminiProvider(KEY, MODEL, fakeFetch(503, '<html>busy</html>')).answer(PROMPT, new AbortController().signal),
    );
    expect(error.message).toBe('provider answered HTTP 503');
  });

  it('a network error becomes a ProviderError without the original error', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => {
      throw new TypeError(`fetch failed for key ${KEY}`);
    });
    const error = await failure(createGeminiProvider(KEY, MODEL, fetchFn).answer(PROMPT, new AbortController().signal));
    expect(error.message).toBe('request to the provider failed');
    expect(error.cause).toBeUndefined();
    expect(error.stack).not.toContain(KEY);
  });

  it('a blocked prompt or an empty answer is a ProviderError that names the reason', async () => {
    const signal = new AbortController().signal;
    const blocked = fakeFetch(200, { promptFeedback: { blockReason: 'SAFETY' } });
    expect((await failure(createGeminiProvider(KEY, MODEL, blocked).answer(PROMPT, signal))).message).toBe(
      'provider returned no answer (SAFETY)',
    );

    const cut = fakeFetch(200, { candidates: [{ content: { parts: [{ text: ' ' }] }, finishReason: 'MAX_TOKENS' }] });
    expect((await failure(createGeminiProvider(KEY, MODEL, cut).answer(PROMPT, signal))).message).toBe(
      'provider returned no answer (MAX_TOKENS)',
    );

    // A reason that does not look like an enum name is not logged.
    const odd = fakeFetch(200, { candidates: [{ finishReason: 'the question was <secret>' }] });
    expect((await failure(createGeminiProvider(KEY, MODEL, odd).answer(PROMPT, signal))).message).toBe(
      'provider returned no answer (unknown reason)',
    );

    for (const body of [null, {}, { candidates: [] }, { candidates: [{ content: { parts: 'x' } }] }, 'not json']) {
      await failure(createGeminiProvider(KEY, MODEL, fakeFetch(200, body)).answer(PROMPT, signal));
    }
  });

  it('stops when the signal aborts', async () => {
    const fetchFn = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason));
        }),
    );
    const controller = new AbortController();
    const pending = createGeminiProvider(KEY, MODEL, fetchFn).answer(PROMPT, controller.signal);
    controller.abort();
    await failure(pending);
  });
});
