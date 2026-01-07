type FetchOptions = Parameters<typeof fetch>[1];

export async function fetchWithTimeout(url: string, opts: FetchOptions & { timeoutMs?: number } = {}) {
  const { timeoutMs = 10_000, signal, ...rest } = opts;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);

  try {
    return await fetch(url, { ...rest, signal: signal ?? controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}
