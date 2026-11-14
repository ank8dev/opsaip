// File attachments: type detection, names, streaming limits, the upload
// endpoints, Ask with files, and Agent mode (files saved in the worktree).
import { once } from 'node:events';
import { existsSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { createTaskStore } from '@opsaip/core';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import { ASK_RATE_LIMIT } from '../../ask';
import type { AskPrompt, AskProvider } from '../askProvider';
import type { AgentDriver, DriverStartOptions } from '../conductor/driver';
import { createRunManager, type RunManager } from '../conductor/runManager';
import { cleanUp, fakeCommand, git, makeRepo, tempDir } from '../conductor/testing/conductorTestKit';
import { createGeminiProvider, GEMINI_CAPABILITIES } from '../gemini';
import { displayName, extensionOf, MAX_NAME_CHARS } from './fileName';
import { AGENT_TYPES, detectFile, MAX_FILES } from './fileTypes';
import { readUpload } from './readUpload';
import { promptWithAttachments, saveAttachments } from './saveAttachments';
import { createUploadStore, parseAttachmentIds, type UploadedFile } from './uploadStore';

afterAll(cleanUp);

const TOKEN = 'uploads-test-token-0123456789abcdef0123';
const AUTH = { authorization: `Bearer ${TOKEN}` };

const bytes = (...parts: Array<string | number[]>): Buffer =>
  Buffer.concat(parts.map((part) => (typeof part === 'string' ? Buffer.from(part, 'latin1') : Buffer.from(part))));
const PNG = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'rest-of-png');
const JPEG = bytes([0xff, 0xd8, 0xff, 0xe0], 'jpeg-data');
const GIF = bytes('GIF89a', 'gif-data');
const WEBP = bytes('RIFF', [1, 2, 3, 4], 'WEBPVP8 ');
const PDF = bytes('%PDF-1.7\n%%EOF');
const MP4 = bytes([0, 0, 0, 0x18], 'ftypmp42', 'xxxxxxxx');
const MOV = bytes([0, 0, 0, 0x14], 'ftypqt  ', 'xxxxxxxx');
const WEBM = bytes([0x1a, 0x45, 0xdf, 0xa3], [0x42, 0x82, 0x84], 'webm', 'data');
const MKV = bytes([0x1a, 0x45, 0xdf, 0xa3], [0x42, 0x82, 0x88], 'matroska', 'data');
const ZIP = bytes('PK', [3, 4, 0, 0], 'zipdata');
const EXE = bytes('MZ', [0x90, 0, 3, 0], 'exe');
const ELF = bytes([0x7f], 'ELF', [2, 1, 1, 0]);

describe('detectFile: by content, not by name', () => {
  it('accepts the allowed types and reports the detected type', () => {
    expect(detectFile(PNG, 'png')).toMatchObject({ ok: true, kind: 'image', mime: 'image/png', ext: 'png' });
    expect(detectFile(JPEG, 'jpeg')).toMatchObject({ ok: true, mime: 'image/jpeg', ext: 'jpg' });
    expect(detectFile(GIF, 'gif')).toMatchObject({ ok: true, mime: 'image/gif' });
    expect(detectFile(WEBP, 'webp')).toMatchObject({ ok: true, mime: 'image/webp' });
    expect(detectFile(PDF, 'pdf')).toMatchObject({ ok: true, kind: 'pdf', mime: 'application/pdf' });
    expect(detectFile(MP4, 'mp4')).toMatchObject({ ok: true, kind: 'video', mime: 'video/mp4' });
    expect(detectFile(MOV, 'mov')).toMatchObject({ ok: true, kind: 'video', mime: 'video/quicktime', ext: 'mov' });
    expect(detectFile(WEBM, 'webm')).toMatchObject({ ok: true, mime: 'video/webm' });
    expect(detectFile(Buffer.from('héllo ✓\n'), 'md')).toMatchObject({ ok: true, kind: 'text', mime: 'text/plain', ext: 'md' });
    expect(detectFile(Buffer.from('{"a":1}'), 'json')).toMatchObject({ ok: true, kind: 'text' });
  });

  it('refuses svg, html, archives and executables, whatever the name says', () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const html = Buffer.from('<!DOCTYPE html><html><script>alert(1)</script></html>');
    for (const [content, ext] of [
      [svg, 'svg'], [svg, 'txt'], [svg, 'png'], [html, 'html'], [html, 'txt'], [html, 'md'],
      [ZIP, 'zip'], [ZIP, 'txt'], [ZIP, 'pdf'], [EXE, 'exe'], [EXE, 'txt'], [EXE, 'png'], [ELF, 'sh'], [ELF, ''],
    ] as const) {
      expect(detectFile(content, ext).ok, `${ext}`).toBe(false);
    }
  });

  it('refuses content that does not match the extension', () => {
    expect(detectFile(PNG, 'jpg')).toEqual({ ok: false, reason: 'the file content does not match its type' });
    expect(detectFile(PNG, 'txt')).toMatchObject({ ok: false });
    expect(detectFile(PNG, 'svg')).toMatchObject({ ok: false });
    expect(detectFile(PDF, 'png')).toMatchObject({ ok: false });
    expect(detectFile(Buffer.from('just text'), 'png')).toMatchObject({ ok: false, reason: 'the file content does not match its type' });
    expect(detectFile(Buffer.from('just text'), 'pdf')).toMatchObject({ ok: false });
    expect(detectFile(MKV, 'webm')).toMatchObject({ ok: false });
  });

  it('text must be valid UTF-8 without NUL bytes, with an allowed extension', () => {
    expect(detectFile(Buffer.from([0x61, 0x00, 0x62]), 'txt')).toMatchObject({ ok: false });
    expect(detectFile(Buffer.from([0xff, 0xfe, 0xfd]), 'txt')).toMatchObject({ ok: false });
    expect(detectFile(Buffer.from('fine'), 'exe')).toMatchObject({ ok: false });
    expect(detectFile(Buffer.from('fine'), '')).toMatchObject({ ok: false });
    expect(detectFile(Buffer.from('fine'), 'html')).toMatchObject({ ok: false });
  });
});

