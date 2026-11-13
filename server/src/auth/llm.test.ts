import { describe, expect, it, vi } from 'vitest';
import { askProviderFromEnv, DEFAULT_LLM_MODELS, HOW_TO_SET_UP_ASK } from './llm';

const KEY = 'AIza-llm-test-SECRET-key-0123456789';

function problemOf(env: Record<string, string>): string {
  const result = askProviderFromEnv(env, vi.fn());
  if (result.ok) throw new Error('expected a problem');
  return result.problem;
}

describe('askProviderFromEnv', () => {
  it('Ask is off when provider and key are both unset, empty or blank', () => {
    expect(askProviderFromEnv({}, vi.fn())).toEqual({ ok: true, provider: undefined });
    expect(askProviderFromEnv({ OPSAIP_LLM_PROVIDER: '', OPSAIP_LLM_KEY: ' ' }, vi.fn())).toEqual({
      ok: true,
      provider: undefined,
    });
  });

  it('makes a Gemini provider with the default model', () => {
    const result = askProviderFromEnv({ OPSAIP_LLM_PROVIDER: 'gemini', OPSAIP_LLM_KEY: KEY }, vi.fn());
    expect(result.ok && result.provider).toMatchObject({ name: 'gemini', model: DEFAULT_LLM_MODELS.gemini });
    expect(DEFAULT_LLM_MODELS.gemini).toBe('gemini-3.5-flash-lite');
  });

  it('reads OPSAIP_LLM_MODEL, trims values and ignores the provider name case', () => {
    const result = askProviderFromEnv(
      { OPSAIP_LLM_PROVIDER: ' Gemini ', OPSAIP_LLM_KEY: ` ${KEY}\n`, OPSAIP_LLM_MODEL: ' gemini-3.8-flash ' },
      vi.fn(),
    );
    expect(result.ok && result.provider).toMatchObject({ name: 'gemini', model: 'gemini-3.8-flash' });
  });

  it('the provider object does not expose the key', () => {
    const result = askProviderFromEnv({ OPSAIP_LLM_PROVIDER: 'gemini', OPSAIP_LLM_KEY: KEY }, vi.fn());
    expect(JSON.stringify(result)).not.toContain(KEY);
    expect(Object.values(result.ok ? result.provider! : {})).not.toContain(KEY);
  });

  it('a partial setup is a problem that says how to fix it', () => {
    const keyOnly = problemOf({ OPSAIP_LLM_KEY: KEY });
    expect(keyOnly).toContain('OPSAIP_LLM_PROVIDER is not');
    expect(keyOnly).toContain(HOW_TO_SET_UP_ASK);

    const providerOnly = problemOf({ OPSAIP_LLM_PROVIDER: 'gemini' });
    expect(providerOnly).toContain('OPSAIP_LLM_KEY is not');
    expect(providerOnly).toContain(HOW_TO_SET_UP_ASK);

    expect(problemOf({ OPSAIP_LLM_MODEL: 'gemini-3.8-flash' })).toContain('Ask is off');
  });

  it('refuses an unknown provider without echoing the value', () => {
    // E.g. the key pasted into the wrong variable.
    const problem = problemOf({ OPSAIP_LLM_PROVIDER: KEY, OPSAIP_LLM_KEY: 'x' });
    expect(problem).toBe('OPSAIP_LLM_PROVIDER must be one of: gemini');
    expect(problem).not.toContain(KEY);
  });

  it('refuses a key that cannot travel in a header, without echoing it', () => {
    const bad = 'SECRET with spaces';
    const problem = problemOf({ OPSAIP_LLM_PROVIDER: 'gemini', OPSAIP_LLM_KEY: bad });
    expect(problem).toContain('OPSAIP_LLM_KEY must be');
    expect(problem).not.toContain(bad);
    expect(problemOf({ OPSAIP_LLM_PROVIDER: 'gemini', OPSAIP_LLM_KEY: 'é'.repeat(5) })).toContain('ASCII');
    expect(problemOf({ OPSAIP_LLM_PROVIDER: 'gemini', OPSAIP_LLM_KEY: 'a'.repeat(513) })).toContain('512');
  });

  it('refuses a model id that could change the request URL', () => {
    for (const model of ['../tunedModels/x', 'a/b', 'a?key=1', 'a%2f', '-x', 'a b', 'x'.repeat(101)]) {
      expect(
        problemOf({ OPSAIP_LLM_PROVIDER: 'gemini', OPSAIP_LLM_KEY: KEY, OPSAIP_LLM_MODEL: model }),
      ).toContain('OPSAIP_LLM_MODEL must be');
    }
  });
});
