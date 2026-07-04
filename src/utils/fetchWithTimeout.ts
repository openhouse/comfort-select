import { Agent, Dispatcher } from "undici";

type FetchOptions = NonNullable<Parameters<typeof fetch>[1]> & { dispatcher?: Dispatcher };

const dispatchersByTimeout = new Map<number, Dispatcher>();

export function buildTimeoutDispatcherOptions(timeoutMs: number) {
  return {
    connect: { timeout: timeoutMs },
    headersTimeout: timeoutMs,
    bodyTimeout: timeoutMs
  };
}

function dispatcherForTimeout(timeoutMs: number): Dispatcher {
  const existing = dispatchersByTimeout.get(timeoutMs);
  if (existing) return existing;

  const dispatcher = new Agent(buildTimeoutDispatcherOptions(timeoutMs));
  dispatchersByTimeout.set(timeoutMs, dispatcher);
  return dispatcher;
}

export async function fetchWithTimeout(url: string, opts: FetchOptions & { timeoutMs?: number } = {}) {
  const { timeoutMs = 10_000, signal, ...rest } = opts;

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error(`Request timed out after ${timeoutMs}ms`)),
    timeoutMs
  );
  timeout.unref?.();

  const combinedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;

  try {
    return await fetch(url, {
      ...rest,
      dispatcher: rest.dispatcher ?? dispatcherForTimeout(timeoutMs),
      signal: combinedSignal
    } as FetchOptions & { dispatcher: Dispatcher });
  } finally {
    clearTimeout(timeout);
  }
}