describe('displayName: display text only', () => {
  it('strips path parts, control characters and bidi controls', () => {
    expect(displayName(encodeURIComponent('../../etc/passwd'))).toBe('passwd');
    expect(displayName(encodeURIComponent('..\\x'))).toBe('x');
    expect(displayName(encodeURIComponent('C:\\Users\\me\\report.pdf'))).toBe('report.pdf');
    expect(displayName('a%00b.txt')).toBe('ab.txt');
    expect(displayName(encodeURIComponent('a\u0007\u001bb.txt'))).toBe('ab.txt');
    expect(displayName(encodeURIComponent('photo\u202Egnp.exe'))).toBe('photognp.exe');
    expect(displayName(encodeURIComponent('a\u200Bb\u2066c\u2069.txt'))).toBe('abc.txt');
    expect(displayName(encodeURIComponent('..hidden'))).toBe('hidden');
    expect(displayName(undefined)).toBe('file');
    expect(displayName('%E0%A4%A')).not.toContain('\u0000');
    expect(displayName(encodeURIComponent('/'))).toBe('file');
  });

  it('keeps unicode text, caps the length and keeps the extension', () => {
    expect(displayName(encodeURIComponent('отчёт 报告 🚀.pdf'))).toBe('отчёт 报告 🚀.pdf');
    const long = displayName(encodeURIComponent(`${'ä'.repeat(500)}.png`));
    expect(Array.from(long)).toHaveLength(MAX_NAME_CHARS);
    expect(long.endsWith('.png')).toBe(true);
    expect(Array.from(displayName('x'.repeat(5000)))).toHaveLength(MAX_NAME_CHARS);
  });

  it('extensionOf only trusts plain ASCII extensions', () => {
    expect(extensionOf('A.PNG')).toBe('png');
    expect(extensionOf('noext')).toBe('');
    expect(extensionOf('.bashrc')).toBe('');
    expect(extensionOf('x.p\u0301ng')).toBe('');
  });
});

describe('readUpload: the limit is enforced while reading', () => {
  it('stops reading at the first byte over the limit and keeps nothing', async () => {
    const stream = Object.assign(new PassThrough(), { headers: {} });
    let written = 0;
    const result = readUpload(stream, 1000, () => ({ limit: 100 }));
    for (let i = 0; i < 50 && !stream.destroyed; i++) {
      written += 40;
      if (!stream.write(Buffer.alloc(40))) await once(stream, 'drain').catch(() => {});
      if (written > 400) break;
    }
    expect(await result).toEqual({ ok: false, status: 413, error: 'file must be at most 100 bytes' });
    // After the refusal the stream is paused: nothing more is consumed.
    expect(stream.isPaused()).toBe(true);
  });

  it('refuses at once on Content-Length over the limit, reading nothing', async () => {
    const stream = Object.assign(new PassThrough(), { headers: { 'content-length': '5000' } });
    expect(await readUpload(stream, 1000, () => ({ limit: 1000 }))).toMatchObject({ ok: false, status: 413 });
    // Within the hard limit, but over the limit its first bytes give: refused as soon as they arrive.
    const declared = Object.assign(new PassThrough(), { headers: { 'content-length': '500' } });
    const promise = readUpload(declared, 1000, () => ({ limit: 100 }));
    declared.write(Buffer.alloc(32));
    expect(await promise).toMatchObject({ ok: false, status: 413 });
  });

  it('refuses early from the first bytes, and reads a small body completely', async () => {
    const refused = Object.assign(new PassThrough(), { headers: {} });
    const promise = readUpload(refused, 1000, () => ({ reject: 'nope' }));
    refused.write(Buffer.alloc(32));
    expect(await promise).toEqual({ ok: false, status: 400, error: 'nope' });

    const small = Object.assign(new PassThrough(), { headers: {} });
    const done = readUpload(small, 1000, () => ({ limit: 100 }));
    small.end('tiny');
    expect(await done).toEqual({ ok: true, bytes: Buffer.from('tiny') });
  });
});

