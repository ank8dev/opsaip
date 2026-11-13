// Google Gemini through its REST API (generateContent), with plain fetch:
// no SDK, no new dependency. The API key lives only in this closure and
// travels only in the x-goog-api-key header, never in the URL: URLs end up
// in logs and in error messages.
import { ProviderError, type AskPrompt, type AskProvider } from './askProvider';

export const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';

/**
 * Upper bound on the model's output, in tokens. On Gemini 3 models it
 * includes the model's thinking, so it must leave room for that as well as
 * for the answer itself.
 */
export const GEMINI_MAX_OUTPUT_TOKENS = 2048;

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
    contents: [{ role: 'user', parts: [{ text: prompt.user }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS },
  };
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
