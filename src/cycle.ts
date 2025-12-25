import { AppConfig } from "./config.js";
import { logger } from "./utils/logger.js";
import { nowLocalIso, nowUtcIso } from "./utils/time.js";
import { getWeatherNow } from "./adapters/weather/openMeteo.js";
import {
  getSensorsNowFromLocalGateway,
  getSensorsNowFromMock
} from "./adapters/sensors/ecowittLocal.js";
import { getSensorsNowFromCloud } from "./adapters/sensors/ecowittCloud.js";
import {
  SheetsStoreConfig,
  appendRow,
  ensureHeaderRow,
  cycleRecordToRow,
  readAllRows
} from "./adapters/store/googleSheetsStore.js";
import { buildPrompt } from "./llm/prompt.js";
import { decideWithOpenAI } from "./llm/openaiDecider.js";
import { applySanity } from "./policy/sanity.js";
import { setTransomState } from "./adapters/actuators/alexaWebhook.js";
import { setPlugState } from "./adapters/actuators/merossWebhook.js";
import { ActuationResult, CycleRecord, Decision, SensorsNow, WeatherNow } from "./types.js";

function noopDecision(reason: string): Decision {
  return {
    panel: [{ speaker: "System (fallback)", say: reason }],
    actions: {
      kitchen_transom: {
        power: "OFF",
        direction: "EXHAUST",
        speed: "LOW",
        auto: false,
        set_temp_f: 70
      },
      bathroom_transom: {
        power: "OFF",
        direction: "EXHAUST",
        speed: "LOW",
        auto: false,
        set_temp_f: 70
      },
      kitchen_630_plug: { power: "OFF" },
      living_room_630_plug: { power: "OFF" }
    },
    hypothesis: `Fallback no-op decision due to error: ${reason}`,
    confidence_0_1: 0
  };
}

async function actuate(cfg: AppConfig, decision: Decision, decisionId: string): Promise<ActuationResult> {
  const errors: string[] = [];
  const applied = structuredClone(decision.actions);

  if (cfg.DRY_RUN) {
    return { applied, errors, actuation_ok: true };
  }

  // Transoms (Alexa webhook)
  try {
    await setTransomState(
      {
        url: cfg.ALEXA_WEBHOOK_URL,
        token: cfg.ALEXA_WEBHOOK_TOKEN,
        dryRun: false,
        timeoutMs: cfg.HTTP_TIMEOUT_MS
      },
      { device: "kitchen_transom", state: decision.actions.kitchen_transom, decisionId }
    );
  } catch (e: any) {
    errors.push(`kitchen_transom: ${e?.message ?? String(e)}`);
  }
  try {
    await setTransomState(
      {
        url: cfg.ALEXA_WEBHOOK_URL,
        token: cfg.ALEXA_WEBHOOK_TOKEN,
        dryRun: false,
        timeoutMs: cfg.HTTP_TIMEOUT_MS
      },
      { device: "bathroom_transom", state: decision.actions.bathroom_transom, decisionId }
    );
  } catch (e: any) {
    errors.push(`bathroom_transom: ${e?.message ?? String(e)}`);
  }

  // Meross plugs (webhook)
  try {
    await setPlugState(
      {
        url: cfg.MEROSS_WEBHOOK_URL,
        token: cfg.MEROSS_WEBHOOK_TOKEN,
        dryRun: false,
        timeoutMs: cfg.HTTP_TIMEOUT_MS
      },
      { plug: "kitchen_630_plug", state: decision.actions.kitchen_630_plug, decisionId }
    );
  } catch (e: any) {
    errors.push(`kitchen_630_plug: ${e?.message ?? String(e)}`);
  }
  try {
    await setPlugState(
      {
        url: cfg.MEROSS_WEBHOOK_URL,
        token: cfg.MEROSS_WEBHOOK_TOKEN,
        dryRun: false,
        timeoutMs: cfg.HTTP_TIMEOUT_MS
      },
      { plug: "living_room_630_plug", state: decision.actions.living_room_630_plug, decisionId }
    );
  } catch (e: any) {
    errors.push(`living_room_630_plug: ${e?.message ?? String(e)}`);
  }

  return { applied, errors, actuation_ok: errors.length === 0 };
}

function fallbackWeather(reason: string): WeatherNow {
  return {
    temp_f: 0,
    rh_pct: 0,
    wind_mph: undefined,
    wind_dir_deg: undefined,
    precip_in_hr: undefined,
    observation_time_utc: nowUtcIso(),
    conditions: `unavailable (${reason})`
  };
}

function fallbackSensors(reason: string): SensorsNow {
  return {
    observation_time_utc: nowUtcIso(),
    readings: [],
    raw: { error: reason }
  };
}