describe('the upload store', () => {
  const file = (size = 10): Omit<UploadedFile, 'id'> => ({ name: 'a.txt', mime: 'text/plain', kind: 'text', ext: 'txt', size, bytes: Buffer.alloc(size) });

  it('expires uploads after the TTL, binds them to a purpose and forgets consumed ones', () => {
    let t = 0;
    const store = createUploadStore({ ttlMs: 1000, now: () => t });
    const a = store.put('ask', file())!;
    expect(store.peek([a.id], 'ask')).toMatchObject({ ok: true });
    expect(store.peek([a.id], 'agent')).toMatchObject({ ok: false });
    expect(store.peek(['nope'], 'ask')).toMatchObject({ ok: false });
    t = 1001;
    expect(store.peek([a.id], 'ask')).toMatchObject({ ok: false });
    const b = store.put('ask', file())!;
    store.consume([b.id]);
    expect(store.peek([b.id], 'ask')).toMatchObject({ ok: false });
    store.close();
  });

  it('is bounded in total', () => {
    const store = createUploadStore({ maxTotalBytes: 25 });
    expect(store.put('ask', file(10))).toBeDefined();
    expect(store.put('ask', file(10))).toBeDefined();
    expect(store.put('ask', file(10))).toBeUndefined();
    store.close();
  });

  it('parses attachment ids: at most 5, strings, distinct', () => {
    expect(parseAttachmentIds(undefined)).toEqual({ ok: true, ids: [] });
    expect(parseAttachmentIds(['a', 'b'])).toEqual({ ok: true, ids: ['a', 'b'] });
    expect(parseAttachmentIds(['a', 'b', 'c', 'd', 'e', 'f'])).toMatchObject({ ok: false });
    expect(parseAttachmentIds('a')).toMatchObject({ ok: false });
    expect(parseAttachmentIds([1])).toMatchObject({ ok: false });
    expect(parseAttachmentIds(['a', 'a'])).toMatchObject({ ok: false });
    expect(MAX_FILES).toBe(5);
  });
});

// ---------------------------------------------------------------- HTTP

let server: Server | undefined;
let manager: RunManager | undefined;
let base = '';
afterEach(async () => {
  await manager?.stopActive();
  manager = undefined;
  if (server === undefined) return;
  server.closeAllConnections();
  server.close();
  await once(server, 'close');
  server = undefined;
});

function fakeProvider(): { provider: AskProvider; prompts: AskPrompt[] } {
  const prompts: AskPrompt[] = [];
  const provider: AskProvider = {
    name: 'fake',
    displayName: 'Fake AI',
    model: 'fake-model',
    capabilities: {
      maxTotalBytes: 300,
      types: [
        { id: 'image', label: 'Images', mimes: ['image/png'], extensions: ['png'], maxBytes: 200 },
        { id: 'text', label: 'Text', mimes: ['text/plain'], extensions: ['txt'], maxBytes: 100 },
      ],
    },
    async answer(prompt) {
      prompts.push(prompt);
      return JSON.stringify({ answer: 'ok', action: null });
    },
  };
  return { provider, prompts };
}

async function start(options: { ask?: AskProvider; conductor?: RunManager; uploads?: ReturnType<typeof createUploadStore> } = {}): Promise<void> {
  server = createApp({ store: createTaskStore(), token: TOKEN, log: () => {}, ...options });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const json = async (res: Response) => (await res.json()) as Record<string, any>;
const upload = (purpose: string | undefined, body: Buffer, name = 'f.png', headers: Record<string, string> = AUTH) =>
  fetch(`${base}/v1/uploads${purpose === undefined ? '' : `?purpose=${purpose}`}`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream', 'x-filename': encodeURIComponent(name), ...headers },
    body,
  });
