import { WeatherNow, SensorsNow } from "../types.js";
import { SHEET_HEADER } from "../adapters/store/googleSheetsStore.js";
import { absoluteHumidityGm3, dewPointF } from "../utils/psychrometrics.js";
import { PromptAssets } from "../promptAssets.js";

function toCsv(rows: string[][]): string {
  // naive CSV renderer; good enough for prompting
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
  return `${weather.temp_f.toFixed(1)}°F, ${weather.rh_pct.toFixed(0)}% RH; wind: ${weather.wind_mph ?? "?"} mph @ ${
    weather.wind_dir_deg ?? "?"
  }°; precip: ${weather.precip_in_hr ?? "?"} in/hr`;
}

export function buildPrompt(params: {
  weather: WeatherNow;
  sensors: SensorsNow;
  historyRows: string[][];
  promptMaxChars?: number;
  timezone: string;
  promptAssets: PromptAssets;
}): { prompt: string; promptVersion: string; siteConfigId: string } {
  const { weather, sensors, historyRows, timezone, promptMaxChars, promptAssets } = params;

  const sensorLines = sensors.readings
    .map((r) => {
      const dp = dewPointF(r.temp_f, r.rh_pct);
      const ah = absoluteHumidityGm3(r.temp_f, r.rh_pct);
      return `- ${r.room}: ${r.temp_f.toFixed(1)}°F, ${r.rh_pct.toFixed(
        0
      )}% RH (dew point ~${dp.toFixed(1)}°F, abs humidity ~${ah.toFixed(1)} g/m³)`;
    })
    .join("\n");

  const rowsForCsv = historyRows.length ? historyRows : [Array.from(SHEET_HEADER)];
  const header = rowsForCsv[0] ?? [];
  const dataRows = rowsForCsv.slice(1);

  const renderWithHistory = (historyCsv: string) =>
    promptAssets.template.render({
      curators: promptAssets.curatorLabels,
      site: {
        ...promptAssets.siteConfig.site,
        rooms: promptAssets.siteConfig.rooms
      },
      devices: promptAssets.siteConfig.devices,
      runtime: {
        timezone,
        weatherLine: buildWeatherLine(weather),
        sensorLines,
        historyCsv
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
