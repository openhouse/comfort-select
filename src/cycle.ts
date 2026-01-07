import { AppConfig } from "./config.js";
import { PromptAssets } from "./promptAssets.js";
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
  buildSheetHeader,
  cycleRecordToRow,
  overwriteSheet
} from "./adapters/store/googleSheetsStore.js";
import { buildPromptHistoryWindow } from "./history/promptHistory.js";
import { buildPrompt } from "./llm/prompt.js";
import { decideWithOpenAI } from "./llm/openaiDecider.js";
import { applySanity } from "./policy/sanity.js";
import { setTransomState } from "./adapters/actuators/alexaWebhook.js";
import { setPlugState } from "./adapters/actuators/merossWebhook.js";
import {
  ActuationResult,
  CycleRecord,
  Decision,
  SensorsNow,
  WeatherNow
} from "./types.js";
import { summarizeTelemetry } from "./utils/telemetry.js";
import {
  MongoStore,
  getRecentCycleRecords,
  hashSiteConfig,
  initMongo,
  insertCycleRecord
} from "./adapters/store/mongoStore.js";

function noopDecision(reason: string, speakers: string[]): Decision {
  const panel = speakers.length > 0 ? speakers : ["System (fallback)"];
  return {
    panel: panel.map((speaker) => ({ speaker, notes: reason })),
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
      kitchen_vornado_630: { power: "OFF" },
      living_vornado_630: { power: "OFF" }
    },
    hypothesis: `Fallback no-op decision due to error: ${reason}`,
    confidence_0_1: 0,
    predictions: []
  };
}

function transomStateEqual(a?: Decision["actions"]["kitchen_transom"], b?: Decision["actions"]["kitchen_transom"]) {
  if (!a || !b) return false;
  return a.power === b.power && a.direction === b.direction && a.speed === b.speed && a.auto === b.auto && a.set_temp_f === b.set_temp_f;
}

function plugStateEqual(a?: Decision["actions"]["kitchen_vornado_630"], b?: Decision["actions"]["kitchen_vornado_630"]) {
  if (!a || !b) return false;
  return a.power === b.power;
}

