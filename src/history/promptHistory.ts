import { CycleRecord, Decision, PlugState, Sensor, TransomState } from "../types.js";
import { SiteConfig } from "../siteConfig.js";

function pickSensorsForPrompt(siteConfig: SiteConfig): Sensor[] {
  const prioritized = siteConfig.sensors.filter(
    (sensor) =>
      sensor.is_primary_for_room ||
      sensor.tags?.includes("prompt_history") ||
      sensor.role === "radiator_proximity" ||
      sensor.role === "window_proximity"
  );
  if (prioritized.length > 0) return prioritized;
  return siteConfig.sensors;
}

function deviceColumns(deviceId: string, suffix: string): string[] {
  const base = [`device__${deviceId}__power_${suffix}`];
  if (deviceId.includes("transom")) {
    base.push(`device__${deviceId}__direction_${suffix}`, `device__${deviceId}__speed_${suffix}`);
  }
  return base;
}

export function buildPromptHistoryHeader(siteConfig: SiteConfig): string[] {
  const header: string[] = [
    "timestamp_local_iso",
    "timestamp_utc_iso",
    "weather__outside__temp_f",
    "weather__outside__rh_pct",
    "weather__outside__wind_mph",
    "weather__outside__wind_dir_deg",
    "weather__outside__precip_in_hr"
  ];

  pickSensorsForPrompt(siteConfig).forEach((sensor) => {
    header.push(`temp_f__${sensor.id}`, `rh__${sensor.id}`);
  });

  siteConfig.rooms
    .filter((room) => !room.exterior)
    .forEach((room) => {
      header.push(`temp_f_mean__${room.id}`, `rh_mean__${room.id}`);
    });

  (siteConfig.features ?? []).forEach((feature) => header.push(`feature__${feature.id}`));

  siteConfig.devices.forEach((device) => {
    header.push(...deviceColumns(device.id, "req"));
  });
  siteConfig.devices.forEach((device) => {
    header.push(...deviceColumns(device.id, "applied"));
  });

  header.push("hypothesis", "confidence_0_1", "actuation_ok", "actuation_errors_compact");

  return header;
}

function flattenDeviceState(state: any, suffix: string, baseId: string, into: Record<string, any>) {
  into[`device__${baseId}__power_${suffix}`] = state?.power ?? "";
  if (baseId.includes("transom")) {
    into[`device__${baseId}__direction_${suffix}`] = state?.direction ?? "";
    into[`device__${baseId}__speed_${suffix}`] = state?.speed ?? "";
  }
}

export function cycleRecordToPromptHistoryRow(
  rec: CycleRecord,
  siteConfig: SiteConfig,
  header: string[]
): (string | number | boolean)[] {
  const values: Record<string, string | number | boolean> = {
    timestamp_local_iso: rec.timestamp_local_iso,
    timestamp_utc_iso: rec.timestamp_utc_iso,
    weather__outside__temp_f: rec.weather.temp_f,
    weather__outside__rh_pct: rec.weather.rh_pct,
    weather__outside__wind_mph: rec.weather.wind_mph ?? "",
    weather__outside__wind_dir_deg: rec.weather.wind_dir_deg ?? "",
    weather__outside__precip_in_hr: rec.weather.precip_in_hr ?? ""
  };

  pickSensorsForPrompt(siteConfig).forEach((sensor) => {
    const reading = rec.sensors.readings.find((r) => r.sensorId === sensor.id);
    values[`temp_f__${sensor.id}`] = reading?.temp_f ?? "";
    values[`rh__${sensor.id}`] = reading?.rh_pct ?? "";
  });

  siteConfig.rooms
    .filter((room) => !room.exterior)
    .forEach((room) => {
      const roomTelemetry = rec.telemetry.rooms.find((r) => r.roomId === room.id);
      values[`temp_f_mean__${room.id}`] = roomTelemetry?.stats?.temp_f?.mean ?? "";
      values[`rh_mean__${room.id}`] = roomTelemetry?.stats?.rh_pct?.mean ?? "";
    });

  (siteConfig.features ?? []).forEach((feature) => {
    values[`feature__${feature.id}`] = rec.features?.[feature.id] ?? "";
  });

  siteConfig.devices.forEach((device) => {
    flattenDeviceState(rec.decision.actions[device.id as keyof Decision["actions"]], "req", device.id, values);
  });
  siteConfig.devices.forEach((device) => {
    flattenDeviceState(rec.actuation.applied[device.id as keyof Decision["actions"]], "applied", device.id, values);
  });

  const compactErrors = rec.actuation.errors.join(" | ");

  values.hypothesis = rec.decision.hypothesis.slice(0, 200);
  values.confidence_0_1 = rec.decision.confidence_0_1;
  values.actuation_ok = rec.actuation.actuation_ok;
  values.actuation_errors_compact = compactErrors.length > 280 ? `${compactErrors.slice(0, 277)}...` : compactErrors;

  return header.map((key) => values[key] ?? "");
}

function transomStateEqual(a?: TransomState, b?: TransomState): boolean {
  if (!a || !b) return false;
  return a.power === b.power && a.direction === b.direction && a.speed === b.speed && a.auto === b.auto && a.set_temp_f === b.set_temp_f;
}

function plugStateEqual(a?: PlugState, b?: PlugState): boolean {
  if (!a || !b) return false;
  return a.power === b.power;
}

