// Google Gemini through its REST API (generateContent), with plain fetch:
// no SDK, no new dependency. The API key lives only in this closure and
// travels only in the x-goog-api-key header, never in the URL: URLs end up
// in logs and in error messages.
import {
  ProviderError,
  type AskAttachment,
  type AskCapabilities,
  type AskPrompt,
  type AskProvider,
} from './askProvider';
import { TEXT_EXTENSIONS } from './uploads/fileTypes';

export const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';

/**
 * Upper bound on the model's output, in tokens. On Gemini 3 models it
 * includes the model's thinking, so it must leave room for that as well as
 * for the answer itself.
 */
export const GEMINI_MAX_OUTPUT_TOKENS = 4096;

const MB = 1024 * 1024;

/**
 * What Gemini accepts, from its official docs (read 2026-11; the pages moved
 * from ai.google.dev/gemini-api/docs/... to aistudio.google.com/docs/...):
 *   - Files API guide, https://ai.google.dev/gemini-api/docs/files : use the
 *     Files API when the whole request (files, prompt, system instruction) is
 *     over 100 MB; PDFs are limited to 50 MB; files are kept 48 hours.
 *   - Image understanding, https://ai.google.dev/gemini-api/docs/image-understanding :
 *     PNG, JPEG, WEBP, HEIC, HEIF (no GIF); "inline image data limits your
 *     total request size (text prompts, system instructions, and inline
 *     bytes) to 20MB".
 *   - Video understanding, https://ai.google.dev/gemini-api/docs/video-understanding :
 *     mp4, mpeg, mov, avi, x-flv, mpg, webm, wmv, 3gpp; inline only "under
 *     20MB total request size".
 *   - Document processing, https://ai.google.dev/gemini-api/docs/document-processing :
 *     PDF up to 50 MB or 1000 pages; plain text is read as text.
 * We send every file INLINE (base64: no extra upload call, nothing stored at
 * Google by us). Base64 is 4/3 of the bytes and the 20 MB covers the whole
 * request (the task data is up to 30 KB), so all files of one question
 * together are capped at 14 MB (about 18.7 MB encoded). Per file: images 7
 * MB, text 1 MB (it costs tokens), PDF and video 14 MB.
 */
export const GEMINI_CAPABILITIES: AskCapabilities = {
  maxTotalBytes: 14 * MB,
  types: [
    { id: 'image', label: 'Images', mimes: ['image/png', 'image/jpeg', 'image/webp'], extensions: ['png', 'jpg', 'jpeg', 'webp'], maxBytes: 7 * MB },
    { id: 'video', label: 'Videos', mimes: ['video/mp4', 'video/quicktime', 'video/webm'], extensions: ['mp4', 'mov', 'webm'], maxBytes: 14 * MB },
    { id: 'pdf', label: 'PDF', mimes: ['application/pdf'], extensions: ['pdf'], maxBytes: 14 * MB },
    { id: 'text', label: 'Text and code', mimes: ['text/plain'], extensions: [...TEXT_EXTENSIONS], maxBytes: 1 * MB },
  ],
};

// finishReason / blockReason are enum names like "SAFETY". Logged only if they look like one.
const ENUM_NAME = /^[A-Z_]{1,40}$/;

/**
 * Make a Gemini provider. `model` must already be checked (auth/llm.ts):
 * it goes into the URL path. `fetchImpl` is for tests.
 */
export function createGeminiProvider(
  key: string,
  model: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): AskProvider {
  const url = `${GEMINI_API_BASE}${encodeURIComponent(model)}:generateContent`;

  return {
    name: 'gemini',
    displayName: 'Gemini',
    capabilities: GEMINI_CAPABILITIES,
    model,
    async answer(prompt: AskPrompt, signal: AbortSignal): Promise<string> {
      let response: Response;
      let body: unknown;
      try {
        response = await fetchImpl(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify(requestBody(prompt)),
          signal,
        });
        // Read the body even on an error status, so the connection is
        // released; its text is never logged or returned.
        body = await response.json().catch(() => undefined);
      } catch {
        // Network error or abort. The original error is dropped on purpose:
        // the caller only needs to know it failed (and checks `signal` for a
        // timeout), and an error object can carry request details.
        throw new ProviderError('request to the provider failed');
      }

      if (!response.ok) throw new ProviderError(`provider answered HTTP ${response.status}`);

      const text = answerText(body);
      if (text === undefined) {
        throw new ProviderError(`provider returned no answer (${stopReason(body)})`);
      }
      return text;
    },
  };
}

function requestBody(prompt: AskPrompt): unknown {
  return {
    systemInstruction: { parts: [{ text: prompt.system }] },
    contents: [{ role: 'user', parts: [...(prompt.attachments ?? []).map(filePart), { text: prompt.user }] }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS,
      ...(prompt.responseSchema === undefined
        ? {}
        : { responseMimeType: 'application/json', responseSchema: prompt.responseSchema }),
    },
  };
}

/** A file as an inline part. Gemini calls QuickTime video/mov. */
function filePart(file: AskAttachment): unknown {
  const mimeType = file.mime === 'video/quicktime' ? 'video/mov' : file.mime;
  return { inlineData: { mimeType, data: Buffer.from(file.bytes).toString('base64') } };
}

/**
 * The text of the first candidate: its text parts joined, without "thought"
 * parts. Undefined if there is none (blocked, cut off, unexpected shape).
 */
function answerText(body: unknown): string | undefined {
  const parts = (body as { candidates?: { content?: { parts?: unknown } }[] } | undefined)
    ?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return undefined;
  const text = parts
    .filter(
      (part): part is { text: string } =>
        typeof part === 'object' && part !== null && typeof part.text === 'string' && part.thought !== true,
    )
    .map((part) => part.text)
    .join('')
    .trim();
  return text === '' ? undefined : text;
}

/** Why Gemini stopped without an answer, as a safe enum name, for the log. */
function stopReason(body: unknown): string {
  const b = body as
    | { promptFeedback?: { blockReason?: unknown }; candidates?: { finishReason?: unknown }[] }
    | undefined;
  const reason = b?.promptFeedback?.blockReason ?? b?.candidates?.[0]?.finishReason;
  return typeof reason === 'string' && ENUM_NAME.test(reason) ? reason : 'unknown reason';
}
