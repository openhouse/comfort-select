export function nowUtcIso(): string {
  return new Date().toISOString();
}

export function nowLocalIso(timezone: string, date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    hourCycle: "h23",
    timeZoneName: "longOffset"
  }).formatToParts(date);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";

  const yyyy = Number(get("year"));
  const mm = Number(get("month"));
  const dd = Number(get("day"));
  const hh = Number(get("hour"));
  const mi = Number(get("minute"));
  const ss = Number(get("second"));

  const localAsUtc = Date.UTC(yyyy, mm - 1, dd, hh, mi, ss);
  const offsetMinutes = Math.round((localAsUtc - date.getTime()) / 60000);

  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absMinutes = Math.abs(offsetMinutes);
  const offsetHours = String(Math.floor(absMinutes / 60)).padStart(2, "0");
  const offsetMins = String(absMinutes % 60).padStart(2, "0");

  const formattedDate = `${String(yyyy).padStart(4, "0")}-${String(mm).padStart(2, "0")}-${String(dd).padStart(
    2,
    "0"
  )}T${String(hh).padStart(2, "0")}:${String(mi).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;

  return `${formattedDate}${sign}${offsetHours}:${offsetMins}`;
}
