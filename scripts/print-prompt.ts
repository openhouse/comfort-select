import { loadConfig } from "../src/config.js";
import { loadPromptAssetsFromConfig } from "../src/promptAssets.js";
import { buildPrompt } from "../src/llm/prompt.js";
import { getSensorsNowFromMock } from "../src/adapters/sensors/ecowittLocal.js";
import { getWeatherNow } from "../src/adapters/weather/openMeteo.js";
import { SHEET_HEADER } from "../src/adapters/store/googleSheetsStore.js";

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

const { prompt } = buildPrompt({
  weather: weather,
  sensors,
  historyRows: [Array.from(SHEET_HEADER)],
  timezone: promptAssets.siteConfig.site.timezone ?? cfg.TIMEZONE,
  promptMaxChars: cfg.PROMPT_MAX_CHARS,
  promptAssets
});

// eslint-disable-next-line no-console
console.log(prompt);
