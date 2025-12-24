import { google } from "googleapis";
import fs from "node:fs/promises";
import { CycleRecord } from "../../types.js";

export const SHEET_HEADER = [
  "timestamp_local_iso",
  "timestamp_utc_iso",

  "outside_temp_f",
  "outside_rh_pct",
  "outside_wind_mph",
  "outside_wind_dir_deg",
  "outside_precip_in_hr",

  "kitchen_temp_f",
  "kitchen_rh_pct",
  "living_room_temp_f",
  "living_room_rh_pct",
  "bedroom_temp_f",
  "bedroom_rh_pct",
  "bathroom_temp_f",
  "bathroom_rh_pct",
  "front_hall_temp_f",
  "front_hall_rh_pct",
  "back_hall_temp_f",
  "back_hall_rh_pct",
  "radiator_temp_f",
  "radiator_rh_pct",

  // requested actions
  "kitchen_transom_power_req",
  "kitchen_transom_direction_req",
  "kitchen_transom_speed_req",
  "kitchen_transom_auto_req",
  "kitchen_transom_set_temp_f_req",

  "bathroom_transom_power_req",
  "bathroom_transom_direction_req",
  "bathroom_transom_speed_req",
  "bathroom_transom_auto_req",
  "bathroom_transom_set_temp_f_req",

  "kitchen_630_power_req",
  "living_room_630_power_req",

  // applied actions (post-actuation)
  "kitchen_transom_power_applied",
  "kitchen_transom_direction_applied",
  "kitchen_transom_speed_applied",
  "kitchen_transom_auto_applied",
  "kitchen_transom_set_temp_f_applied",

  "bathroom_transom_power_applied",
  "bathroom_transom_direction_applied",
  "bathroom_transom_speed_applied",
  "bathroom_transom_auto_applied",
  "bathroom_transom_set_temp_f_applied",

  "kitchen_630_power_applied",
  "living_room_630_power_applied",

  // model artifacts
  "hypothesis",
  "panel",
  "confidence_0_1",
  "predictions_json",
  "decision_json",
  "actuation_errors_json"
] as const;

export type SheetHeaderKey = (typeof SHEET_HEADER)[number];

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

export async function readAllRows(cfg: SheetsStoreConfig): Promise<string[][]> {
  const sheets = await getSheetsClient(cfg.serviceAccountJsonPath);
  const range = `${cfg.sheetName}!A:ZZ`;

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: cfg.spreadsheetId,
    range
  });

  const values = res.data.values ?? [];
  return values as string[][];
}

export async function ensureHeaderRow(cfg: SheetsStoreConfig): Promise<void> {
  const rows = await readAllRows(cfg);
  if (rows.length === 0) {
    await appendRow(cfg, SHEET_HEADER as unknown as string[]);
    return;
  }
  const first = rows[0] ?? [];
  const matches =
    first.length >= SHEET_HEADER.length &&
    SHEET_HEADER.every((h, i) => first[i] === h);

  if (!matches) {
    throw new Error(
      `Sheet header row mismatch. Expected first row to match SHEET_HEADER (${SHEET_HEADER.length} cols).`
    );
  }
}

export async function appendRow(cfg: SheetsStoreConfig, row: (string | number | boolean)[]): Promise<void> {
  const sheets = await getSheetsClient(cfg.serviceAccountJsonPath);
  await sheets.spreadsheets.values.append({
    spreadsheetId: cfg.spreadsheetId,
    range: `${cfg.sheetName}!A:ZZ`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [row.map((v) => (typeof v === "boolean" ? String(v) : v))] }
  });
}

function pickRoom(readings: { room: string; temp_f: number; rh_pct: number }[], room: string) {
  const r = readings.find((x) => x.room === room);
  return r ? { temp_f: r.temp_f, rh_pct: r.rh_pct } : { temp_f: "", rh_pct: "" };
}

export function cycleRecordToRow(rec: CycleRecord): (string | number | boolean)[] {
  const w = rec.weather;
  const s = rec.sensors.readings;

  const k = pickRoom(s, "kitchen");
  const lr = pickRoom(s, "living_room");
  const br = pickRoom(s, "bedroom");
  const ba = pickRoom(s, "bathroom");
  const fh = pickRoom(s, "front_hall");
  const bh = pickRoom(s, "back_hall");
  const rad = pickRoom(s, "radiator");

  const req = rec.decision.actions;
  const app = rec.actuation.applied;

  const panelText = rec.decision.panel
    .map((p) => `${p.speaker}: ${p.say}`.replace(/\s+/g, " ").trim())
    .join("\n\n");

  return [
    rec.timestamp_local_iso,
    rec.timestamp_utc_iso,

    w.temp_f,
    w.rh_pct,
    w.wind_mph ?? "",
    w.wind_dir_deg ?? "",
    w.precip_in_hr ?? "",

    k.temp_f,
    k.rh_pct,
    lr.temp_f,
    lr.rh_pct,
    br.temp_f,
    br.rh_pct,
    ba.temp_f,
    ba.rh_pct,
    fh.temp_f,
    fh.rh_pct,
    bh.temp_f,
    bh.rh_pct,
    rad.temp_f,
    rad.rh_pct,

    req.kitchen_transom.power,
    req.kitchen_transom.direction,
    req.kitchen_transom.speed,
    req.kitchen_transom.auto,
    req.kitchen_transom.set_temp_f,

    req.bathroom_transom.power,
    req.bathroom_transom.direction,
    req.bathroom_transom.speed,
    req.bathroom_transom.auto,
    req.bathroom_transom.set_temp_f,

    req.kitchen_630_plug.power,
    req.living_room_630_plug.power,

    app.kitchen_transom.power,
    app.kitchen_transom.direction,
    app.kitchen_transom.speed,
    app.kitchen_transom.auto,
    app.kitchen_transom.set_temp_f,

    app.bathroom_transom.power,
    app.bathroom_transom.direction,
    app.bathroom_transom.speed,
    app.bathroom_transom.auto,
    app.bathroom_transom.set_temp_f,

    app.kitchen_630_plug.power,
    app.living_room_630_plug.power,

    rec.decision.hypothesis,
    panelText,
    rec.decision.confidence_0_1,
    JSON.stringify(rec.decision.predictions ?? {}),
    JSON.stringify(rec.decision),
    JSON.stringify(rec.actuation.errors)
  ];
}