function describeTransomState(state?: TransomState): string {
  if (!state) return "unknown";
  if (state.power === "OFF") return "OFF";
  return `${state.direction}/${state.speed}`;
}

function describePlugState(state?: PlugState): string {
  if (!state) return "unknown";
  return state.power;
}

function findLastActuationChange(records: CycleRecord[]): string | null {
  for (let i = records.length - 1; i > 0; i -= 1) {
    const current = records[i];
    const prev = records[i - 1];
    if (!current?.actuation?.applied || !prev?.actuation?.applied) continue;

    const pairs: [string, any, any][] = [
      ["kitchen_transom", current.actuation.applied.kitchen_transom, prev.actuation.applied.kitchen_transom],
      ["bathroom_transom", current.actuation.applied.bathroom_transom, prev.actuation.applied.bathroom_transom],
      ["kitchen_vornado_630", current.actuation.applied.kitchen_vornado_630, prev.actuation.applied.kitchen_vornado_630],
      ["living_vornado_630", current.actuation.applied.living_vornado_630, prev.actuation.applied.living_vornado_630]
    ];

    for (const [device, nowState, prevState] of pairs) {
      if (
        (device.includes("transom") && !transomStateEqual(nowState, prevState)) ||
        (device.includes("vornado") && !plugStateEqual(nowState, prevState))
      ) {
        const describe =
          device.includes("transom") && nowState?.direction
            ? describeTransomState(nowState)
            : describePlugState(nowState);
        const describePrev =
          device.includes("transom") && prevState?.direction
            ? describeTransomState(prevState)
            : describePlugState(prevState);
        return `${device} changed ${describePrev} -> ${describe} at ${current.timestamp_local_iso}`;
      }
    }
  }
  return null;
}

function formatDeltaLine(label: string, start?: number | null, end?: number | null, unit = ""): string | null {
  if (start === undefined || start === null || end === undefined || end === null) return null;
  const delta = end - start;
  const deltaStr = delta === 0 ? "0" : delta.toFixed(1);
  return `${label}: ${end.toFixed(1)}${unit} (Δ ${deltaStr}${unit})`;
}

function summarizeTrends(records: CycleRecord[], siteConfig: SiteConfig): string[] {
  if (records.length === 0) return [];
  const first = records[0];
  const last = records[records.length - 1];
  const lines: string[] = [];

  lines.push(`window: ${records.length} rows (${first.timestamp_local_iso} -> ${last.timestamp_local_iso})`);

  const lastChange = findLastActuationChange(records);
  lines.push(lastChange ?? "last actuation change: none (all stable in window)");

  siteConfig.rooms
    .filter((room) => !room.exterior)
    .forEach((room) => {
      const firstRoom = first.telemetry.rooms.find((r) => r.roomId === room.id);
      const lastRoom = last.telemetry.rooms.find((r) => r.roomId === room.id);
      const tempLine = formatDeltaLine(
        `${room.id} temp`,
        firstRoom?.stats?.temp_f?.mean ?? null,
        lastRoom?.stats?.temp_f?.mean ?? null,
        "°F"
      );
      const rhLine = formatDeltaLine(
        `${room.id} RH`,
        firstRoom?.stats?.rh_pct?.mean ?? null,
        lastRoom?.stats?.rh_pct?.mean ?? null,
        "%RH"
      );
      if (tempLine) lines.push(tempLine);
      if (rhLine) lines.push(rhLine);
    });

  (siteConfig.features ?? []).forEach((feature) => {
    const firstVal = first.features?.[feature.id];
    const lastVal = last.features?.[feature.id];
    const line = formatDeltaLine(`feature ${feature.id}`, firstVal, lastVal);
    if (line) lines.push(line);
  });

  return lines;
}

function capSummary(summaryLines: string[], maxChars = 1200): string {
  const text = summaryLines.join("\n");
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 3)}...`;
}

export function buildPromptHistoryWindow(params: {
  records: CycleRecord[];
  siteConfig: SiteConfig;
  maxRows: number;
  maxMinutes?: number;
  summaryMaxChars?: number;
}): { historyRows: string[][]; historySummary: string; lastApplied?: Decision["actions"] } {
  const { records, siteConfig, maxRows, maxMinutes, summaryMaxChars } = params;
  if (!records || records.length === 0) {
    const header = buildPromptHistoryHeader(siteConfig);
    return {
      historyRows: [header],
      historySummary: "No history available (Mongo not reachable or empty)."
    };
  }

  const header = buildPromptHistoryHeader(siteConfig);
  const latest = records[records.length - 1];
  const cutoff =
    maxMinutes && latest?.timestamp_utc_iso
      ? Date.parse(latest.timestamp_utc_iso) - maxMinutes * 60 * 1000
      : undefined;

  const recent = cutoff ? records.filter((rec) => Date.parse(rec.timestamp_utc_iso) >= cutoff) : records;
  const trimmed = recent.slice(-maxRows);
  const rows = trimmed.map((rec) => cycleRecordToPromptHistoryRow(rec, siteConfig, header)).map((r) => r.map(String));

  const summary = capSummary(summarizeTrends(trimmed, siteConfig), summaryMaxChars ?? 1200);

  return {
    historyRows: [header, ...rows],
    historySummary: summary,
    lastApplied: latest?.actuation?.applied
  };
}
