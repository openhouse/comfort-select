export function nowUtcIso(): string {
  return new Date().toISOString();
}

export function nowLocalIso(timezone: string): string {
  const date = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(date);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";

  const yyyy = get("year");
  const mm = get("month");
  const dd = get("day");
  const hh = get("hour");
  const mi = get("minute");
  const ss = get("second");

  // Compute offset minutes between local timezone and UTC
  const localDate = new Date(
    date.toLocaleString("en-US", {
      timeZone: timezone
    })
  );
  const offsetMinutes = Math.round((localDate.getTime() - date.getTime()) / 60000);

  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absMinutes = Math.abs(offsetMinutes);
  const offsetHours = String(Math.floor(absMinutes / 60)).padStart(2, "0");
  const offsetMins = String(absMinutes % 60).padStart(2, "0");

  return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}${sign}${offsetHours}:${offsetMins}`;
}
