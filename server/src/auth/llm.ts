// The AI model behind POST /v1/ask, and its API key. The key is read here,
// kept in a closure here (auth/gemini.ts) and sent only to the provider. It
// is never logged, never returned and never sent to the browser. Keep every
// line that touches the key in this folder: changes here need a founder
// review (.github/SECURITY_PATHS).
import type { AskProvider } from './askProvider';
import { createGeminiProvider } from './gemini';

/** The providers OPSAIP_LLM_PROVIDER accepts. */
export const LLM_PROVIDERS = ['gemini'] as const;

/**
 * Default model per provider, used when OPSAIP_LLM_MODEL is not set.
 * gemini-3.5-flash-lite: stable (GA, not preview), free of charge on the
 * Gemini API free tier, and Flash-Lite models get a larger free daily quota
 * than Flash. Check https://ai.google.dev/gemini-api/docs/models when it ages.
 */
export const DEFAULT_LLM_MODELS: Readonly<Record<(typeof LLM_PROVIDERS)[number], string>> = {
  gemini: 'gemini-3.5-flash-lite',
};

/** What a startup error says about setting Ask up. */
export const HOW_TO_SET_UP_ASK =
  'Set both OPSAIP_LLM_PROVIDER=gemini and OPSAIP_LLM_KEY=<your API key>, or neither to turn Ask off. See "Ask" in README.md';

// The key travels in an HTTP header: visible ASCII, no spaces.
const KEY_CHARS = /^[\x21-\x7e]{1,512}$/;
// The model id goes into the request URL path: one segment, no "/", "?",
// "#" or "%", and it cannot start with "." (so it is never "." or "..").
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

export type AskProviderFromEnv =
  | { ok: true; provider: AskProvider | undefined }
  | { ok: false; problem: string };

/**
 * Read OPSAIP_LLM_PROVIDER, OPSAIP_LLM_KEY and OPSAIP_LLM_MODEL (pass
 * process.env).
 *
 *   provider and key both unset -> ok, no provider: /v1/ask answers 503
 *   only one of them set        -> problem (the server must not start)
 *   unknown provider, bad key or bad model -> problem
 *
 * An empty or blank variable counts as unset. A problem never contains the
 * key. `fetchImpl` is for tests.
 */
export function askProviderFromEnv(
  env: Readonly<Record<string, string | undefined>>,
  fetchImpl: typeof fetch = globalThis.fetch,
): AskProviderFromEnv {
  const providerName = valueOf(env.OPSAIP_LLM_PROVIDER)?.toLowerCase();
  const key = valueOf(env.OPSAIP_LLM_KEY);
  const model = valueOf(env.OPSAIP_LLM_MODEL);

  if (providerName === undefined && key === undefined) {
    if (model !== undefined) {
      return { ok: false, problem: `OPSAIP_LLM_MODEL is set, but Ask is off. ${HOW_TO_SET_UP_ASK}` };
    }
    return { ok: true, provider: undefined };
  }
  if (providerName === undefined) {
    return { ok: false, problem: `OPSAIP_LLM_KEY is set, but OPSAIP_LLM_PROVIDER is not. ${HOW_TO_SET_UP_ASK}` };
  }
  if (key === undefined) {
    return { ok: false, problem: `OPSAIP_LLM_PROVIDER is set, but OPSAIP_LLM_KEY is not. ${HOW_TO_SET_UP_ASK}` };
  }
  if (providerName !== 'gemini') {
    // The provider name is not secret, but it is not echoed either: a key
    // pasted into the wrong variable must not end up in a log.
    return { ok: false, problem: `OPSAIP_LLM_PROVIDER must be one of: ${LLM_PROVIDERS.join(', ')}` };
  }
  if (!KEY_CHARS.test(key)) {
    return {
      ok: false,
      problem: 'OPSAIP_LLM_KEY must be 1 to 512 visible ASCII characters, without spaces',
    };
  }
  if (model !== undefined && !MODEL_ID.test(model)) {
    return {
      ok: false,
      problem: 'OPSAIP_LLM_MODEL must be a model id like gemini-3.5-flash-lite (letters, digits, ".", "_", "-")',
    };
  }
  return {
    ok: true,
    provider: createGeminiProvider(key, model ?? DEFAULT_LLM_MODELS.gemini, fetchImpl),
  };
}

function valueOf(raw: string | undefined): string | undefined {
  const value = raw?.trim();
  return value === undefined || value === '' ? undefined : value;
}
