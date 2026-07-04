import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";

import { buildTimeoutDispatcherOptions, fetchWithTimeout } from "./fetchWithTimeout.js";

afterEach(() => {
  mock.restoreAll();
});

test("buildTimeoutDispatcherOptions applies configured timeout to Undici phases", () => {
  assert.deepEqual(buildTimeoutDispatcherOptions(12_345), {
    connect: { timeout: 12_345 },
    headersTimeout: 12_345,
    bodyTimeout: 12_345
  });
});

test("fetchWithTimeout passes a dispatcher and enforces total request timeout", async () => {
  let capturedInit: (RequestInit & { dispatcher?: unknown }) | undefined;

  mock.method(globalThis, "fetch", async (_url: string | URL | Request, init?: RequestInit) => {
    capturedInit = init as RequestInit & { dispatcher?: unknown };
    await new Promise((_resolve, reject) => {
      capturedInit?.signal?.addEventListener("abort", () => reject(capturedInit?.signal?.reason), { once: true });
    });
    return new Response(null, { status: 204 });
  });

  await assert.rejects(
    fetchWithTimeout("https://example.invalid/slow", { timeoutMs: 5 }),
    /Request timed out after 5ms/
  );

  assert.ok(capturedInit?.dispatcher, "Undici dispatcher should be passed to fetch");
  assert.equal(capturedInit?.signal?.aborted, true);
});
