import fs from "node:fs/promises";
import { SensorsNow, RoomReading } from "../../types.js";
import { fetchWithTimeout } from "../../utils/fetchWithTimeout.js";

type MappingEntry = {
  id:
    | "kitchen"
    | "living_room"
    | "bedroom"
    | "bathroom"
    | "front_hall"
    | "back_hall"
    | "radiator";
  label: string;
  tempKey: string;
  humidityKey: string;
};

type MappingFile = { rooms: MappingEntry[] };

async function loadMapping(path: string): Promise<MappingFile> {
  const raw = await fs.readFile(path, "utf-8");
  return JSON.parse(raw) as MappingFile;
}

function coerceNumber(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  throw new Error(`Expected number, got: ${JSON.stringify(v)}`);
}

export async function getSensorsNowFromLocalGateway(params: {
  gatewayUrl: string;
  mappingPath: string;
  timeoutMs: number;
}): Promise<SensorsNow> {
  const mapping = await loadMapping(params.mappingPath);

  const url = new URL("/get_livedata_info", params.gatewayUrl);
  const resp = await fetchWithTimeout(url.toString(), { method: "GET", timeoutMs: params.timeoutMs });
  if (!resp.ok) throw new Error(`Ecowitt gateway error: ${resp.status} ${resp.statusText}`);
  const json = (await resp.json()) as any;

  // Many gateways return different shapes. This MVP expects flat keys as configured in mapping.
  // If your payload differs, update `config/sensors.mapping.json` to match your gateway keys.
  const readings: RoomReading[] = mapping.rooms.map((r) => {
    const temp = coerceNumber(json[r.tempKey]);
    const rh = coerceNumber(json[r.humidityKey]);
    return { room: r.id, temp_f: temp, rh_pct: rh };
  });

  return {
    observation_time_utc: new Date().toISOString(),
    readings,
    raw: json
  };
}

export async function getSensorsNowFromMock(params: {
  mappingPath: string;
  mockPath: string;
}): Promise<SensorsNow> {
  const mapping = await loadMapping(params.mappingPath);
  const raw = await fs.readFile(params.mockPath, "utf-8");
  const json = JSON.parse(raw) as any;

  const readings: RoomReading[] = mapping.rooms.map((r) => {
    const temp = coerceNumber(json[r.tempKey]);
    const rh = coerceNumber(json[r.humidityKey]);
    return { room: r.id, temp_f: temp, rh_pct: rh };
  });

  return {
    observation_time_utc: new Date().toISOString(),
    readings,
    raw: json
  };
}
