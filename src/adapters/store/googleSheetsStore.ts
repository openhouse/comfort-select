import { google } from "googleapis";
import fs from "node:fs/promises";
import { CycleRecord, Device, TelemetrySummary } from "../../types.js";
import { SiteConfig } from "../../siteConfig.js";

export interface SheetsStoreConfig {
  spreadsheetId: string;
  sheetName: string;
  serviceAccountJsonPath: string;
}

async function getSheetsClient(serviceAccountJsonPath: string) {
  const raw = await fs.readFile(serviceAccountJsonPath, "utf-8");
  const creds = JSON.parse(raw);

  const auth = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });

  const sheets = google.sheets({ version: "v4", auth });
  return sheets;
}

const ensuredSheets = new Set<string>();

async function ensureSheetExists(
  cfg: SheetsStoreConfig,
  sheets?: Awaited<ReturnType<typeof getSheetsClient>>
): Promise<void> {
  const cacheKey = `${cfg.spreadsheetId}__${cfg.sheetName}`;
  if (ensuredSheets.has(cacheKey)) return;

  const client = sheets ?? (await getSheetsClient(cfg.serviceAccountJsonPath));
  const spreadsheet = await client.spreadsheets.get({
    spreadsheetId: cfg.spreadsheetId,
    fields: "sheets.properties.title"
  });
  const hasSheet = (spreadsheet.data.sheets ?? []).some((s) => s.properties?.title === cfg.sheetName);
  if (!hasSheet) {
    await client.spreadsheets.batchUpdate({
      spreadsheetId: cfg.spreadsheetId,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: {
                title: cfg.sheetName
              }
            }
          }
        ]
      }
    });
  }

  ensuredSheets.add(cacheKey);
}

const WEATHER_COLUMNS = [
  "weather__outside__temp_f",
  "weather__outside__rh_pct",
  "weather__outside__wind_mph",
  "weather__outside__wind_dir_deg",
  "weather__outside__precip_in_hr",
  "weather__outside__conditions"
];

function deviceColumns(device: Device, suffix: string): string[] {
  const cols = [`device__${device.id}__power_${suffix}`];
  if (device.capabilities.direction_modes) {
    cols.push(`device__${device.id}__direction_${suffix}`);
  }
  if (device.capabilities.speed_levels) {
    cols.push(`device__${device.id}__speed_${suffix}`);
  }
  if (device.kind === "transom_fan") {
    cols.push(`device__${device.id}__auto_${suffix}`, `device__${device.id}__set_temp_f_${suffix}`);
  }
  return cols;
}

export function buildSheetHeader(siteConfig: SiteConfig): string[] {
  const header: string[] = ["timestamp_local_iso", "timestamp_utc_iso", ...WEATHER_COLUMNS];

  siteConfig.sensors.forEach((sensor) => {
    header.push(`temp_f__${sensor.id}`, `rh__${sensor.id}`);
  });

  siteConfig.rooms
    .filter((room) => !room.exterior)
    .forEach((room) => {
      header.push(`temp_f_mean__${room.id}`, `rh_mean__${room.id}`);
    });

  (siteConfig.features ?? []).forEach((feature) => {
    header.push(`feature__${feature.id}`);
  });

  siteConfig.devices.forEach((device) => {
    header.push(...deviceColumns(device, "req"));
  });

  siteConfig.devices.forEach((device) => {
    header.push(...deviceColumns(device, "applied"));
  });

  header.push(
    "hypothesis",
    "confidence_0_1",
    "panel_json",
    "panel_text",
    "predictions_json",
    "decision_json",
    "actuation_errors_json",
    "decision_id",
    "llm_model",
    "actuation_ok",
    "sensors_raw_json",
    "features_json",
    "openai_response_id",
    "prompt_template_version",
    "site_config_id"
  );

  return header;
}

export async function readAllRows(cfg: SheetsStoreConfig): Promise<string[][]> {
  const sheets = await getSheetsClient(cfg.serviceAccountJsonPath);
  await ensureSheetExists(cfg, sheets);
  const range = `${cfg.sheetName}!A:ZZ`;

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: cfg.spreadsheetId,
    range
  });

  const values = res.data.values ?? [];
  return values as string[][];
}

export async function ensureHeaderRow(cfg: SheetsStoreConfig, header: string[]): Promise<void> {
  const rows = await readAllRows(cfg);
  if (rows.length === 0) {
    await appendRow(cfg, header as unknown as string[]);
    return;
  }
  const first = rows[0] ?? [];
  const matches = first.length >= header.length && header.every((h, i) => first[i] === h);

  if (!matches) {
    throw new Error(`Sheet header row mismatch. Expected first row to match generated header (${header.length} cols).`);
  }
}

function normalizeRowValues(row: (string | number | boolean)[]): (string | number)[] {
  return row.map((v) => (typeof v === "boolean" ? String(v) : v ?? ""));
}

export async function appendRow(cfg: SheetsStoreConfig, row: (string | number | boolean)[]): Promise<void> {
  const sheets = await getSheetsClient(cfg.serviceAccountJsonPath);
  await ensureSheetExists(cfg, sheets);
  await sheets.spreadsheets.values.append({
    spreadsheetId: cfg.spreadsheetId,
    range: `${cfg.sheetName}!A:ZZ`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [normalizeRowValues(row)] }
  });
}

