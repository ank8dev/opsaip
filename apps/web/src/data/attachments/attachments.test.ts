import { describe, expect, it } from 'vitest';
import {
  NO_CAPABILITIES, acceptAttribute, extensionOf, fileProblem, formatBytes, parseCapabilities, providerLine, typeOf, type PlaceCapabilities,
} from './capabilities';
import { deleteUpload, parseUploadResponse, uploadFile, uploadProblemText } from './upload';

const types = [
  { id: 'image', label: 'Images', mimes: ['image/png', 'image/jpeg'], extensions: ['png', 'jpg', 'jpeg'], maxBytes: 1000 },
  { id: 'text', label: 'Text and code', mimes: ['text/plain'], extensions: ['txt', 'py', 'md'], maxBytes: 500 },
];
const place = (extra: Partial<PlaceCapabilities> = {}): PlaceCapabilities => ({ enabled: true, provider: 'Acme AI', maxFiles: 5, types: types as PlaceCapabilities['types'], ...extra });
const file = (name: string, size = 100, type = '') => ({ name, size, type });

describe('parseCapabilities', () => {
  it('reads both places and lower-cases extensions', () => {
    const c = parseCapabilities({ ask: { enabled: true, provider: 'Gemini', maxFiles: 5, types: [{ ...types[0], extensions: ['.PNG'] }] }, agent: { enabled: false } })!;
    expect(c.ask).toMatchObject({ enabled: true, provider: 'Gemini', maxFiles: 5 });
    expect(c.ask.types[0].extensions).toEqual(['png']);
    expect(c.agent.enabled).toBe(false);
  });
  it('is disabled without types, without a valid limit, or when not enabled', () => {
    expect(parseCapabilities({ ask: { enabled: true, maxFiles: 5, types: [] }, agent: {} })!.ask.enabled).toBe(false);
    expect(parseCapabilities({ ask: { enabled: true, maxFiles: 0, types }, agent: {} })!.ask.enabled).toBe(false);
    expect(parseCapabilities({ ask: { enabled: false, types }, agent: {} })!.ask.enabled).toBe(false);
  });
  it('drops broken types and refuses a non-object', () => {
    const c = parseCapabilities({ ask: { enabled: true, maxFiles: 5, types: [types[0], { id: 'exe' }, 7, { ...types[1], maxBytes: -1 }] }, agent: {} })!;
    expect(c.ask.types).toHaveLength(1);
    expect(parseCapabilities(null)).toBeUndefined();
    expect(NO_CAPABILITIES.ask.enabled).toBe(false);
  });
});

describe('fileProblem: the composer enables only what the server lists', () => {
  it('accepts a listed type within its limit', () => {
    expect(fileProblem(file('a.png', 900), place(), 'ask', 0)).toBeUndefined();
    expect(fileProblem(file('notes.PY', 10), place(), 'agent', 4)).toBeUndefined();
    expect(fileProblem(file('x', 10, 'image/jpeg'), place(), 'ask', 0)).toBeUndefined();
  });
  it('names the configured provider when it does not accept a type, never a hard-coded one', () => {
    const msg = fileProblem(file('clip.mp4'), place({ provider: 'Acme AI' }), 'ask', 0)!;
    expect(msg).toContain('Acme AI');
    expect(msg).toContain('.mp4');
    expect(fileProblem(file('clip.mp4'), place({ provider: 'Other' }), 'ask', 0)).toContain('Other');
  });
  it('refuses SVG, HTML, archives and programs with a reason, even if the server lists them', () => {
    const all = place({ types: [{ ...types[0], extensions: ['svg', 'html', 'zip', 'exe'] }] as PlaceCapabilities['types'] });
    for (const n of ['a.svg', 'a.html', 'a.zip', 'a.exe']) expect(fileProblem(file(n), all, 'agent', 0)).toBeTruthy();
    expect(fileProblem(file('a.svg'), all, 'agent', 0)).toContain('SVG');
  });
  it('enforces the size limit of the type and rejects empty files', () => {
    expect(fileProblem(file('big.png', 1001), place(), 'ask', 0)).toContain('limit');
    expect(fileProblem(file('big.txt', 501), place(), 'ask', 0)).toContain('limit');
    expect(fileProblem(file('e.png', 0), place(), 'ask', 0)).toContain('empty');
  });
  it('allows at most maxFiles', () => {
    expect(fileProblem(file('a.png'), place(), 'ask', 5)).toContain('At most 5');
    expect(fileProblem(file('a.png'), place({ maxFiles: 2 }), 'ask', 2)).toContain('At most 2');
  });
  it('says why when the place is off', () => {
    expect(fileProblem(file('a.png'), place({ enabled: false }), 'ask', 0)).toContain('Ask');
    expect(fileProblem(file('a.png'), place({ enabled: false }), 'agent', 0)).toContain('agent');
  });
});

