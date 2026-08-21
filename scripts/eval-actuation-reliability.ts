import { readFile } from "node:fs/promises";

import { AppConfig } from "../src/config.js";
import { actuate, applyDisabledDeviceOverrides } from "../src/cycle.js";
import { Decision, DeviceKey } from "../src/types.js";

type EvalCase = {
  id: string;
  description: string;
  alexa_status: number | "unconfigured";
  meross_status: number | "unconfigured";
  prior: "none" | "all_off";
  disabled: DeviceKey[];
  reassert: boolean;
  expected_first_applied: DeviceKey[];
  expected_calls_after_two: number;
};

const deviceKeys: DeviceKey[] = [
  "kitchen_transom",
  "bathroom_transom",
  "kitchen_vornado_630",
  "living_vornado_630",
  "bedroom_ceiling_fan"
];

function decision(): Decision {
  return {
    panel: [],
    actions: {
      kitchen_transom: { power: "ON", direction: "DIRECT", speed: "HIGH", auto: false, set_temp_f: 70 },
      bathroom_transom: { power: "ON", direction: "EXHAUST", speed: "LOW", auto: false, set_temp_f: 70 },
      kitchen_vornado_630: { power: "ON" },
      living_vornado_630: { power: "ON" },
      bedroom_ceiling_fan: { power: "ON" }
    },
    hypothesis: "actuation reliability eval",
    confidence_0_1: 1,
    predictions: []
  };
}

function allOff(): Decision["actions"] {
  return {
    kitchen_transom: { power: "OFF", direction: "EXHAUST", speed: "LOW", auto: false, set_temp_f: 70 },
    bathroom_transom: { power: "OFF", direction: "EXHAUST", speed: "LOW", auto: false, set_temp_f: 70 },
    kitchen_vornado_630: { power: "OFF" },
    living_vornado_630: { power: "OFF" },
    bedroom_ceiling_fan: { power: "OFF" }
  };
}

function config(evalCase: EvalCase): AppConfig {
  return {
    CYCLE_MINUTES: 10,
    TIMEZONE: "America/New_York",
    HOME_LAT: 0,
    HOME_LON: 0,
    OPENAI_API_KEY: "eval",
    OPENAI_MODEL: "eval",
    OPENAI_TIMEOUT_MS: 1000,
    OPENAI_MAX_RETRIES: 0,
    PROMPT_TEMPLATE_PATH: "./config/prompt/llm-prompt-template.md.hbs",
    SITE_CONFIG_PATH: "./config/site.config.json",
    GOOGLE_SHEETS_SPREADSHEET_ID: "eval",
    GOOGLE_SHEETS_SHEET_NAME: "eval",
    GOOGLE_SERVICE_ACCOUNT_JSON: "eval",
    HISTORY_MODE: "window",
    HISTORY_ROWS: 20,
    PROMPT_MAX_CHARS: 1000,
    PROMPT_HISTORY_MAX_ROWS: 20,
    PROMPT_HISTORY_MAX_MINUTES: 180,
    PROMPT_HISTORY_SUMMARY_MAX_CHARS: 1000,
    SHEET_SYNC_ROWS: 20,
    WEATHER_STALE_MAX_MINUTES: 360,
    HTTP_TIMEOUT_MS: 1000,
    ACTUATOR_HTTP_TIMEOUT_MS: 1000,
    ACTUATION_REASSERT_EVERY_CYCLE: evalCase.reassert,
    DISABLED_DEVICES: evalCase.disabled,
    ECOWITT_SOURCE: "mock",
    ECOWITT_MAPPING_JSON: "./config/sensors.mapping.json",
    DRY_RUN: false,
    ALEXA_WEBHOOK_URL: evalCase.alexa_status === "unconfigured" ? undefined : "http://eval.local/alexa",
    MEROSS_WEBHOOK_URL: evalCase.meross_status === "unconfigured" ? undefined : "http://eval.local/meross",
    MONGODB_URI: "mongodb://eval",
    MONGODB_DB_NAME: "eval",
    MONGODB_COLLECTION: "eval",
    PORT: 3000
  };
}

const cases = JSON.parse(
  await readFile(new URL("../evals/actuation-reliability.json", import.meta.url), "utf8")
) as EvalCase[];
const originalFetch = globalThis.fetch;
let checksPassed = 0;
let checksTotal = 0;

try {
  for (const evalCase of cases) {
    let calls = 0;
    globalThis.fetch = async (input) => {
      calls += 1;
      const url = String(input);
      const status = url.endsWith("/alexa") ? evalCase.alexa_status : evalCase.meross_status;
      if (status === "unconfigured") throw new Error(`unexpected call to unconfigured endpoint: ${url}`);
      return new Response(JSON.stringify({ ok: status >= 200 && status < 300 }), {
        status,
        headers: { "content-type": "application/json" }
      });
    };

    const requested = applyDisabledDeviceOverrides(decision(), evalCase.disabled);
    const first = await actuate(
      config(evalCase),
      requested,
      `${evalCase.id}-first`,
      evalCase.prior === "all_off" ? allOff() : undefined
    );
    await actuate(config(evalCase), requested, `${evalCase.id}-second`, first.applied);

    const actualApplied = deviceKeys.filter((device) => first.applied[device] !== undefined).sort();
    const expectedApplied = [...evalCase.expected_first_applied].sort();
    const appliedPass = JSON.stringify(actualApplied) === JSON.stringify(expectedApplied);
    const callsPass = calls === evalCase.expected_calls_after_two;
    checksPassed += Number(appliedPass) + Number(callsPass);
    checksTotal += 2;

    console.log(`${appliedPass && callsPass ? "PASS" : "FAIL"} ${evalCase.id}`);
    if (!appliedPass) console.log(`  first applied: expected ${expectedApplied.join(",") || "none"}; got ${actualApplied.join(",") || "none"}`);
    if (!callsPass) console.log(`  calls after two cycles: expected ${evalCase.expected_calls_after_two}; got ${calls}`);
  }
} finally {
  globalThis.fetch = originalFetch;
}

const score = checksTotal === 0 ? 0 : checksPassed / checksTotal;
console.log(`Actuation reliability eval: ${checksPassed}/${checksTotal} checks (${(score * 100).toFixed(1)}%)`);
if (checksPassed !== checksTotal) process.exitCode = 1;
