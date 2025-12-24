import { WeatherNow, SensorsNow } from "../types.js";
import { SHEET_HEADER } from "../adapters/store/googleSheetsStore.js";
import { absoluteHumidityGm3, dewPointF } from "../utils/psychrometrics.js";

function toCsv(rows: string[][]): string {
  // naive CSV renderer; good enough for prompting
  return rows
    .map((r) =>
      r
        .map((cell) => {
          const s = String(cell ?? "");
          if (s.includes(",") || s.includes('"') || s.includes("\\n")) {
            return `"${s.replace(/"/g, '""')}"`;
          }
          return s;
        })
        .join(",")
    )
    .join("\n");
}

export function buildPrompt(params: {
  weather: WeatherNow;
  sensors: SensorsNow;
  historyRows: string[][];
  timezone: string;
}): string {
  const { weather, sensors, historyRows, timezone } = params;

  const sensorLines = sensors.readings
    .map((r) => {
      const dp = dewPointF(r.temp_f, r.rh_pct);
      const ah = absoluteHumidityGm3(r.temp_f, r.rh_pct);
      return `- ${r.room}: ${r.temp_f.toFixed(1)}°F, ${r.rh_pct.toFixed(
        0
      )}% RH (dew point ~${dp.toFixed(1)}°F, abs humidity ~${ah.toFixed(
        1
      )} g/m³)`;
    })
    .join("\n");

  const historyCsv = toCsv(
    historyRows.length ? historyRows : [Array.from(SHEET_HEADER)]
  );

  return `Please role play as Gail S. Brager, Stefano Schiavon, and Deborah Treisman:
- indicate who is speaking
- say what you think

Important: This is an imagined panel inspired by these experts' public work. Do NOT claim to be them or to speak for them.

You are deciding how to run mechanical ventilation and mixing fans in a Brooklyn apartment to maximize comfort across rooms.

Apartment facts (static):
- Address: 196 Clinton Ave, Apt D43, Brooklyn, NY 11205.
- Steam radiators exist and are NOT controllable.
- Vornado Transom AE fans: one in the bathroom window, one in the kitchen window. These are the only active ventilation in those rooms.
- Vornado 630 air circulators: one on the living room floor near the steam radiator; one in the kitchen above the fridge. These are mixing fans (recirculate indoor air).
- Bedroom has a ceiling fan (not controlled in this MVP).
- Exterior windows: bedroom (2), bathroom (1), living room (2), kitchen (1).
- Connectivity: Foyer connects to stairwell landing, kitchen, living room. Living room connects to back hall. Back hall connects to bathroom and bedroom.

Your job each cycle:
1) Review the current weather + sensor readings.
2) Review the full time-series history provided.
3) Produce:
   - A short panel discussion with each speaker identified.
   - A concrete action plan (device states) for this cycle.
   - A brief hypothesis (theory of change).
   - Confidence 0-1.
   - Optional short predictions of what should change by next cycle.

Current context:
- Local timezone: ${timezone}
- Outdoor now: ${weather.temp_f.toFixed(1)}°F, ${weather.rh_pct.toFixed(0)}% RH
  wind: ${weather.wind_mph ?? "?"} mph, dir: ${weather.wind_dir_deg ?? "?"}°
  precip: ${weather.precip_in_hr ?? "?"} in/hr
- Indoor sensors now:
${sensorLines}

Constraints:
- You MUST output valid JSON that matches the provided schema exactly (no extra keys, no surrounding commentary).
- Valid Transom direction: EXHAUST or DIRECT.
- Valid Transom speed: LOW, MED, HIGH, TURBO.
- set_temp_f must be an integer 60-90 (meaningful when auto=true).
- Vornado 630 plugs can only be ON or OFF.

Time-series history (CSV; first row is header):
${historyCsv}
`;
}