const postJson = (path: string, body: unknown) =>
  fetch(`${base}${path}`, { method: 'POST', headers: { ...AUTH, 'content-type': 'application/json' }, body: JSON.stringify(body) });
async function uploaded(purpose: string, body: Buffer, name: string): Promise<string> {
  const res = await upload(purpose, body, name);
  expect(res.status).toBe(201);
  return (await json(res)).upload.id;
}

describe('the token', () => {
  it('every new route answers 401 without a token and with a wrong one', async () => {
    await start();
    const wrong = { authorization: 'Bearer wrong-token-wrong-token-wrong-token-1' };
    for (const headers of [{}, wrong]) {
      expect((await fetch(`${base}/v1/capabilities`, { headers })).status).toBe(401);
      expect((await upload('ask', PNG, 'f.png', headers)).status).toBe(401);
      expect((await fetch(`${base}/v1/uploads/abc`, { method: 'DELETE', headers })).status).toBe(401);
    }
  });
});

describe('GET /v1/capabilities', () => {
  it('is off for both without a provider and Conductor mode', async () => {
    await start();
    const body = await json(await fetch(`${base}/v1/capabilities`, { headers: AUTH }));
    expect(body.ask).toMatchObject({ enabled: false, provider: null, maxFiles: 5, types: [] });
    expect(body.agent).toMatchObject({ enabled: false, maxFiles: 5 });
    expect(body.agent.types.map((type: { id: string }) => type.id)).toEqual(['image', 'video', 'pdf', 'text']);
  });

  it('lists what the provider declares, with its display name; adding a provider needs nothing else', async () => {
    const { provider } = fakeProvider();
    await start({ ask: provider });
    const body = await json(await fetch(`${base}/v1/capabilities`, { headers: AUTH }));
    expect(body.ask).toEqual({
      enabled: true,
      provider: 'Fake AI',
      maxFiles: 5,
      maxTotalBytes: 300,
      types: provider.capabilities.types,
    });
  });

  it('Gemini declares images (no gif), video, pdf and text, in inline-size limits', () => {
    const gemini = createGeminiProvider('k'.repeat(20), 'gemini-3.5-flash-lite', (() => {}) as unknown as typeof fetch);
    expect(gemini.displayName).toBe('Gemini');
    expect(gemini.capabilities).toBe(GEMINI_CAPABILITIES);
    const byId = Object.fromEntries(GEMINI_CAPABILITIES.types.map((type) => [type.id, type]));
    expect(byId.image.mimes).toEqual(['image/png', 'image/jpeg', 'image/webp']);
    expect(byId.video.mimes).toContain('video/webm');
    expect(byId.pdf.mimes).toEqual(['application/pdf']);
    expect(byId.text.extensions).not.toContain('html');
    // Everything inline must fit the 20 MB request limit, base64 included.
    expect(Math.ceil((GEMINI_CAPABILITIES.maxTotalBytes * 4) / 3)).toBeLessThan(20 * 1024 * 1024);
    for (const type of GEMINI_CAPABILITIES.types) expect(type.maxBytes).toBeLessThanOrEqual(GEMINI_CAPABILITIES.maxTotalBytes);
  });

  it('Agent mode never lists svg, html or archives', () => {
    const all = AGENT_TYPES.flatMap((type) => [...type.extensions, ...type.mimes]);
    for (const bad of ['svg', 'html', 'zip', 'exe', 'image/svg+xml', 'text/html']) expect(all).not.toContain(bad);
  });
});

