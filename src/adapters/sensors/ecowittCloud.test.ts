import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { mapReadingsFromPayload, MappingFile, normalizeRealTimePayload } from "./ecowittCloud.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(__dirname, "__fixtures__", "ecowitt-cloud-real-time.json");
const cloudPayload = JSON.parse(fs.readFileSync(fixturePath, "utf-8")) as any;

test("Ecowitt Cloud payload is normalized to flat canonical keys", () => {
  const { normalizedData, channelsDiscovered } = normalizeRealTimePayload(cloudPayload.data);

  assert.equal(normalizedData.temp1f, "72.9");
  assert.equal(normalizedData.humidity1, "30");
  assert.equal(normalizedData.temp2f, 68.2);
  assert.equal(normalizedData.humidity2, "41");
  assert.equal(normalizedData.tempinf, "70.1");
  assert.equal(normalizedData.humidityin, "33");
  assert.deepEqual(channelsDiscovered, [1, 2]);
});

test("missing mapped channels are skipped while valid sensors are returned", () => {
  const { normalizedData } = normalizeRealTimePayload(cloudPayload.data);
  const mapping: MappingFile = {
    sensors: [
      { id: "kitchen_main", tempKey: "temp1f", humidityKey: "humidity1" },
      { id: "missing_channel", tempKey: "temp9f", humidityKey: "humidity9" }
    ]
  };

  const readings = mapReadingsFromPayload(mapping, normalizedData);

  assert.equal(readings.length, 1);
  assert.deepEqual(readings[0], { sensorId: "kitchen_main", temp_f: 72.9, rh_pct: 30 });
});

test("no mapped readings produces an empty set", () => {
  const mapping: MappingFile = {
    sensors: [{ id: "missing", tempKey: "temp9f", humidityKey: "humidity9" }]
  };

  const readings = mapReadingsFromPayload(mapping, {});
  assert.equal(readings.length, 0);
});
