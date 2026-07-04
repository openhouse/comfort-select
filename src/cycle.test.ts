import assert from "node:assert/strict";
import { createServer, Server } from "node:http";
import { AddressInfo } from "node:net";
import { afterEach, test } from "node:test";

import { AppConfig } from "./config.js";
import { actuate, applyDisabledDeviceOverrides, runCycleOnce } from "./cycle.js";
import { loadPromptAssets } from "./promptAssets.js";
import { summarizeTelemetry } from "./utils/telemetry.js";
import { ActuationResult, CycleRecord, Decision, SensorsNow, WeatherNow } from "./types.js";

const servers: Server[] = [];
const promptAssets = loadPromptAssets({
  siteConfigPath: "./config/site.config.json",
  promptTemplatePath: "./config/prompt/llm-prompt-template.md.hbs"
});

function buildDecision(): Decision {
  return {
    panel: [],
    actions: {
      kitchen_transom: { power: "ON", direction: "DIRECT", speed: "HIGH", auto: false, set_temp_f: 70 },
      bathroom_transom: { power: "ON", direction: "EXHAUST", speed: "LOW", auto: false, set_temp_f: 70 },
      kitchen_vornado_630: { power: "ON" },
      living_vornado_630: { power: "ON" },
      bedroom_ceiling_fan: { power: "ON" }
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
    WEATHER_STALE_MAX_MINUTES: 360,
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

function buildSensorsNow(timestamp = new Date().toISOString()): SensorsNow {
  return {
    observation_time_utc: timestamp,
    readings: promptAssets.siteConfig.sensors.map((sensor, idx) => ({
      sensorId: sensor.id,
      temp_f: 72 + idx * 0.2,
      rh_pct: 45 + idx * 0.1
    }))
  };
}

function buildWeatherNow(timestamp = new Date().toISOString(), overrides: Partial<WeatherNow> = {}): WeatherNow {
  return {
    temp_f: 65,
    rh_pct: 48,
    wind_mph: 3,
    wind_dir_deg: 180,
    precip_in_hr: 0,
    observation_time_utc: timestamp,
    conditions: "clear",
    source: "open_meteo",
    ...overrides
  };
}

function buildHistoryRecord(overrides: Partial<CycleRecord> = {}): CycleRecord {
  const timestamp = overrides.timestamp_utc_iso ?? new Date(Date.now() - 10 * 60_000).toISOString();
  const sensors = overrides.sensors ?? buildSensorsNow(timestamp);
  const telemetry = overrides.telemetry ?? summarizeTelemetry(promptAssets.siteConfig, sensors);
  const decision = overrides.decision ?? buildDecision();

  return {
    decision_id: "history-decision",
    llm_model: "test-model",
    prompt_template_version: "test-template",
    site_config_id: promptAssets.siteConfig.site.id,
    timestamp_local_iso: timestamp,
    timestamp_utc_iso: timestamp,
    weather: buildWeatherNow(timestamp),
    sensors,
    telemetry,
    features: telemetry.features,
    decision,
    actuation: {
      applied: decision.actions,
      errors: [],
      actuation_ok: true
    },
    data_errors: [],
    data_warnings: [],
    decision_errors: [],
    actuation_errors: [],
    cycle_warnings: [],
    ...overrides
  };
}

function buildCycleDeps(params: {
  historyRecords?: CycleRecord[];
  weather?: WeatherNow | Error;
  sensors?: SensorsNow | Error;
  decision?: Decision | Error;
  actuation?: ActuationResult | Error;
} = {}) {
  const store = {} as any;
  const historyRecords = params.historyRecords ?? [];
  const insertedRecords: CycleRecord[] = [];
  const calls = {
    decisions: 0,
    actuations: 0,
    historyReads: 0
  };

  const deps = {
    initMongo: async () => store,
    getRecentCycleRecords: async () => {
      calls.historyReads += 1;
      return calls.historyReads === 1 ? historyRecords : [...historyRecords, ...insertedRecords];
    },
    insertCycleRecord: async (_store: any, record: CycleRecord) => {
      insertedRecords.push(record);
    },
    getWeatherNow: async () => {
      if (params.weather instanceof Error) throw params.weather;
      return params.weather ?? buildWeatherNow();
    },
    getSensorsNowFromCloud: async () => {
      throw new Error("unexpected cloud sensor path");
    },
    getSensorsNowFromLocalGateway: async () => {
      throw new Error("unexpected local sensor path");
    },
    getSensorsNowFromMock: async () => {
      if (params.sensors instanceof Error) throw params.sensors;
      return params.sensors ?? buildSensorsNow();
    },
    decideWithOpenAI: async () => {
      calls.decisions += 1;
      if (params.decision instanceof Error) throw params.decision;
      return { decision: params.decision ?? buildDecision(), responseId: "response-test" };
    },
    actuateDecision: async () => {
      calls.actuations += 1;
      if (params.actuation instanceof Error) throw params.actuation;
      return params.actuation ?? { applied: buildDecision().actions, errors: [], actuation_ok: true };
    },
    overwriteSheet: async () => undefined
  };

  return { deps, calls, insertedRecords };
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

test("weather outage uses recent valid weather history and continues to decision and actuation", async () => {
  const historyRecord = buildHistoryRecord();
  const { deps, calls } = buildCycleDeps({
    historyRecords: [historyRecord],
    weather: new Error("Open-Meteo connect timeout"),
    sensors: buildSensorsNow(),
    decision: buildDecision()
  });

  const record = await runCycleOnce(buildConfig(), promptAssets, deps);

  assert.equal(calls.decisions, 1, "LLM decision path should be reached");
  assert.equal(calls.actuations, 1, "actuation should proceed after stale weather fallback");
  assert.equal(record.decision.confidence_0_1, 0.8);
  assert.equal(record.weather.stale, true);
  assert.equal(record.weather.degraded, true);
  assert.equal(record.weather.source, "mongo_history");
  assert.deepEqual(record.data_errors, []);
  assert.equal(record.data_warnings.length, 1);
  assert.match(record.data_warnings[0], /Weather fetch failed/);
  assert.deepEqual(record.actuation_errors, []);
  assert.deepEqual(record.actuation.errors, []);
});

test("weather outage without recent valid weather history fails safe without actuation", async () => {
  const invalidWeatherHistory = buildHistoryRecord({
    weather: buildWeatherNow(new Date(Date.now() - 10 * 60_000).toISOString(), {
      temp_f: 0,
      rh_pct: 0,
      conditions: "unavailable (previous weather failure)"
    })
  });
  const { deps, calls } = buildCycleDeps({
    historyRecords: [invalidWeatherHistory],
    weather: new Error("Open-Meteo unavailable"),
    sensors: buildSensorsNow()
  });

  const record = await runCycleOnce(buildConfig(), promptAssets, deps);

  assert.equal(calls.decisions, 0, "LLM decision should not run without usable weather");
  assert.equal(calls.actuations, 0, "actuation should not run when data errors block the cycle");
  assert.equal(record.decision.confidence_0_1, 0);
  assert.match(record.decision.hypothesis, /Fallback no-op decision/);
  assert.equal(record.data_warnings.length, 0);
  assert.equal(record.data_errors.length, 1);
  assert.match(record.data_errors[0], /no valid weather history/);
  assert.deepEqual(record.actuation_errors, []);
  assert.deepEqual(record.actuation.errors, []);
});

test("sensor fetch failure remains blocking even when weather succeeds", async () => {
  const { deps, calls } = buildCycleDeps({
    weather: buildWeatherNow(),
    sensors: new Error("Ecowitt fetch failed")
  });

  const record = await runCycleOnce(buildConfig(), promptAssets, deps);

  assert.equal(calls.decisions, 0);
  assert.equal(calls.actuations, 0);
  assert.equal(record.decision.confidence_0_1, 0);
  assert.equal(record.data_errors.length, 1);
  assert.match(record.data_errors[0], /Sensor fetch failed/);
  assert.deepEqual(record.actuation_errors, []);
});

test("decision failures are recorded separately from actuation errors", async () => {
  const { deps, calls } = buildCycleDeps({
    weather: buildWeatherNow(),
    sensors: buildSensorsNow(),
    decision: new Error("OpenAI refused structured output")
  });

  const record = await runCycleOnce(buildConfig(), promptAssets, deps);

  assert.equal(calls.decisions, 1);
  assert.equal(calls.actuations, 0);
  assert.deepEqual(record.data_errors, []);
  assert.deepEqual(record.data_warnings, []);
  assert.equal(record.decision_errors.length, 1);
  assert.match(record.decision_errors[0], /OpenAI refused structured output/);
  assert.deepEqual(record.actuation_errors, []);
  assert.deepEqual(record.actuation.errors, []);
});

test("data warnings and Alexa routine failures land in distinct buckets", async () => {
  const historyRecord = buildHistoryRecord();
  const actuationError = "bedroom_ceiling_fan: Alexa routine failed";
  const { deps, calls } = buildCycleDeps({
    historyRecords: [historyRecord],
    weather: new Error("Open-Meteo TLS stalled"),
    sensors: buildSensorsNow(),
    decision: buildDecision(),
    actuation: {
      applied: buildDecision().actions,
      errors: [actuationError],
      actuation_ok: false
    }
  });

  const record = await runCycleOnce(buildConfig(), promptAssets, deps);

  assert.equal(calls.decisions, 1);
  assert.equal(calls.actuations, 1);
  assert.equal(record.data_warnings.length, 1);
  assert.match(record.data_warnings[0], /Open-Meteo TLS stalled/);
  assert.deepEqual(record.decision_errors, []);
  assert.deepEqual(record.actuation_errors, [actuationError]);
  assert.deepEqual(record.actuation.errors, [actuationError]);
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
  assert.equal(alexa.bodies.length, 3, "both active transoms should be commanded even when last-applied matches");
  assert.equal(meross.bodies.length, 2, "both active plugs should be commanded even when last-applied matches");
  assert.deepEqual(
    [...alexa.bodies.map((body) => body.device), ...meross.bodies.map((body) => body.plug)].sort(),
    ["bathroom_transom", "bedroom_ceiling_fan", "kitchen_transom", "kitchen_vornado_630", "living_vornado_630"].sort()
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
  assert.deepEqual(alexa.bodies.map((body) => body.device).sort(), ["bedroom_ceiling_fan", "kitchen_transom"].sort());
  assert.deepEqual(meross.bodies.map((body) => body.plug).sort(), ["kitchen_vornado_630", "living_vornado_630"].sort());
});

test("missing Alexa webhook is not an error when all transoms are disabled", async () => {
  const meross = await startWebhookRecorder();
  const decision = applyDisabledDeviceOverrides(buildDecision(), ["kitchen_transom", "bathroom_transom", "bedroom_ceiling_fan"]);
  const result = await actuate(
    buildConfig({
      DISABLED_DEVICES: ["kitchen_transom", "bathroom_transom", "bedroom_ceiling_fan"],
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

  assert.ok(result.errors.includes("Alexa actuator skipped: ALEXA_WEBHOOK_URL not configured"));
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



test("dry run includes bedroom ceiling fan without webhook calls", async () => {
  const alexa = await startWebhookRecorder();
  const meross = await startWebhookRecorder();
  const decision = buildDecision();
  const result = await actuate(
    buildConfig({ DRY_RUN: true, ALEXA_WEBHOOK_URL: alexa.url, MEROSS_WEBHOOK_URL: meross.url }),
    decision,
    "decision-test"
  );

  assert.equal(result.actuation_ok, true);
  assert.deepEqual(result.applied.bedroom_ceiling_fan, { power: "ON" });
  assert.equal(alexa.bodies.length, 0);
  assert.equal(meross.bodies.length, 0);
});

test("disabled bedroom ceiling fan is forced safe OFF and skipped", async () => {
  const alexa = await startWebhookRecorder();
  const meross = await startWebhookRecorder();
  const decision = applyDisabledDeviceOverrides(buildDecision(), ["bedroom_ceiling_fan"]);
  const result = await actuate(
    buildConfig({
      ACTUATION_REASSERT_EVERY_CYCLE: true,
      DISABLED_DEVICES: ["bedroom_ceiling_fan"],
      ALEXA_WEBHOOK_URL: alexa.url,
      MEROSS_WEBHOOK_URL: meross.url
    }),
    decision,
    "decision-test",
    buildDecision().actions
  );

  assert.equal(result.actuation_ok, true);
  assert.deepEqual(result.applied.bedroom_ceiling_fan, { power: "OFF" });
  assert.equal(alexa.bodies.some((body) => body.device === "bedroom_ceiling_fan"), false);
});

test("bedroom ceiling fan uses Alexa webhook and not Meross", async () => {
  const alexa = await startWebhookRecorder();
  const meross = await startWebhookRecorder();
  const decision = buildDecision();
  const lastApplied = structuredClone(decision.actions);
  lastApplied.bedroom_ceiling_fan = { power: "OFF" };
  const result = await actuate(
    buildConfig({ ALEXA_WEBHOOK_URL: alexa.url, MEROSS_WEBHOOK_URL: meross.url }),
    decision,
    "decision-test",
    lastApplied
  );

  assert.equal(result.actuation_ok, true);
  assert.ok(alexa.bodies.some((body) => body.kind === "alexa_power_switch" && body.device === "bedroom_ceiling_fan"));
  assert.equal(meross.bodies.some((body) => body.plug === "bedroom_ceiling_fan"), false);
});