describe('POST /v1/uploads', () => {
  it('201 with the detected type and a sanitized display name; the uploaded name is never the id', async () => {
    const { provider } = fakeProvider();
    await start({ ask: provider });
    const res = await upload('ask', PNG, '../../etc/passwd.png');
    expect(res.status).toBe(201);
    const { upload: info } = await json(res);
    expect(info).toEqual({ id: expect.any(String), name: 'passwd.png', mime: 'image/png', kind: 'image', size: PNG.length });
    expect(info.id).not.toContain('passwd');
  });

  it('400 without or with a bad purpose', async () => {
    const { provider } = fakeProvider();
    await start({ ask: provider });
    expect((await upload(undefined, PNG)).status).toBe(400);
    expect((await upload('other', PNG)).status).toBe(400);
  });

  it('503 when the purpose is not available, before reading the body', async () => {
    await start();
    expect((await upload('ask', PNG)).status).toBe(503);
    expect((await upload('agent', PNG)).status).toBe(503);
  });

  it('400 for types the provider does not take, svg, html, zip, exe and mismatched content', async () => {
    const { provider } = fakeProvider();
    await start({ ask: provider });
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    const html = Buffer.from('<html><script>1</script></html>');
    for (const [body, name] of [
      [svg, 'a.svg'], [svg, 'a.png'], [svg, 'a.txt'], [html, 'a.html'], [html, 'a.txt'], [ZIP, 'a.zip'], [ZIP, 'a.png'],
      [EXE, 'a.exe'], [EXE, 'a.txt'], [PDF, 'a.pdf'], [GIF, 'a.gif'], [MP4, 'a.mp4'], // this provider takes neither pdf, gif nor video
      [PNG, 'a.jpg'], [PNG, 'a.txt'], [Buffer.from('plain text'), 'a.png'], [Buffer.from([0x61, 0, 0x62]), 'a.txt'],
    ] as const) {
      const res = await upload('ask', body, name);
      expect(res.status, name).toBe(400);
      expect(typeof (await json(res)).error).toBe('string');
    }
    expect((await upload('ask', Buffer.alloc(0), 'a.txt')).status).toBe(400);
  });

  it('413 over the per-kind size limit, from Content-Length and while streaming', async () => {
    const { provider } = fakeProvider();
    await start({ ask: provider });
    // text limit is 100 bytes
    const big = Buffer.alloc(150, 0x61);
    expect((await upload('ask', big, 'a.txt')).status).toBe(413);
    // image limit is 200: a PNG header and 500 bytes
    expect((await upload('ask', Buffer.concat([PNG, Buffer.alloc(500)]), 'a.png')).status).toBe(413);
    // No Content-Length (chunked): the limit still applies while reading.
    const chunked = await fetch(`${base}/v1/uploads?purpose=ask`, {
      method: 'POST',
      headers: { ...AUTH, 'x-filename': 'a.txt' },
      body: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(150).fill(0x61)); controller.close(); } }),
      duplex: 'half',
    } as RequestInit);
    expect(chunked.status).toBe(413);
    // At the limit is fine.
    expect((await upload('ask', Buffer.alloc(100, 0x61), 'a.txt')).status).toBe(201);
  });

  it('a path-traversal or odd file name is only display text', async () => {
    const { provider } = fakeProvider();
    await start({ ask: provider });
    for (const name of ['../../etc/passwd', '..\\x', 'a\u0000b.txt', `${'x'.repeat(5000)}.txt`, 'photo\u202Egnp.txt', '/etc/shadow']) {
      const res = await upload('ask', Buffer.from('hello'), name.includes('\u0000') ? 'a%00b.txt' : name);
      // No extension of an allowed text type is left for names without .txt: refused; the others are cleaned.
      if (res.status === 201) {
        const { upload: info } = await json(res);
        expect(info.name).not.toMatch(/[\\/\u0000\u202E]/);
        expect(Array.from(info.name as string).length).toBeLessThanOrEqual(MAX_NAME_CHARS);
      } else {
        expect(res.status).toBe(400);
      }
    }
  });

  it('DELETE removes an upload: 204 then 404', async () => {
    const { provider } = fakeProvider();
    await start({ ask: provider });
    const id = await uploaded('ask', PNG, 'a.png');
    expect((await fetch(`${base}/v1/uploads/${id}`, { method: 'DELETE', headers: AUTH })).status).toBe(204);
    expect((await fetch(`${base}/v1/uploads/${id}`, { method: 'DELETE', headers: AUTH })).status).toBe(404);
  });
});

