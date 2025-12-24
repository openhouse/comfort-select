// Simple psychrometrics helpers for decision support.
// - dew point (°F)
// - absolute humidity (g/m^3)
//
// These formulas are approximations good enough for control heuristics and logging.

function fToC(f: number): number {
  return (f - 32) * (5 / 9);
}
function cToF(c: number): number {
  return c * (9 / 5) + 32;
}

export function dewPointF(tempF: number, rhPct: number): number {
  // Magnus formula for dew point (in °C), then convert to °F.
  const T = fToC(tempF);
  const RH = Math.max(1e-6, Math.min(100, rhPct)) / 100;
  const a = 17.625;
  const b = 243.04; // °C

  const gamma = Math.log(RH) + (a * T) / (b + T);
  const dewC = (b * gamma) / (a - gamma);
  return cToF(dewC);
}

export function absoluteHumidityGm3(tempF: number, rhPct: number): number {
  // Approx absolute humidity in g/m^3
  // Using saturation vapor pressure (hPa) via Magnus + ideal gas.
  const T = fToC(tempF);
  const RH = Math.max(0, Math.min(100, rhPct)) / 100;

  // saturation vapor pressure (hPa)
  const es = 6.112 * Math.exp((17.67 * T) / (T + 243.5));
  const e = RH * es; // actual vapor pressure (hPa)

  // absolute humidity (g/m^3)
  // AH = 216.7 * (e / (T + 273.15))
  return 216.7 * (e / (T + 273.15));
}