async function actuate(
  cfg: AppConfig,
  decision: Decision,
  decisionId: string,
  lastApplied?: Decision["actions"]
): Promise<ActuationResult> {
  const errors: string[] = [];
  const applied: Decision["actions"] = {
    kitchen_transom: structuredClone(lastApplied?.kitchen_transom ?? decision.actions.kitchen_transom),
    bathroom_transom: structuredClone(lastApplied?.bathroom_transom ?? decision.actions.bathroom_transom),
    kitchen_vornado_630: structuredClone(lastApplied?.kitchen_vornado_630 ?? decision.actions.kitchen_vornado_630),
    living_vornado_630: structuredClone(lastApplied?.living_vornado_630 ?? decision.actions.living_vornado_630)
  };

  if (cfg.DRY_RUN) {
    return { applied, errors, actuation_ok: true };
  }

  const alexaDryRun = cfg.DRY_RUN || !cfg.ALEXA_WEBHOOK_URL;
  const merossDryRun = cfg.DRY_RUN || !cfg.MEROSS_WEBHOOK_URL;

  if (!cfg.ALEXA_WEBHOOK_URL && !cfg.DRY_RUN) {
    errors.push("Transom actuator skipped: ALEXA_WEBHOOK_URL not configured");
  }
  if (!cfg.MEROSS_WEBHOOK_URL && !cfg.DRY_RUN) {
    errors.push("Plug actuator skipped: MEROSS_WEBHOOK_URL not configured");
  }

  // Transoms (Alexa webhook)
  const transomDevices: ("kitchen_transom" | "bathroom_transom")[] = ["kitchen_transom", "bathroom_transom"];
  for (const device of transomDevices) {
    const requested = decision.actions[device];
    const previous = lastApplied?.[device];
    if (previous && transomStateEqual(previous, requested)) {
      applied[device] = previous;
      continue;
    }

    if (!cfg.ALEXA_WEBHOOK_URL && !cfg.DRY_RUN) {
      applied[device] = previous ?? requested;
      continue;
    }

    try {
      await setTransomState(
        {
          url: cfg.ALEXA_WEBHOOK_URL,
          token: cfg.ALEXA_WEBHOOK_TOKEN,
          dryRun: alexaDryRun,
          timeoutMs: cfg.HTTP_TIMEOUT_MS
        },
        { device, state: requested, decisionId }
      );
      applied[device] = requested;
    } catch (e: any) {
      applied[device] = previous ?? requested;
      errors.push(`${device}: ${e?.message ?? String(e)}`);
    }
  }

  // Meross plugs (webhook)
  const plugDevices: ("kitchen_vornado_630" | "living_vornado_630")[] = ["kitchen_vornado_630", "living_vornado_630"];
  for (const plug of plugDevices) {
    const requested = decision.actions[plug];
    const previous = lastApplied?.[plug];
    if (previous && plugStateEqual(previous, requested)) {
      applied[plug] = previous;
      continue;
    }

    if (!cfg.MEROSS_WEBHOOK_URL && !cfg.DRY_RUN) {
      applied[plug] = previous ?? requested;
      continue;
    }

    try {
      await setPlugState(
        {
          url: cfg.MEROSS_WEBHOOK_URL,
          token: cfg.MEROSS_WEBHOOK_TOKEN,
          dryRun: merossDryRun,
          timeoutMs: cfg.HTTP_TIMEOUT_MS
        },
        { plug, state: requested, decisionId }
      );
      applied[plug] = requested;
    } catch (e: any) {
      applied[plug] = previous ?? requested;
      errors.push(`${plug}: ${e?.message ?? String(e)}`);
    }
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

export async function runCycleOnce(cfg: AppConfig, promptAssets: PromptAssets): Promise<CycleRecord> {
  const decision_id = `decision_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const siteTimezone = promptAssets.siteConfig.site.timezone ?? cfg.TIMEZONE;
  const sheetHeader = buildSheetHeader(promptAssets.siteConfig);
  const timestamp_utc_iso = nowUtcIso();
  const timestamp_local_iso = nowLocalIso(siteTimezone);

  const sheetsCfg: SheetsStoreConfig = {
    spreadsheetId: cfg.GOOGLE_SHEETS_SPREADSHEET_ID,
    sheetName: cfg.GOOGLE_SHEETS_SHEET_NAME,
    serviceAccountJsonPath: cfg.GOOGLE_SERVICE_ACCOUNT_JSON
  };

  logger.info({ timestamp_local_iso, decision_id }, "Cycle start");

  const blockingErrors: string[] = [];
  const nonBlockingErrors: string[] = [];

  let mongoStore: MongoStore | null = null;
  try {
    mongoStore = await initMongo({
      uri: cfg.MONGODB_URI,
      dbName: cfg.MONGODB_DB_NAME,
      collectionName: cfg.MONGODB_COLLECTION
    });
  } catch (e: any) {
    const msg = `Failed to connect to MongoDB: ${e?.message ?? String(e)}`;
    logger.error({ err: e }, msg);
    blockingErrors.push(msg);
  }

  let weather: WeatherNow | null = null;
  try {
    const loc = promptAssets.siteConfig.site.location;
    weather = await getWeatherNow({
      lat: loc?.lat ?? cfg.HOME_LAT,
      lon: loc?.lon ?? cfg.HOME_LON,
      timezone: siteTimezone,
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

  const telemetry = summarizeTelemetry(promptAssets.siteConfig, sensors!);
  const features = telemetry.features;

  let historyRecords: CycleRecord[] = [];
  if (mongoStore) {
    try {
      historyRecords = await getRecentCycleRecords(
        mongoStore,
        cfg.HISTORY_MODE === "window" ? Math.max(cfg.HISTORY_ROWS, cfg.PROMPT_HISTORY_MAX_ROWS) : undefined
      );
    } catch (e: any) {
      const msg = `Failed to read Mongo history: ${e?.message ?? String(e)}`;
      logger.error({ err: e }, msg);
      blockingErrors.push(msg);
    }
  }

  const promptHistory = buildPromptHistoryWindow({
    records: historyRecords,
    siteConfig: promptAssets.siteConfig,
    maxRows: cfg.PROMPT_HISTORY_MAX_ROWS,
    maxMinutes: cfg.PROMPT_HISTORY_MAX_MINUTES,
    summaryMaxChars: cfg.PROMPT_HISTORY_SUMMARY_MAX_CHARS
  });

  const { prompt, promptVersion, siteConfigId } = buildPrompt({
    weather: weather!,
    sensors: sensors!,
    telemetry,
    features,
    historyRows: promptHistory.historyRows,
    historySummary: promptHistory.historySummary,
    timezone: siteTimezone,
    promptMaxChars: cfg.PROMPT_MAX_CHARS,
    promptAssets
  });

  const decisionErrors: string[] = [];
  let decision: Decision;
  if (blockingErrors.length > 0) {
    decision = noopDecision(blockingErrors.join("; "), promptAssets.curatorLabels);
  } else {
    try {
      const { decision: llmDecision, responseId } = await decideWithOpenAI(
        {
          apiKey: cfg.OPENAI_API_KEY,
          model: cfg.OPENAI_DECISION_MODEL ?? cfg.OPENAI_MODEL,
          timeoutMs: cfg.OPENAI_TIMEOUT_MS,
          maxRetries: cfg.OPENAI_MAX_RETRIES,
          curatorLabels: promptAssets.curatorLabels
        },
        prompt
      );
      decision = { ...llmDecision, openai_response_id: responseId };
    } catch (e: any) {
      logger.error({ err: e }, "OpenAI decision failed");
      decisionErrors.push(e?.message ?? String(e));
      decision = noopDecision(e?.message ?? String(e), promptAssets.curatorLabels);
    }
  }

  decision = applySanity(decision);

  let actuation: ActuationResult;
  if (blockingErrors.length > 0 || decisionErrors.length > 0) {
    actuation = { applied: decision.actions, errors: [...blockingErrors, ...decisionErrors], actuation_ok: false };
  } else {
    actuation = await actuate(cfg, decision, decision_id, promptHistory.lastApplied);
  }
  actuation.errors.push(...nonBlockingErrors);

  const record: CycleRecord = {
    decision_id,
    timestamp_local_iso,
    timestamp_utc_iso,
    llm_model: cfg.OPENAI_MODEL,
    prompt_template_version: promptVersion,
    site_config_id: siteConfigId,
    weather: weather!,
    sensors: sensors!,
    telemetry,
    features,
    decision,
    actuation
  };

  const siteConfigHash = hashSiteConfig(promptAssets.siteConfig);

  if (mongoStore) {
    try {
      await insertCycleRecord(mongoStore, record, { siteConfigHash });
    } catch (e: any) {
      const msg = `Failed to insert cycle record into MongoDB: ${e?.message ?? String(e)}`;
      logger.error({ err: e }, msg);
      actuation.errors.push(msg);
    }

    try {
      const rowsForSheet = await getRecentCycleRecords(mongoStore, cfg.SHEET_SYNC_ROWS);
      const projectedRows = rowsForSheet.map((rec) => cycleRecordToRow(rec, promptAssets.siteConfig, sheetHeader));
      await overwriteSheet(sheetsCfg, [sheetHeader, ...projectedRows]);
    } catch (e: any) {
      const msg = `Failed to sync Google Sheet from MongoDB (non-blocking): ${e?.message ?? String(e)}`;
      logger.error({ err: e }, msg);
      nonBlockingErrors.push(msg);
      actuation.errors.push(msg);
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
