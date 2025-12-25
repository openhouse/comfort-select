import fs from "node:fs/promises";
import { SensorReading, SensorsNow } from "../../types.js";
import { logger } from "../../utils/logger.js";
import { fetchWithTimeout } from "../../utils/fetchWithTimeout.js";

type MappingEntry = {
  id: string;
  tempKey: string;
  humidityKey: string;
};

type MappingFile = { sensors: MappingEntry[] };

function coerceNumber(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  throw new Error(`Expected number, got: ${JSON.stringify(v)}`);
}

async function loadMapping(path: string): Promise<MappingFile> {
  const raw = await fs.readFile(path, "utf-8");
  return JSON.parse(raw) as MappingFile;
}

function findValue(payload: any, key: string): unknown {
  if (payload === null || payload === undefined) return undefined;
  if (typeof payload !== "object") return undefined;

  if (Object.prototype.hasOwnProperty.call(payload, key)) {
    const found = (payload as any)[key];
    if (found && typeof found === "object" && Object.prototype.hasOwnProperty.call(found, "value")) {
      return (found as any).value;
    }
    return found;
  }

  for (const value of Object.values(payload)) {
    const found = findValue(value, key);
    if (found !== undefined) return found;
  }

  return undefined;
}

async function getDeviceMac(params: {
  baseUrl: string;
  applicationKey: string;
  apiKey: string;
  preferredMac?: string;
  timeoutMs: number;
}): Promise<string> {
  if (params.preferredMac) return params.preferredMac;

  const url = new URL("/api/v3/device/list", params.baseUrl);
  url.searchParams.set("application_key", params.applicationKey);
  url.searchParams.set("api_key", params.apiKey);
  url.searchParams.set("limit", "10");
  url.searchParams.set("page", "1");

  const resp = await fetchWithTimeout(url.toString(), { timeoutMs: params.timeoutMs });
  if (!resp.ok) throw new Error(`Ecowitt Cloud device/list error: ${resp.status} ${resp.statusText}`);
  const json = (await resp.json()) as any;

  const items = Array.isArray(json?.data?.items)
    ? json.data.items
    : Array.isArray(json?.data)
      ? json.data
      : [];

  const first = items[0];
  const mac =
    first?.mac ??
    first?.device_mac ??
    first?.macAddress ??
    first?.device_id ??
    first?.id;

  if (!mac) {
    logger.error({ payload: json }, "Unable to determine device MAC from Ecowitt Cloud device/list");
    throw new Error("Ecowitt Cloud device/list did not return any devices");
  }

  return mac;
}

async function fetchRealTime(params: {
  baseUrl: string;
  applicationKey: string;
  apiKey: string;
  mac: string;
  timeoutMs: number;
}): Promise<any> {
  const url = new URL("/api/v3/device/real_time", params.baseUrl);
  url.searchParams.set("application_key", params.applicationKey);
  url.searchParams.set("api_key", params.apiKey);
  url.searchParams.set("mac", params.mac);
  url.searchParams.set("call_back", "all");

  const resp = await fetchWithTimeout(url.toString(), { timeoutMs: params.timeoutMs });
  if (!resp.ok) throw new Error(`Ecowitt Cloud device/real_time error: ${resp.status} ${resp.statusText}`);
  return (await resp.json()) as any;
}

export async function getSensorsNowFromCloud(params: {
  mappingPath: string;
  applicationKey: string;
  apiKey: string;
  preferredMac?: string;
  baseUrl?: string;
  timeoutMs: number;
}): Promise<SensorsNow> {
  const mapping = await loadMapping(params.mappingPath);
  const baseUrl = params.baseUrl ?? "https://api.ecowitt.net";

  const mac = await getDeviceMac({
    baseUrl,
    applicationKey: params.applicationKey,
    apiKey: params.apiKey,
    preferredMac: params.preferredMac?.trim() || undefined,
    timeoutMs: params.timeoutMs
  });

  const payload = await fetchRealTime({
    baseUrl,
    applicationKey: params.applicationKey,
    apiKey: params.apiKey,
    mac,
    timeoutMs: params.timeoutMs
  });

  if (process.env.NODE_ENV !== "production") {
    logger.debug({ payload }, "Ecowitt Cloud real_time payload");
  }

  const dataRoot = payload?.data ?? payload;

  const readings: SensorReading[] = mapping.sensors.map((r) => {
    const tempVal = findValue(dataRoot, r.tempKey);
    const rhVal = findValue(dataRoot, r.humidityKey);
    if (tempVal === undefined || rhVal === undefined) {
      throw new Error(
        `Ecowitt Cloud payload missing keys for ${r.id}: tempKey=${r.tempKey}, humidityKey=${r.humidityKey}`
      );
    }
    return { sensorId: r.id, temp_f: coerceNumber(tempVal), rh_pct: coerceNumber(rhVal) };
  });

  return {
    observation_time_utc: new Date().toISOString(),
    readings,
    raw: payload
  };
}