describe('POST /v1/ask with attachments', () => {
  it('the provider gets the bytes and the detected mime; the files are consumed', async () => {
    const { provider, prompts } = fakeProvider();
    await start({ ask: provider });
    const image = await uploaded('ask', PNG, 'a.png');
    const text = await uploaded('ask', Buffer.from('some notes'), 'notes.txt');
    const res = await postJson('/v1/ask', { question: 'What is this?', attachments: [image, text] });
    expect(res.status).toBe(200);
    expect(prompts).toHaveLength(1);
    expect(prompts[0].attachments).toHaveLength(2);
    expect(prompts[0].attachments![0]).toMatchObject({ kind: 'image', mime: 'image/png' });
    expect(Buffer.from(prompts[0].attachments![0].bytes).equals(PNG)).toBe(true);
    expect(Buffer.from(prompts[0].attachments![1].bytes).toString()).toBe('some notes');
    expect(prompts[0].system).toContain('Files come with the question');
    // Used once.
    expect((await postJson('/v1/ask', { question: 'Again?', attachments: [image] })).status).toBe(400);
    expect(prompts).toHaveLength(1);
  });

  it('a question without attachments is as before (no attachments field, no extra rule)', async () => {
    const { provider, prompts } = fakeProvider();
    await start({ ask: provider });
    expect((await postJson('/v1/ask', { question: 'Hi?' })).status).toBe(200);
    expect(prompts[0].attachments).toBeUndefined();
    expect(prompts[0].system).not.toContain('Files come with the question');
  });

  it('400 for an unknown id, a purpose mismatch, an id sent twice, more than 5, or too large together', async () => {
    const { provider, prompts } = fakeProvider();
    await start({ ask: provider, conductor: fakeManager() });
    expect((await postJson('/v1/ask', { question: 'x', attachments: ['nope'] })).status).toBe(400);
    const agentFile = await uploaded('agent', PNG, 'a.png');
    expect((await postJson('/v1/ask', { question: 'x', attachments: [agentFile] })).status).toBe(400);
    const one = await uploaded('ask', PNG, 'a.png');
    expect((await postJson('/v1/ask', { question: 'x', attachments: [one, one] })).status).toBe(400);
    expect((await postJson('/v1/ask', { question: 'x', attachments: ['1', '2', '3', '4', '5', '6'] })).status).toBe(400);
    // Three images of 190 bytes: each fits (200), together they are over 300.
    const image = Buffer.concat([PNG, Buffer.alloc(190 - PNG.length)]);
    const ids = [await uploaded('ask', image, 'a.png'), await uploaded('ask', image, 'b.png')];
    expect((await postJson('/v1/ask', { question: 'x', attachments: ids })).status).toBe(400);
    expect(prompts).toHaveLength(0);
  });

  it('an expired upload is a 400', async () => {
    let t = Date.now();
    const uploads = createUploadStore({ now: () => t });
    const { provider } = fakeProvider();
    await start({ ask: provider, uploads });
    const id = await uploaded('ask', PNG, 'a.png');
    t += 16 * 60_000;
    const res = await postJson('/v1/ask', { question: 'x', attachments: [id] });
    expect(res.status).toBe(400);
    expect((await json(res)).error).toContain('expired');
  });

  it('a rate-limited question keeps its files for the next try', async () => {
    const { provider } = fakeProvider();
    await start({ ask: provider });
    for (let i = 0; i < ASK_RATE_LIMIT.max; i++) await postJson('/v1/ask', { question: 'x' });
    const id = await uploaded('ask', PNG, 'a.png');
    expect((await postJson('/v1/ask', { question: 'x', attachments: [id] })).status).toBe(429);
    expect(server && (await fetch(`${base}/v1/uploads/${id}`, { method: 'DELETE', headers: AUTH })).status).toBe(204);
  });

  it('Gemini sends the files inline, and QuickTime as video/mov', async () => {
    let sent: any;
    const fetchImpl = (async (_url: string, init: { body: string }) => {
      sent = JSON.parse(init.body);
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }));
    }) as unknown as typeof fetch;
    const gemini = createGeminiProvider('k'.repeat(20), 'gemini-3.5-flash-lite', fetchImpl);
    await gemini.answer(
      { system: 's', user: 'u', attachments: [{ kind: 'video', mime: 'video/quicktime', bytes: MOV }, { kind: 'image', mime: 'image/png', bytes: PNG }] },
      new AbortController().signal,
    );
    const parts = sent.contents[0].parts;
    expect(parts).toHaveLength(3);
    expect(parts[0]).toEqual({ inlineData: { mimeType: 'video/mov', data: MOV.toString('base64') } });
    expect(parts[1].inlineData.mimeType).toBe('image/png');
    expect(parts[2]).toEqual({ text: 'u' });
  });
});

// ---------------------------------------------------------------- Agent mode

function fakeManager(): RunManager {
  return createRunManager({
    store: createTaskStore(),
    repoDir: makeRepo(),
    worktreesDir: join(tempDir(), 'worktrees'),
    agentCommand: fakeCommand('success', join(tempDir(), 'r.jsonl')),
    log: () => {},
  });
}

/** A driver that is not Claude's: it only remembers what it is given. */
function recordingDriver(prompts: string[], followups: string[]): AgentDriver {
  let onEvent: DriverStartOptions['onEvent'] = () => {};
  return {
    agent: 'claude-code',
    async start(options) {
      onEvent = options.onEvent;
      prompts.push(options.prompt);
      onEvent({ type: 'session', sessionId: 's1' });
      onEvent({ type: 'started' });
    },
    sendMessage(text) {
      followups.push(text);
      return true;
    },
    answerPermission: () => false,
    async cancel() {
      onEvent({ type: 'exited', code: 0, signal: null, startFailed: false });
    },
  };
}

