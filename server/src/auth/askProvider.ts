// The interface between /v1/ask and a model provider. A provider object
// holds its API key in a closure; nothing outside auth/ can read the key.

/** The kinds of file a person can attach. */
export type FileKind = 'image' | 'video' | 'pdf' | 'text';

/**
 * One kind of file a provider accepts (or Agent mode accepts), as
 * GET /v1/capabilities lists it. `mimes` are DETECTED types (auth/uploads),
 * `extensions` are lower case without the dot.
 */
export interface FileTypeCapability {
  id: FileKind;
  /** For people: "Images". */
  label: string;
  mimes: string[];
  extensions: string[];
  /** Largest file of this kind, in bytes. */
  maxBytes: number;
}

/** What files a provider takes. An empty `types` means it takes none. */
export interface AskCapabilities {
  types: FileTypeCapability[];
  /** Largest size of all files of one question together, in bytes. */
  maxTotalBytes: number;
}

/** A file sent along with a question. Never logged. */
export interface AskAttachment {
  kind: FileKind;
  /** The detected type, one of the provider's capability mimes. */
  mime: string;
  bytes: Uint8Array;
}

/** What /v1/ask sends to the model: the rules, and the data with the question. */
export interface AskPrompt {
  system: string;
  user: string;
  /** When set, the model must reply with JSON that matches this schema (Gemini responseSchema). */
  responseSchema?: object;
  /** Files of the question, already checked against `capabilities`. The provider sends them inline or through its file API. */
  attachments?: readonly AskAttachment[];
}

/**
 * A model provider. It holds the API key itself; the rest of the server
 * sees only this object and cannot read the key.
 */
export interface AskProvider {
  /** "gemini". Safe to log. */
  readonly name: string;
  /** For people, shown in the web app: "Gemini". */
  readonly displayName: string;
  /** The file types and sizes this provider accepts. Adding a provider needs no web change. */
  readonly capabilities: AskCapabilities;
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
