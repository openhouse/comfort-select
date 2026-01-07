import { DerivedFeatures, SensorsNow, TelemetrySummary, WeatherNow } from "../types.js";
import { absoluteHumidityGm3, dewPointF } from "../utils/psychrometrics.js";
import { PromptAssets } from "../promptAssets.js";
import { summarizeTelemetry } from "../utils/telemetry.js";
import { SiteConfig } from "../siteConfig.js";
import { buildPromptHistoryHeader } from "../history/promptHistory.js";

function toCsv(rows: string[][]): string {
  return rows
    .map((r) =>
      r
        .map((cell) => {
          const s = String(cell ?? "");
          if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
            return `"${s.replace(/"/g, '""')}"`;
          }
          return s;
        })
        .join(",")
    )
    .join("\n");
}

function buildWeatherLine(weather: WeatherNow): string {
  const parts = [
    `${weather.temp_f.toFixed(1)}°F`,
    `${weather.rh_pct.toFixed(0)}% RH`,
    weather.conditions ? `conditions: ${weather.conditions}` : null,
    `wind: ${weather.wind_mph ?? "?"} mph @ ${weather.wind_dir_deg ?? "?"}°`,
    `precip: ${weather.precip_in_hr ?? "?"} in/hr`
  ].filter(Boolean);
  return parts.join("; ");
}

function buildAdjacency(siteConfig: SiteConfig): Record<string, string[]> {
  const adjacency: Record<string, Set<string>> = {};

  const addEdge = (a: string, b: string) => {
    adjacency[a] = adjacency[a] ?? new Set<string>();
    adjacency[b] = adjacency[b] ?? new Set<string>();
    adjacency[a].add(b);
    adjacency[b].add(a);
  };

  siteConfig.rooms.forEach((room) => {
    (room.connected_room_ids ?? []).forEach((neighbor) => addEdge(room.id, neighbor));
  });

  (siteConfig.connections ?? []).forEach((edge) => addEdge(edge.from, edge.to));

  return Object.fromEntries(Object.entries(adjacency).map(([k, v]) => [k, Array.from(v)]));
}

function mapSensorsByRoom(siteConfig: SiteConfig, sensors: SensorsNow) {
  const lookup = new Map(sensors.readings.map((r) => [r.sensorId, r]));
  return siteConfig.rooms.map((room) => ({
    room,
    sensors: siteConfig.sensors
      .filter((s) => s.room_id === room.id)
      .map((sensor) => ({
        sensor,
        reading: lookup.get(sensor.id),
        dewpoint_f: lookup.get(sensor.id)
          ? Number(dewPointF(lookup.get(sensor.id)!.temp_f, lookup.get(sensor.id)!.rh_pct).toFixed(1))
          : null,
        absolute_humidity_gm3: lookup.get(sensor.id)
          ? Number(absoluteHumidityGm3(lookup.get(sensor.id)!.temp_f, lookup.get(sensor.id)!.rh_pct).toFixed(2))
          : null
      }))
  }));
}

function mapDevicesByRoom(siteConfig: SiteConfig) {
  return siteConfig.rooms.map((room) => ({
    room,
    devices: siteConfig.devices.filter((d) => d.room_id === room.id)
  }));
}

function formatFeatures(features: DerivedFeatures, siteConfig: SiteConfig) {
  const defined = (siteConfig.features ?? []).map((feature) => {
    const value = features?.[feature.id];
    const renderValue =
      value === null || value === undefined
        ? ""
        : typeof value === "number"
          ? Number(value.toFixed(2)).toString()
          : String(value);

    return {
      id: feature.id,
      description: feature.description,
      value,
      renderValue
    };
  });

  const extras = Object.entries(features ?? {})
    .filter(([id]) => !defined.find((f) => f.id === id))
    .map(([id, value]) => ({
      id,
      description: "",
      value,
      renderValue:
        value === null || value === undefined
          ? ""
          : typeof value === "number"
            ? Number(value.toFixed(2)).toString()
            : String(value)
    }));

  return [...defined, ...extras];
}

function normalizeHistoryRows(historyRows: string[][] | undefined, headerFallback: string[]): string[][] {
  if (!historyRows || historyRows.length === 0) return [headerFallback];
  return historyRows;
}

export function buildPrompt(params: {
  weather: WeatherNow;
  sensors: SensorsNow;
  telemetry?: TelemetrySummary;
  features?: DerivedFeatures;
  historyRows: string[][];
  promptMaxChars?: number;
  timezone: string;
  promptAssets: PromptAssets;
  historySummary?: string;
}): { prompt: string; promptVersion: string; siteConfigId: string } {
  const {
    weather,
    sensors,
    telemetry: telemetryInput,
    features: featuresInput,
    historyRows,
    timezone,
    promptMaxChars,
    promptAssets
  } = params;

  const telemetry = telemetryInput ?? summarizeTelemetry(promptAssets.siteConfig, sensors);
  const features = featuresInput ?? telemetry.features;

  const sensorsByRoom = mapSensorsByRoom(promptAssets.siteConfig, sensors);
  const devicesByRoom = mapDevicesByRoom(promptAssets.siteConfig);
  const adjacency = buildAdjacency(promptAssets.siteConfig);
  const featureList = formatFeatures(features, promptAssets.siteConfig);

  const fallbackHeader = buildPromptHistoryHeader(promptAssets.siteConfig);
  const rowsForCsv = normalizeHistoryRows(historyRows, fallbackHeader);
  const header = rowsForCsv[0] ?? [];
  const dataRows = rowsForCsv.slice(1);

  const renderWithHistory = (historyCsv: string) =>
    promptAssets.template.render({
      curators: promptAssets.curatorLabels,
      site: promptAssets.siteConfig.site,
      rooms: promptAssets.siteConfig.rooms,
      connections: promptAssets.siteConfig.connections,
      adjacency,
      sensorsByRoom,
      devicesByRoom,
      features: featureList,
      runtime: {
        timezone,
        weatherLine: buildWeatherLine(weather),
        sensorsObservedAt: sensors.observation_time_utc,
        roomSummaries: telemetry.rooms,
        historyCsv,
        historySummary: params.historySummary ?? ""
      }
    });

  const historyCsvFull = toCsv(rowsForCsv);

  let chosenHistoryCsv = historyCsvFull;
  let promptText = renderWithHistory(chosenHistoryCsv);

  if (promptMaxChars && promptText.length > promptMaxChars) {
    let windowSize = dataRows.length;
    while (windowSize > 0) {
      const candidateCsv = toCsv([header, ...dataRows.slice(-windowSize)]);
      const candidatePrompt = renderWithHistory(candidateCsv);
      if (candidatePrompt.length <= promptMaxChars) {
        chosenHistoryCsv = candidateCsv;
        promptText = candidatePrompt;
        break;
      }
      windowSize = Math.max(0, windowSize - Math.ceil(windowSize / 3));
    }
    if (promptText.length > promptMaxChars) {
      const headerOnlyCsv = toCsv([header]);
      chosenHistoryCsv = headerOnlyCsv;
      promptText = renderWithHistory(headerOnlyCsv);
    }
  }

  return {
    prompt: promptText,
    promptVersion: promptAssets.template.version,
    siteConfigId: promptAssets.siteConfig.site.id
  };
}