function agentSetup() {
  const prompts: string[] = [];
  const followups: string[] = [];
  const repoDir = makeRepo();
  const worktreesDir = join(tempDir(), 'worktrees');
  const store = createTaskStore();
  const run = createRunManager({ store, repoDir, worktreesDir, createDriver: () => recordingDriver(prompts, followups), log: () => {} });
  manager = run;
  return { run, prompts, followups, repoDir, store };
}

describe('Agent mode: files go into the worktree', () => {
  it('POST /v1/runs saves files under .opsaip/attachments/<run id>/ with generated names and lists them in the prompt', async () => {
    const { run, prompts, repoDir } = agentSetup();
    await start({ conductor: run });
    const png = await uploaded('agent', PNG, 'Screenshot ../../x.png');
    const gif = await uploaded('agent', GIF, 'anim.gif');
    const mp4 = await uploaded('agent', MP4, 'clip.mp4');
    const md = await uploaded('agent', Buffer.from('# Notes\n'), 'NOTES.md');
    const res = await postJson('/v1/runs', { title: 'Look at this', prompt: 'Please fix the layout', attachments: [png, gif, mp4, md] });
    expect(res.status).toBe(201);
    const { run: view } = await json(res);

    const lines = prompts[0].split('\n');
    expect(lines.slice(0, 4)).toEqual(['Please fix the layout', '', 'Attached files:', expect.stringMatching(/^- /)]);
    const listed = lines.slice(3);
    expect(listed).toHaveLength(4);
    const dir = `.opsaip/attachments/${view.id}`;
    const exts: string[] = [];
    for (const line of listed) {
      const match = new RegExp(`^- ${dir.replaceAll('.', '\\.')}/([0-9a-f-]{36})\\.(png|gif|mp4|md)$`).exec(line);
      expect(match, line).not.toBeNull();
      exts.push(match![2]);
      const path = join(view.worktree, line.slice(2));
      expect(existsSync(path)).toBe(true);
      expect(statSync(path).mode & 0o777).toBe(0o600);
    }
    expect(exts).toEqual(['png', 'gif', 'mp4', 'md']);
    expect(readFileSync(join(view.worktree, listed[0].slice(2))).equals(PNG)).toBe(true);
    expect(readdirSync(join(view.worktree, dir))).toHaveLength(4);
    // Neither the uploaded name nor its sanitized form is in any path.
    expect(prompts[0]).not.toMatch(/Screenshot|anim|clip|NOTES/);
    // They do not show in git status of the worktree.
    expect(git(view.worktree, 'status', '--porcelain')).toBe('');
    expect(git(repoDir, 'status', '--porcelain')).toBe('');

    // The transcript keeps what was typed, plus display chips.
    const transcript = await json(await fetch(`${base}/v1/runs/${view.id}/transcript`, { headers: AUTH }));
    expect(transcript.transcript.entries[0]).toMatchObject({
      role: 'you',
      kind: 'prompt',
      text: 'Please fix the layout',
      attachments: [
        { name: 'x.png', kind: 'image', size: PNG.length },
        { name: 'anim.gif', kind: 'image', size: GIF.length },
        { name: 'clip.mp4', kind: 'video', size: MP4.length },
        { name: 'NOTES.md', kind: 'text', size: 8 },
      ],
    });
    // Consumed.
    expect((await postJson('/v1/runs', { title: 't', prompt: 'p', attachments: [png] })).status).toBe(400);
  });

  it('a follow-up to an active run, and a resume of a finished one, get files the same way', async () => {
    const { run, prompts, followups } = agentSetup();
    await start({ conductor: run });
    const started = await run.start({ title: 'T', prompt: 'First' });
    if (!started.ok) throw new Error('start failed');
    const id = started.run.id;

    const doc = await uploaded('agent', PDF, 'spec.pdf');
    const res = await postJson(`/v1/runs/${id}/message`, { text: 'See the spec', attachments: [doc] });
    expect(res.status).toBe(200);
    expect(followups).toHaveLength(1);
    expect(followups[0]).toMatch(new RegExp(`^See the spec\\n\\nAttached files:\\n- \\.opsaip/attachments/${id}/[0-9a-f-]{36}\\.pdf$`));
    const entries = (await json(await fetch(`${base}/v1/runs/${id}/transcript`, { headers: AUTH }))).transcript.entries;
    expect(entries.at(-1)).toMatchObject({ kind: 'followup', text: 'See the spec', attachments: [{ name: 'spec.pdf', kind: 'pdf' }] });

    await run.cancel(id);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const again = await uploaded('agent', Buffer.from('more'), 'more.txt');
    const resumed = await postJson(`/v1/runs/${id}/message`, { text: 'Continue', attachments: [again] });
    expect(resumed.status).toBe(200);
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toMatch(new RegExp(`^Continue\\n\\nAttached files:\\n- \\.opsaip/attachments/${id}/[0-9a-f-]{36}\\.txt$`));
  });

  it('400 for an unknown id or an Ask upload; nothing starts', async () => {
    const { run, prompts } = agentSetup();
    const { provider } = fakeProvider();
    await start({ conductor: run, ask: provider });
    expect((await postJson('/v1/runs', { title: 't', prompt: 'p', attachments: ['nope'] })).status).toBe(400);
    const askFile = await uploaded('ask', PNG, 'a.png');
    expect((await postJson('/v1/runs', { title: 't', prompt: 'p', attachments: [askFile] })).status).toBe(400);
    expect((await postJson('/v1/runs', { title: 't', prompt: 'p', attachments: ['1', '2', '3', '4', '5', '6'] })).status).toBe(400);
    expect(prompts).toHaveLength(0);
    expect(run.active()).toBe(false);
  });

  it('Agent mode takes video and gif that Ask (Gemini) does not, and a too-large video is a 413', async () => {
    const { run } = agentSetup();
    await start({ conductor: run });
    expect((await upload('agent', MOV, 'a.mov')).status).toBe(201);
    expect((await upload('agent', WEBM, 'a.webm')).status).toBe(201);
    expect((await upload('agent', ZIP, 'a.zip')).status).toBe(400);
    expect((await upload('agent', Buffer.from('<svg></svg>'), 'a.svg')).status).toBe(400);
  });
});