export async function runCycleOnce(cfg: AppConfig): Promise<CycleRecord> {
  const decision_id = `decision_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const timestamp_utc_iso = nowUtcIso();
  const timestamp_local_iso = nowLocalIso(cfg.TIMEZONE);

  const sheetsCfg: SheetsStoreConfig = {
    spreadsheetId: cfg.GOOGLE_SHEETS_SPREADSHEET_ID,
    sheetName: cfg.GOOGLE_SHEETS_SHEET_NAME,
    serviceAccountJsonPath: cfg.GOOGLE_SERVICE_ACCOUNT_JSON
  };

  logger.info({ timestamp_local_iso, decision_id }, "Cycle start");

  const blockingErrors: string[] = [];
  const nonBlockingErrors: string[] = [];

  let weather: WeatherNow | null = null;
  try {
    weather = await getWeatherNow({
      lat: cfg.HOME_LAT,
      lon: cfg.HOME_LON,
      timezone: cfg.TIMEZONE,
      timeoutMs: cfg.HTTP_TIMEOUT_MS
    });
  } catch (e: any) {
    const msg = `Weather fetch failed: ${e?.message ?? String(e)}`;
    logger.error({ err: e }, msg);
    blockingErrors.push(msg);
    weather = fallbackWeather(msg);
  }

  let sensors: SensorsNow | null = null;
  try {
    if (cfg.ECOWITT_SOURCE === "cloud_api") {
      if (!cfg.ECOWITT_CLOUD_APPLICATION_KEY || !cfg.ECOWITT_CLOUD_API_KEY) {
        throw new Error("ECOWITT_CLOUD_APPLICATION_KEY and ECOWITT_CLOUD_API_KEY required for cloud_api");
      }
      sensors = await getSensorsNowFromCloud({
        mappingPath: cfg.ECOWITT_MAPPING_JSON,
        applicationKey: cfg.ECOWITT_CLOUD_APPLICATION_KEY,
        apiKey: cfg.ECOWITT_CLOUD_API_KEY,
        preferredMac: cfg.ECOWITT_CLOUD_DEVICE_MAC,
        timeoutMs: cfg.HTTP_TIMEOUT_MS
      });
    } else if (cfg.ECOWITT_SOURCE === "local_gateway") {
      if (!cfg.ECOWITT_GATEWAY_URL) throw new Error("ECOWITT_GATEWAY_URL required for local_gateway");
      sensors = await getSensorsNowFromLocalGateway({
        gatewayUrl: cfg.ECOWITT_GATEWAY_URL,
        mappingPath: cfg.ECOWITT_MAPPING_JSON,
        timeoutMs: cfg.HTTP_TIMEOUT_MS
      });
    } else {
      sensors = await getSensorsNowFromMock({
        mappingPath: cfg.ECOWITT_MAPPING_JSON,
        mockPath: "./mock/ecowitt.sample.json"
      });
    }
  } catch (e: any) {
    const msg = `Sensor fetch failed: ${e?.message ?? String(e)}`;
    logger.error({ err: e }, msg);
    blockingErrors.push(msg);
    sensors = fallbackSensors(msg);
  }

  let headerReady = false;
  let historyRows: string[][] = [];
  try {
    await ensureHeaderRow(sheetsCfg);
    headerReady = true;
    historyRows = await readAllRows(sheetsCfg);
  } catch (e: any) {
    const msg = `Failed to read Google Sheet: ${e?.message ?? String(e)}`;
    logger.error({ err: e }, msg);
    blockingErrors.push(msg);
  }

  const historyForPrompt =
    cfg.HISTORY_MODE === "full"
      ? historyRows
      : historyRows.length <= 1
        ? historyRows
        : [historyRows[0], ...historyRows.slice(-cfg.HISTORY_ROWS)];

  const prompt = buildPrompt({
    weather: weather!,
    sensors: sensors!,
    historyRows: historyForPrompt,
    timezone: cfg.TIMEZONE,
    promptMaxChars: cfg.PROMPT_MAX_CHARS
  });

  const decisionErrors: string[] = [];
  let decision: Decision;
  if (blockingErrors.length > 0) {
    decision = noopDecision(blockingErrors.join("; "));
  } else {
    try {
      const { decision: llmDecision, responseId } = await decideWithOpenAI(
        { apiKey: cfg.OPENAI_API_KEY, model: cfg.OPENAI_MODEL, timeoutMs: cfg.HTTP_TIMEOUT_MS * 3 },
        prompt
      );
      decision = { ...llmDecision, openai_response_id: responseId };
    } catch (e: any) {
      logger.error({ err: e }, "OpenAI decision failed");
      decisionErrors.push(e?.message ?? String(e));
      decision = noopDecision(e?.message ?? String(e));
    }
  }

  decision = applySanity(decision);

  let actuation: ActuationResult;
  if (blockingErrors.length > 0 || decisionErrors.length > 0) {
    actuation = { applied: decision.actions, errors: [...blockingErrors, ...decisionErrors], actuation_ok: false };
  } else {
    actuation = await actuate(cfg, decision, decision_id);
  }
  actuation.errors.push(...nonBlockingErrors);

  const record: CycleRecord = {
    decision_id,
    timestamp_local_iso,
    timestamp_utc_iso,
    llm_model: cfg.OPENAI_MODEL,
    weather: weather!,
    sensors: sensors!,
    decision,
    actuation
  };

  if (headerReady) {
    try {
      await appendRow(sheetsCfg, cycleRecordToRow(record));
    } catch (e: any) {
      logger.error({ err: e }, "Failed to append to Google Sheet");
      // Keep record for observability even if sheet write fails.
      actuation.errors.push(`Sheet append failed: ${e?.message ?? String(e)}`);
    }
  }

  logger.info(
    {
      decision_id,
      decision_confidence: record.decision.confidence_0_1,
      actuation_errors: record.actuation.errors.length
    },
    "Cycle complete"
  );

  return record;
}
