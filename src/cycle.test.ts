import assert from "node:assert/strict";
import { createServer, Server } from "node:http";
import { AddressInfo } from "node:net";
import { afterEach, test } from "node:test";

import { AppConfig } from "./config.js";
import { actuate, applyDisabledDeviceOverrides } from "./cycle.js";
import { Decision } from "./types.js";

const servers: Server[] = [];

function buildDecision(): Decision {
  return {
    panel: [],
    actions: {
      kitchen_transom: { power: "ON", direction: "DIRECT", speed: "HIGH", auto: false, set_temp_f: 70 },
      bathroom_transom: { power: "ON", direction: "EXHAUST", speed: "LOW", auto: false, set_temp_f: 70 },
      kitchen_vornado_630: { power: "ON" },
      living_vornado_630: { power: "ON" }
    },
    hypothesis: "test decision",
    confidence_0_1: 0.8,
    predictions: []
  };
}

function buildConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    CYCLE_MINUTES: 5,
    TIMEZONE: "America/New_York",
    HOME_LAT: 40,
    HOME_LON: -73,
    OPENAI_API_KEY: "test-key",
    OPENAI_MODEL: "test-model",
    OPENAI_TIMEOUT_MS: 1000,
    OPENAI_MAX_RETRIES: 0,
    PROMPT_TEMPLATE_PATH: "./config/prompt/llm-prompt-template.md.hbs",
    SITE_CONFIG_PATH: "./config/site.config.json",
    GOOGLE_SHEETS_SPREADSHEET_ID: "sheet-id",
    GOOGLE_SHEETS_SHEET_NAME: "TimeSeries",
    GOOGLE_SERVICE_ACCOUNT_JSON: "./service-account.json",
    HISTORY_MODE: "window",
    HISTORY_ROWS: 200,
    PROMPT_MAX_CHARS: 120_000,
    PROMPT_HISTORY_MAX_ROWS: 120,
    PROMPT_HISTORY_MAX_MINUTES: 180,
    PROMPT_HISTORY_SUMMARY_MAX_CHARS: 1200,
    SHEET_SYNC_ROWS: 2000,
    HTTP_TIMEOUT_MS: 1000,
    ACTUATION_REASSERT_EVERY_CYCLE: false,
    DISABLED_DEVICES: [],
    ECOWITT_SOURCE: "mock",
    ECOWITT_MAPPING_JSON: "./config/sensors.mapping.json",
    DRY_RUN: false,
    MONGODB_URI: "mongodb://localhost:27017/test",
    MONGODB_DB_NAME: "comfort_select",
    MONGODB_COLLECTION: "cycle_records",
    PORT: 3000,
    ...overrides
  };
}

async function startWebhookRecorder(): Promise<{ url: string; bodies: any[] }> {
  const bodies: any[] = [];
  const server = createServer((req, res) => {
    let rawBody = "";
    req.on("data", (chunk) => {
      rawBody += chunk;
    });
    req.on("end", () => {
      bodies.push(JSON.parse(rawBody));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, bodies };
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())))
    )
  );
});

test("actuate preserves skip behavior when reassert is disabled", async () => {
  const alexa = await startWebhookRecorder();
  const meross = await startWebhookRecorder();
  const decision = buildDecision();
  const result = await actuate(
    buildConfig({ ALEXA_WEBHOOK_URL: alexa.url, MEROSS_WEBHOOK_URL: meross.url }),
    decision,
    "decision-test",
    decision.actions
  );

  assert.equal(result.actuation_ok, true);
  assert.deepEqual(result.errors, []);
  assert.equal(alexa.bodies.length, 0, "matching transom states should still skip webhook calls by default");
  assert.equal(meross.bodies.length, 0, "matching plug states should still skip webhook calls by default");
});

test("actuate reasserts matching requested states when enabled", async () => {
  const alexa = await startWebhookRecorder();
  const meross = await startWebhookRecorder();
  const decision = buildDecision();
  const result = await actuate(
    buildConfig({
      ACTUATION_REASSERT_EVERY_CYCLE: true,
      ALEXA_WEBHOOK_URL: alexa.url,
      MEROSS_WEBHOOK_URL: meross.url
    }),
    decision,
    "decision-test",
    decision.actions
  );

  assert.equal(result.actuation_ok, true);
  assert.equal(alexa.bodies.length, 2, "both active transoms should be commanded even when last-applied matches");
  assert.equal(meross.bodies.length, 2, "both active plugs should be commanded even when last-applied matches");
  assert.deepEqual(
    [...alexa.bodies.map((body) => body.device), ...meross.bodies.map((body) => body.plug)].sort(),
    ["bathroom_transom", "kitchen_transom", "kitchen_vornado_630", "living_vornado_630"].sort()
  );
});

