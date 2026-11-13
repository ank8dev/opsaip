// The interface between /v1/ask and a model provider. A provider object
// holds its API key in a closure; nothing outside auth/ can read the key.

/** What /v1/ask sends to the model: the rules, and the data with the question. */
export interface AskPrompt {
  system: string;
  user: string;
}

/**
 * A model provider. It holds the API key itself; the rest of the server
 * sees only this object and cannot read the key.
 */
export interface AskProvider {
  /** "gemini". Safe to log. */
  readonly name: string;
  /** The model id, e.g. "gemini-3.5-flash-lite". Safe to log. */
  readonly model: string;
  /**
   * The model's answer as plain text. Rejects with a ProviderError when the
   * provider fails; stops when `signal` aborts.
   */
  answer(prompt: AskPrompt, signal: AbortSignal): Promise<string>;
}

/**
 * The provider failed. The message is safe to log: it holds only an HTTP
 * status code or a fixed reason, never the provider's response body, the
 * prompt or the key.
 */
export class ProviderError extends Error {
  override name = 'ProviderError';
}
