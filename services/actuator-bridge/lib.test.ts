import assert from "node:assert/strict";
import { test } from "node:test";

import { buildRoutineCandidateKeys } from "./lib.js";

test("buildRoutineCandidateKeys includes power-only bedroom ceiling fan ON/OFF keys", () => {
  assert.ok(buildRoutineCandidateKeys("BEDROOM_CEILING_FAN", { power: "ON" }).includes("BEDROOM_CEILING_FAN|ON"));
  assert.ok(buildRoutineCandidateKeys("BEDROOM_CEILING_FAN", { power: "OFF" }).includes("BEDROOM_CEILING_FAN|OFF"));
});