test("disabled devices are forced safe OFF and skipped without actuation errors", async () => {
  const alexa = await startWebhookRecorder();
  const meross = await startWebhookRecorder();
  const decision = applyDisabledDeviceOverrides(buildDecision(), ["bathroom_transom"]);
  const result = await actuate(
    buildConfig({
      ACTUATION_REASSERT_EVERY_CYCLE: true,
      DISABLED_DEVICES: ["bathroom_transom"],
      ALEXA_WEBHOOK_URL: alexa.url,
      MEROSS_WEBHOOK_URL: meross.url
    }),
    decision,
    "decision-test",
    buildDecision().actions
  );

  assert.equal(result.actuation_ok, true);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.applied.bathroom_transom, {
    power: "OFF",
    direction: "EXHAUST",
    speed: "LOW",
    auto: false,
    set_temp_f: 70
  });
  assert.deepEqual(decision.actions.bathroom_transom, result.applied.bathroom_transom);
  assert.deepEqual(alexa.bodies.map((body) => body.device), ["kitchen_transom"]);
  assert.deepEqual(meross.bodies.map((body) => body.plug).sort(), ["kitchen_vornado_630", "living_vornado_630"].sort());
});

test("missing Alexa webhook is not an error when all transoms are disabled", async () => {
  const meross = await startWebhookRecorder();
  const decision = applyDisabledDeviceOverrides(buildDecision(), ["kitchen_transom", "bathroom_transom"]);
  const result = await actuate(
    buildConfig({
      DISABLED_DEVICES: ["kitchen_transom", "bathroom_transom"],
      MEROSS_WEBHOOK_URL: meross.url
    }),
    decision,
    "decision-test"
  );

  assert.equal(result.errors.some((error) => error.includes("ALEXA_WEBHOOK_URL")), false);
  assert.deepEqual(result.applied.kitchen_transom, {
    power: "OFF",
    direction: "EXHAUST",
    speed: "LOW",
    auto: false,
    set_temp_f: 70
  });
  assert.deepEqual(result.applied.bathroom_transom, {
    power: "OFF",
    direction: "EXHAUST",
    speed: "LOW",
    auto: false,
    set_temp_f: 70
  });
});

test("missing Alexa webhook is still an error when any transom is active", async () => {
  const meross = await startWebhookRecorder();
  const decision = applyDisabledDeviceOverrides(buildDecision(), ["bathroom_transom"]);
  const result = await actuate(
    buildConfig({
      DISABLED_DEVICES: ["bathroom_transom"],
      MEROSS_WEBHOOK_URL: meross.url
    }),
    decision,
    "decision-test"
  );

  assert.ok(result.errors.includes("Transom actuator skipped: ALEXA_WEBHOOK_URL not configured"));
  assert.equal(result.actuation_ok, false);
});

test("missing Meross webhook is not an error when all plugs are disabled", async () => {
  const alexa = await startWebhookRecorder();
  const decision = applyDisabledDeviceOverrides(buildDecision(), ["kitchen_vornado_630", "living_vornado_630"]);
  const result = await actuate(
    buildConfig({
      DISABLED_DEVICES: ["kitchen_vornado_630", "living_vornado_630"],
      ALEXA_WEBHOOK_URL: alexa.url
    }),
    decision,
    "decision-test"
  );

  assert.equal(result.errors.some((error) => error.includes("MEROSS_WEBHOOK_URL")), false);
  assert.deepEqual(result.applied.kitchen_vornado_630, { power: "OFF" });
  assert.deepEqual(result.applied.living_vornado_630, { power: "OFF" });
});

test("missing Meross webhook is still an error when any plug is active", async () => {
  const alexa = await startWebhookRecorder();
  const decision = applyDisabledDeviceOverrides(buildDecision(), ["living_vornado_630"]);
  const result = await actuate(
    buildConfig({
      DISABLED_DEVICES: ["living_vornado_630"],
      ALEXA_WEBHOOK_URL: alexa.url
    }),
    decision,
    "decision-test"
  );

  assert.ok(result.errors.includes("Plug actuator skipped: MEROSS_WEBHOOK_URL not configured"));
  assert.equal(result.actuation_ok, false);
});

