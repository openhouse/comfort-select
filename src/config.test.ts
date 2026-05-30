import assert from "node:assert/strict";
import { test } from "node:test";

import { parseDisabledDevices } from "./config.js";

test("parseDisabledDevices trims whitespace and deduplicates device keys", () => {
  assert.deepEqual(parseDisabledDevices(" bathroom_transom, living_vornado_630,bathroom_transom "), [
    "bathroom_transom",
    "living_vornado_630"
  ]);
});

test("parseDisabledDevices rejects unknown device keys", () => {
  assert.throws(() => parseDisabledDevices("not_a_device"), /Invalid DISABLED_DEVICES value\(s\): not_a_device/);
});
