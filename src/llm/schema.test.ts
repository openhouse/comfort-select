import assert from "node:assert/strict";
import { test } from "node:test";
import { zodTextFormat } from "openai/helpers/zod";
import { buildDecisionSchema } from "./schema.js";

test("comfort decision schema requires every property", () => {
  const format = zodTextFormat(buildDecisionSchema(["Curator"]), "comfort_decision");
  const schema = (format as any).schema as any;

  const propertyKeys = Object.keys(schema.properties ?? {});
  const requiredKeys = (schema.required ?? []).slice().sort();

  assert.deepEqual(requiredKeys, propertyKeys.slice().sort());
  assert.ok(schema.properties.predictions, "predictions property should exist");

  const predictionEntry = schema.properties.predictions.additionalProperties;
  const predictionPropertyKeys = Object.keys(predictionEntry.properties ?? {});
  const predictionRequiredKeys = (predictionEntry.required ?? []).slice().sort();

  assert.deepEqual(predictionRequiredKeys, predictionPropertyKeys.slice().sort());
  assert.equal(predictionEntry.properties.temp_f_delta.nullable, true);
  assert.equal(predictionEntry.properties.rh_pct_delta.nullable, true);
});