describe('helpers', () => {
  it('extensionOf ignores paths and dotfiles', () => {
    expect(extensionOf('a/b/c.TXT')).toBe('txt');
    expect(extensionOf('.env')).toBe('');
    expect(extensionOf('noext')).toBe('');
    expect(extensionOf('..\\x.png')).toBe('png');
  });
  it('typeOf matches by extension or mime', () => {
    expect(typeOf(file('a.png'), types as PlaceCapabilities['types'])?.id).toBe('image');
    expect(typeOf(file('a', 1, 'text/plain'), types as PlaceCapabilities['types'])?.id).toBe('text');
    expect(typeOf(file('a.mp4'), types as PlaceCapabilities['types'])).toBeUndefined();
  });
  it('acceptAttribute lists exactly the server types', () => {
    expect(acceptAttribute(place())).toBe('image/png,image/jpeg,.png,.jpg,.jpeg,text/plain,.txt,.py,.md');
  });
  it('providerLine names the provider from the server', () => {
    expect(providerLine({ ask: place({ provider: 'Acme AI' }), agent: NO_CAPABILITIES.agent })).toBe('Files you attach in Ask are sent to Acme AI.');
    expect(providerLine({ ask: place({ provider: null }), agent: NO_CAPABILITIES.agent })).toBeNull();
    expect(providerLine({ ask: place({ enabled: false }), agent: NO_CAPABILITIES.agent })).toBeNull();
  });
  it('formatBytes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5 MB');
  });
});

describe('uploadFile', () => {
  const blob = Object.assign(new Blob(['hi'], { type: 'image/png' }), { name: 'we ird/ñame.png' });
  const signal = new AbortController().signal;
  const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status });

  it('POSTs the raw bytes with the token, purpose and an encoded display name', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const impl = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return json(201, { upload: { id: 'u1', name: 'name.png', mime: 'image/png', kind: 'image', size: 2 } }); }) as unknown as typeof fetch;
    const r = await uploadFile('tok', 'ask', blob, signal, impl);
    expect(r).toMatchObject({ ok: true, upload: { id: 'u1' } });
    expect(calls[0].url).toBe('/v1/uploads?purpose=ask');
    const h = calls[0].init.headers as Record<string, string>;
    expect(h.authorization).toBe('Bearer tok');
    expect(h['x-filename']).toBe(encodeURIComponent('we ird/ñame.png'));
    expect(calls[0].init.body).toBe(blob);
    expect(calls[0].init.redirect).toBe('error');
  });
  it('maps the server refusals, with the server reason for a 400', async () => {
    const get = (status: number, b: unknown = { error: 'content is not a PNG' }) => uploadFile('t', 'agent', blob, signal, (async () => json(status, b)) as unknown as typeof fetch);
    expect(await get(400)).toEqual({ ok: false, problem: 'bad-request', reason: 'content is not a PNG' });
    expect(await get(413)).toEqual({ ok: false, problem: 'too-large' });
    expect(await get(401)).toEqual({ ok: false, problem: 'unauthorized' });
    expect(await get(500)).toEqual({ ok: false, problem: 'server-error' });
    expect(await uploadFile('t', 'ask', blob, signal, (async () => { throw new Error('x'); }) as unknown as typeof fetch)).toEqual({ ok: false, problem: 'unreachable' });
    expect(await get(201, { nope: 1 })).toEqual({ ok: false, problem: 'bad-response' });
  });
  it('parseUploadResponse and texts', () => {
    expect(parseUploadResponse({ upload: { id: '', name: 'a', mime: 'x', kind: 'image', size: 1 } })).toBeUndefined();
    expect(parseUploadResponse({ upload: { id: 'a', name: 'a', mime: 'x', kind: 'exe', size: 1 } })).toBeUndefined();
    expect(uploadProblemText('bad-request', 'why')).toBe('why');
    expect(uploadProblemText('too-large')).toContain('too large');
  });
  it('deleteUpload sends DELETE with the token and never throws', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    await deleteUpload('tok', 'u/1', (async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response(null, { status: 204 }); }) as unknown as typeof fetch);
    expect(calls[0]).toMatchObject({ url: '/v1/uploads/u%2F1', init: { method: 'DELETE' } });
    await expect(deleteUpload('t', 'u', (async () => { throw new Error('x'); }) as unknown as typeof fetch)).resolves.toBeUndefined();
  });
});
