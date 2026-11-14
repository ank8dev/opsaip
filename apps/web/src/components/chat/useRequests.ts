import { useCallback, useEffect, useRef, useState } from 'react';

/** Give up on a request after this long (the server answers or fails well before). */
export const REQUEST_TIMEOUT_MS = 30_000;

export interface RequestOptions {
  /** A background request (a poll, a check): it does not make the composer busy. */
  quiet?: boolean;
}

/**
 * Runs the chat's requests to the server: each has a timeout, and leaving the
 * page aborts every one still on its way. `busy` is true while a non-quiet
 * request is in flight. `request` resolves to undefined when the page was left
 * meanwhile, so callers know not to touch the thread any more.
 */
export function useRequests() {
  const [count, setCount] = useState(0);
  const live = useRef(new Set<AbortController>());

  useEffect(() => {
    const controllers = live.current;
    return () => {
      for (const c of controllers) c.abort();
      controllers.clear();
    };
  }, []);

  const request = useCallback(
    async <T,>(call: (signal: AbortSignal) => Promise<T>, { quiet = false }: RequestOptions = {}): Promise<T | undefined> => {
      const c = new AbortController();
      live.current.add(c);
      const timer = window.setTimeout(() => c.abort(), REQUEST_TIMEOUT_MS);
      if (!quiet) setCount((n) => n + 1);
      try {
        const result = await call(c.signal);
        return live.current.has(c) ? result : undefined;
      } finally {
        window.clearTimeout(timer);
        live.current.delete(c);
        if (!quiet) setCount((n) => n - 1);
      }
    },
    [],
  );

  return { busy: count > 0, request };
}

export type Requests = ReturnType<typeof useRequests>;
