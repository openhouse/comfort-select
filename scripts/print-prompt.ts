import { loadConfig } from "../src/config.js";
import { loadPromptAssetsFromConfig } from "../src/promptAssets.js";
import { buildPrompt } from "../src/llm/prompt.js";
import { getSensorsNowFromMock } from "../src/adapters/sensors/ecowittLocal.js";
import { getWeatherNow } from "../src/adapters/weather/openMeteo.js";
import { buildPromptHistoryHeader, buildPromptHistoryWindow } from "../src/history/promptHistory.js";
import { summarizeTelemetry } from "../src/utils/telemetry.js";
import { getRecentCycleRecords, initMongo } from "../src/adapters/store/mongoStore.js";

const cfg = loadConfig();
const promptAssets = loadPromptAssetsFromConfig(cfg);

const sensors = await getSensorsNowFromMock({
  mappingPath: cfg.ECOWITT_MAPPING_JSON,
  mockPath: "./mock/ecowitt.sample.json"
});

let weather = null;
try {
  weather = await getWeatherNow({
    lat: cfg.HOME_LAT,
    lon: cfg.HOME_LON,
    timezone: promptAssets.siteConfig.site.timezone ?? cfg.TIMEZONE,
    timeoutMs: cfg.HTTP_TIMEOUT_MS
  });
} catch (e: any) {
  weather = {
    temp_f: 70,
    rh_pct: 50,
    wind_mph: 0,
    wind_dir_deg: 0,
    precip_in_hr: 0,
    observation_time_utc: new Date().toISOString(),
    conditions: `fallback weather (${e?.message ?? "unknown error"})`
  };
}

const telemetry = summarizeTelemetry(promptAssets.siteConfig, sensors);

let historyRows = [buildPromptHistoryHeader(promptAssets.siteConfig)];
let historySummary = "No history available for prompt (Mongo not configured?).";

try {
  const mongo = await initMongo({
    uri: cfg.MONGODB_URI,
    dbName: cfg.MONGODB_DB_NAME,
    collectionName: cfg.MONGODB_COLLECTION
  });
  const records = await getRecentCycleRecords(
    mongo,
    Math.max(cfg.HISTORY_ROWS, cfg.PROMPT_HISTORY_MAX_ROWS)
  );
  const window = buildPromptHistoryWindow({
    records,
    siteConfig: promptAssets.siteConfig,
    maxRows: cfg.PROMPT_HISTORY_MAX_ROWS,
    maxMinutes: cfg.PROMPT_HISTORY_MAX_MINUTES,
    summaryMaxChars: cfg.PROMPT_HISTORY_SUMMARY_MAX_CHARS
  });
  historyRows = window.historyRows;
  historySummary = window.historySummary;
} catch (err: any) {
  // eslint-disable-next-line no-console
  console.warn(`Using header-only history: ${err?.message ?? err}`);
}

const { prompt } = buildPrompt({
  weather: weather,
  sensors,
  telemetry,
  features: telemetry.features,
  historyRows,
  historySummary,
  timezone: promptAssets.siteConfig.site.timezone ?? cfg.TIMEZONE,
  promptMaxChars: cfg.PROMPT_MAX_CHARS,
  promptAssets
});

// eslint-disable-next-line no-console
console.log(prompt);