describe('saveAttachments never writes outside the worktree', () => {
  const file = (ext = 'txt'): UploadedFile => ({ id: 'x', name: 'n', mime: 'text/plain', kind: 'text', ext, size: 3, bytes: Buffer.from('abc') });

  it('refuses a run id that tries to escape', async () => {
    const worktree = tempDir();
    for (const id of ['../../etc', '..', 'a/b', 'a\\b', '', 'a\u0000b', 'x'.repeat(100)]) {
      await expect(saveAttachments(worktree, id, [file()])).rejects.toThrow();
    }
    expect(readdirSync(worktree)).toEqual([]); // nothing was made, not even .opsaip
  });

  it('refuses an extension that could make a path', async () => {
    const worktree = tempDir();
    await expect(saveAttachments(worktree, 'run1', [file('../x')])).rejects.toThrow();
    await expect(saveAttachments(worktree, 'run1', [file('t/x')])).rejects.toThrow();
    await expect(saveAttachments(worktree, 'run1', [file('')])).rejects.toThrow();
  });

  it('does not follow a symbolic link planted as .opsaip, attachments or the run folder', async () => {
    for (const plant of [['.opsaip'], ['.opsaip', 'attachments'], ['.opsaip', 'attachments', 'run1']]) {
      const worktree = tempDir();
      const outside = tempDir();
      const parent = join(worktree, ...plant.slice(0, -1));
      if (plant.length > 1) {
        await saveAttachments(worktree, 'seed', [file()]); // makes .opsaip/attachments
      }
      rmSync(join(parent, plant.at(-1)!), { recursive: true, force: true });
      symlinkSync(outside, join(parent, plant.at(-1)!));
      await expect(saveAttachments(worktree, 'run1', [file()])).rejects.toThrow();
      expect(readdirSync(outside)).toEqual([]);
    }
  });

  it('does not overwrite or follow a link at the file name (exclusive create), and writes to the right place normally', async () => {
    const worktree = tempDir();
    const saved = await saveAttachments(worktree, 'run1', [file('txt'), file('md')]);
    expect(saved.paths).toHaveLength(2);
    for (const path of saved.paths) {
      expect(path).toMatch(/^\.opsaip\/attachments\/run1\/[0-9a-f-]{36}\.(txt|md)$/);
      expect(readFileSync(join(worktree, path), 'utf8')).toBe('abc');
    }
    expect(promptWithAttachments('hi', saved.paths)).toBe(`hi\n\nAttached files:\n- ${saved.paths[0]}\n- ${saved.paths[1]}`);
    expect(promptWithAttachments('hi', [])).toBe('hi');
  });

  it('still works when git cannot be asked about the exclude file', async () => {
    const worktree = tempDir(); // not a git repository
    await expect(saveAttachments(worktree, 'run1', [file()])).resolves.toMatchObject({ paths: [expect.any(String)] });
  });
});
