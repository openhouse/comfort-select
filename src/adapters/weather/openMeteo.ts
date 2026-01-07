import { WeatherNow } from "../../types.js";

import { fetchWithTimeout } from "../../utils/fetchWithTimeout.js";

export async function getWeatherNow(params: {
  lat: number;
  lon: number;
  timezone: string;
  timeoutMs: number;
}): Promise<WeatherNow> {
  const { lat, lon, timezone, timeoutMs } = params;

  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lon));
  url.searchParams.set(
    "current",
    [
      "temperature_2m",
      "relative_humidity_2m",
      "wind_speed_10m",
      "wind_direction_10m",
      "precipitation"
    ].join(",")
  );
  url.searchParams.set("temperature_unit", "fahrenheit");
  url.searchParams.set("wind_speed_unit", "mph");
  url.searchParams.set("precipitation_unit", "inch");
  url.searchParams.set("timezone", timezone);

  const resp = await fetchWithTimeout(url.toString(), { timeoutMs });
  if (!resp.ok) throw new Error(`Open-Meteo error: ${resp.status} ${resp.statusText}`);
  const json = (await resp.json()) as any;

  const cur = json.current;
  if (!cur) throw new Error("Open-Meteo response missing current");

  return {
    temp_f: cur.temperature_2m,
    rh_pct: cur.relative_humidity_2m,
    wind_mph: cur.wind_speed_10m,
    wind_dir_deg: cur.wind_direction_10m,
    precip_in_hr: cur.precipitation,
    observation_time_utc: new Date().toISOString()
  };
}