function pickSensor(
  rec: CycleRecord,
  sensorId: string
): { temp_f: number | string; rh_pct: number | string } {
  const found = rec.sensors.readings.find((r) => r.sensorId === sensorId);
  if (!found) return { temp_f: "", rh_pct: "" };
  return { temp_f: found.temp_f, rh_pct: found.rh_pct };
}

function pickRoomStats(
  telemetry: TelemetrySummary,
  roomId: string
): { temp_mean: number | string; rh_mean: number | string } {
  const room = telemetry.rooms.find((r) => r.roomId === roomId);
  return {
    temp_mean: room?.stats?.temp_f?.mean ?? "",
    rh_mean: room?.stats?.rh_pct?.mean ?? ""
  };
}

function flattenDeviceState(device: Device, state: any, suffix: string, into: Record<string, any>) {
  const base = `device__${device.id}`;
  into[`${base}__power_${suffix}`] = state?.power ?? "";
  if (device.capabilities.direction_modes) {
    into[`${base}__direction_${suffix}`] = state?.direction ?? "";
  }
  if (device.capabilities.speed_levels) {
    into[`${base}__speed_${suffix}`] = state?.speed ?? "";
  }
  if (device.kind === "transom_fan") {
    into[`${base}__auto_${suffix}`] = state?.auto ?? "";
    into[`${base}__set_temp_f_${suffix}`] = state?.set_temp_f ?? "";
  }
}

export function cycleRecordToRow(rec: CycleRecord, siteConfig: SiteConfig, header: string[]): (string | number | boolean)[] {
  const values: Record<string, string | number | boolean> = {
    timestamp_local_iso: rec.timestamp_local_iso,
    timestamp_utc_iso: rec.timestamp_utc_iso,
    weather__outside__temp_f: rec.weather.temp_f,
    weather__outside__rh_pct: rec.weather.rh_pct,
    weather__outside__wind_mph: rec.weather.wind_mph ?? "",
    weather__outside__wind_dir_deg: rec.weather.wind_dir_deg ?? "",
    weather__outside__precip_in_hr: rec.weather.precip_in_hr ?? "",
    weather__outside__conditions: rec.weather.conditions ?? ""
  };

  siteConfig.sensors.forEach((sensor) => {
    const reading = pickSensor(rec, sensor.id);
    values[`temp_f__${sensor.id}`] = reading.temp_f;
    values[`rh__${sensor.id}`] = reading.rh_pct;
  });

  siteConfig.rooms
    .filter((room) => !room.exterior)
    .forEach((room) => {
      const stats = pickRoomStats(rec.telemetry, room.id);
      values[`temp_f_mean__${room.id}`] = stats.temp_mean;
      values[`rh_mean__${room.id}`] = stats.rh_mean;
    });

  (siteConfig.features ?? []).forEach((feature) => {
    values[`feature__${feature.id}`] = rec.features?.[feature.id] ?? "";
  });

  siteConfig.devices.forEach((device) => {
    flattenDeviceState(device, rec.decision.actions[device.id as keyof typeof rec.decision.actions], "req", values);
  });
  siteConfig.devices.forEach((device) => {
    flattenDeviceState(device, rec.actuation.applied[device.id as keyof typeof rec.actuation.applied], "applied", values);
  });

  const panelText = rec.decision.panel
    .map((p) => `${p.speaker}: ${p.notes}`.replace(/\s+/g, " ").trim())
    .join("\n\n");

  values.hypothesis = rec.decision.hypothesis;
  values.confidence_0_1 = rec.decision.confidence_0_1;
  values.panel_json = JSON.stringify(rec.decision.panel ?? []);
  values.panel_text = panelText;
  values.predictions_json = JSON.stringify(rec.decision.predictions ?? {});
  values.decision_json = JSON.stringify(rec.decision);
  values.actuation_errors_json = JSON.stringify(rec.actuation.errors);
  values.decision_id = rec.decision_id;
  values.llm_model = rec.llm_model;
  values.actuation_ok = rec.actuation.actuation_ok;
  values.sensors_raw_json = JSON.stringify(rec.sensors.raw ?? {});
  values.features_json = JSON.stringify(rec.features ?? {});
  values.openai_response_id = rec.decision.openai_response_id ?? "";
  values.prompt_template_version = rec.prompt_template_version ?? "";
  values.site_config_id = rec.site_config_id ?? "";

  return header.map((key) => values[key] ?? "");
}

export async function overwriteSheet(
  cfg: SheetsStoreConfig,
  rows: (string | number | boolean)[][]
): Promise<void> {
  const sheets = await getSheetsClient(cfg.serviceAccountJsonPath);
  await ensureSheetExists(cfg, sheets);
  const range = `${cfg.sheetName}!A:ZZ`;
  await sheets.spreadsheets.values.clear({
    spreadsheetId: cfg.spreadsheetId,
    range
  });
  if (rows.length === 0) return;
  await sheets.spreadsheets.values.update({
    spreadsheetId: cfg.spreadsheetId,
    range: `${cfg.sheetName}!A1`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: rows.map((row) => normalizeRowValues(row)) }
  });
}
