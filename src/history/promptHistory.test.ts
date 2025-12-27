import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPromptHistoryWindow } from "./promptHistory.js";
import { loadSiteConfig } from "../siteConfig.js";
import { summarizeTelemetry } from "../utils/telemetry.js";
import { CycleRecord, Decision, SensorsNow, WeatherNow } from "../types.js";

const siteConfig = loadSiteConfig("./config/site.config.json");

function buildSensorsNow(tempBase: number, rhBase: number, timestamp: string): SensorsNow {
  return {
    observation_time_utc: timestamp,
    readings: siteConfig.sensors.map((sensor, idx) => ({
      sensorId: sensor.id,
      temp_f: tempBase + idx,
      rh_pct: rhBase + idx
    }))
  };
}

function buildDecision(): Decision {
  return {
    panel: [],
    actions: {
      kitchen_transom: { power: "ON", direction: "EXHAUST", speed: "LOW", auto: false, set_temp_f: 70 },
      bathroom_transom: { power: "OFF", direction: "EXHAUST", speed: "LOW", auto: false, set_temp_f: 70 },
      kitchen_vornado_630: { power: "OFF" },
      living_vornado_630: { power: "ON" }
    },
    hypothesis: "test decision",
    confidence_0_1: 0.5,
    predictions: []
  };
}

function buildWeather(now: string, offset: number): WeatherNow {
  return {
    temp_f: 60 + offset,
    rh_pct: 50 + offset,
    wind_mph: 5,
    wind_dir_deg: 180,
    precip_in_hr: 0,
    observation_time_utc: now,
    conditions: "clear"
  };
}

function buildRecord(idx: number, base: Date): CycleRecord {
  const timestamp = new Date(base.getTime() + idx * 5 * 60 * 1000);
  const iso = timestamp.toISOString();
  const sensors = buildSensorsNow(70 + idx, 40 + idx, iso);
  const telemetry = summarizeTelemetry(siteConfig, sensors);
  const decision = buildDecision();
  const weather = buildWeather(iso, idx);

  return {
    decision_id: `decision_${idx}`,
    llm_model: "test-model",
    prompt_template_version: "v1",
    site_config_id: siteConfig.site.id,
    timestamp_local_iso: iso,
    timestamp_utc_iso: iso,
    weather,
    sensors,
    telemetry,
    features: telemetry.features,
    decision,
    actuation: {
      applied: decision.actions,
      errors: [],
      actuation_ok: true
    }
  };
}

test("prompt history window returns rows when history exists", () => {
  const base = new Date("2024-01-01T12:00:00Z");
  const records = [buildRecord(0, base), buildRecord(1, base), buildRecord(2, base)];
  const window = buildPromptHistoryWindow({
    records,
    siteConfig,
    maxRows: 10,
    maxMinutes: 180,
    summaryMaxChars: 500
  });

  assert.equal(window.historyRows.length, records.length + 1, "history rows should include header plus records");
  assert.ok(window.historyRows[1].some((cell) => cell !== ""), "first data row should not be empty");
  assert.ok(window.historySummary.includes("window"), "summary should include window metadata");
});
