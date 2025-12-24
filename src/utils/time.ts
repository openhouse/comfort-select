export function nowUtcIso(): string {
  return new Date().toISOString();
}

export function nowLocalIso(timezone: string): string {
  // ISO-ish local string with timezone offset is tricky; we keep an unambiguous string:
  // yyyy-mm-ddThh:mm:ss in the specified timezone, plus timezone name.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(new Date());

  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "00";

  const yyyy = get("year");
  const mm = get("month");
  const dd = get("day");
  const hh = get("hour");
  const mi = get("minute");
  const ss = get("second");

  return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss} ${timezone}`;
}
