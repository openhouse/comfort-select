import assert from "node:assert/strict";
import { createServer, Server } from "node:http";
import { after, before, test } from "node:test";
import { AddressInfo } from "node:net";

import { AppConfig, parseDisabledDevices } from "./config.js";
import { actuate, applyDisabledDeviceOverrides } from "./cycle.js";
import { Decision } from "./types.js";

interface CapturedRequest {
  path: string;
  body: any;
}

let server: Server;
let baseUrl = "";
const requests: CapturedRequest[] = [];

before(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      requests.push({
        path: req.url ?? "/",
        body: raw ? JSON.parse(raw) : null
      });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
});

function resetRequests() {
  requests.length = 0;
}

function baseConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    CYCLE_MINUTES: 5,
    TIMEZONE: "America/New_York",
    HOME_LAT: 40,
    HOME_LON: -74,
    OPENAI_API_KEY: "test-key",
    OPENAI_MODEL: "test-model",
    OPENAI_DECISION_MODEL: undefined,
    OPENAI_TIMEOUT_MS: 120_000,
    OPENAI_MAX_RETRIES: 2,
    PROMPT_TEMPLATE_PATH: "./config/prompt/llm-prompt-template.md.hbs",
    SITE_CONFIG_PATH: "./config/site.config.json",
    CURATORS_JSON: undefined,
    GOOGLE_SHEETS_SPREADSHEET_ID: "test-sheet",
    GOOGLE_SHEETS_SHEET_NAME: "TimeSeries",
    GOOGLE_SERVICE_ACCOUNT_JSON: "./fake-creds.json",
    HISTORY_MODE: "window",
    HISTORY_ROWS: 200,
    PROMPT_MAX_CHARS: 120_000,
    PROMPT_HISTORY_MAX_ROWS: 120,
    PROMPT_HISTORY_MAX_MINUTES: 180,
    PROMPT_HISTORY_SUMMARY_MAX_CHARS: 1200,
    SHEET_SYNC_ROWS: 2000,
    HTTP_TIMEOUT_MS: 10_000,
    ACTUATION_REASSERT_EVERY_CYCLE: false,
    DISABLED_DEVICES: [],
    ECOWITT_SOURCE: "mock",
    ECOWITT_GATEWAY_URL: undefined,
    ECOWITT_MAPPING_JSON: "./config/sensors.mapping.json",
    ECOWITT_CLOUD_APPLICATION_KEY: undefined,
    ECOWITT_CLOUD_API_KEY: undefined,
    ECOWITT_CLOUD_DEVICE_MAC: undefined,
    DRY_RUN: false,
    ALEXA_WEBHOOK_URL: `${baseUrl}/alexa`,
    ALEXA_WEBHOOK_TOKEN: undefined,
    MEROSS_WEBHOOK_URL: `${baseUrl}/meross`,
    MEROSS_WEBHOOK_TOKEN: undefined,
    MONGODB_URI: "mongodb://localhost:27017/test",
    MONGODB_DB_NAME: "comfort_select",
    MONGODB_COLLECTION: "cycle_records",
    PORT: 3000,
    ...overrides
  };
}

function onDecision(): Decision {
  return {
    panel: [{ speaker: "test", notes: "all devices on" }],
    actions: {
      kitchen_transom: {
        power: "ON",
        direction: "DIRECT",
        speed: "HIGH",
        auto: false,
        set_temp_f: 70
      },
      bathroom_transom: {
        power: "ON",
        direction: "DIRECT",
        speed: "HIGH",
        auto: false,
        set_temp_f: 70
      },
      kitchen_vornado_630: { power: "ON" },
      living_vornado_630: { power: "ON" }
    },
    hypothesis: "test",
    confidence_0_1: 1,
    predictions: []
  };
}

test("parseDisabledDevices accepts comma-separated device keys and rejects unknown keys", () => {
  assert.deepEqual(parseDisabledDevices(" bathroom_transom, living_vornado_630,bathroom_transom "), [
    "bathroom_transom",
    "living_vornado_630"
  ]);
  assert.deepEqual(parseDisabledDevices(undefined), []);
  assert.throws(() => parseDisabledDevices("not_a_device"), /unknown device key/);
});

test("actuate preserves dry-run behavior when disabled-device overrides are not configured", async () => {
  resetRequests();
  const decision = onDecision();
  const previous = onDecision().actions;
  previous.living_vornado_630 = { power: "OFF" };

  const result = await actuate(baseConfig({ DRY_RUN: true }), decision, "decision-test", previous);

  assert.equal(result.actuation_ok, true);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.applied, previous);
  assert.equal(requests.length, 0);
});

test("actuate preserves skip behavior when reassertion is disabled and requested matches last applied", async () => {
  resetRequests();
  const decision = onDecision();

  const result = await actuate(baseConfig(), decision, "decision-test", decision.actions);

  assert.equal(result.actuation_ok, true);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.applied, decision.actions);
  assert.equal(requests.length, 0);
});

test("actuate reasserts every active device when requested state matches last applied", async () => {
  resetRequests();
  const decision = onDecision();

  const result = await actuate(
    baseConfig({ ACTUATION_REASSERT_EVERY_CYCLE: true }),
    decision,
    "decision-test",
    decision.actions
  );

  assert.equal(result.actuation_ok, true);
  assert.deepEqual(result.errors, []);
  assert.equal(requests.length, 4);
  assert.deepEqual(
    requests.map((request) => request.body.device ?? request.body.plug).sort(),
    ["bathroom_transom", "kitchen_transom", "kitchen_vornado_630", "living_vornado_630"]
  );
});

test("disabled devices are forced OFF, skipped during actuation, and do not create errors", async () => {
  resetRequests();
  const decision = applyDisabledDeviceOverrides(onDecision(), ["bathroom_transom"]);

  assert.deepEqual(decision.actions.bathroom_transom, {
    power: "OFF",
    direction: "EXHAUST",
    speed: "LOW",
    auto: false,
    set_temp_f: 70
  });

  const result = await actuate(
    baseConfig({ ACTUATION_REASSERT_EVERY_CYCLE: true, DISABLED_DEVICES: ["bathroom_transom"] }),
    decision,
    "decision-test",
    onDecision().actions
  );

  assert.equal(result.actuation_ok, true);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.disabled_devices, ["bathroom_transom"]);
  assert.deepEqual(result.applied.bathroom_transom, {
    power: "OFF",
    direction: "EXHAUST",
    speed: "LOW",
    auto: false,
    set_temp_f: 70
  });
  assert.equal(requests.length, 3);
  assert.deepEqual(
    requests.map((request) => request.body.device ?? request.body.plug).sort(),
    ["kitchen_transom", "kitchen_vornado_630", "living_vornado_630"]
  );
});
