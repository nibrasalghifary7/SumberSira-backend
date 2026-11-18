/**
 * Helper waktu untuk zona Asia/Jakarta (WIB)
 */

export function jakartaDate(d: Date = new Date()): string {
  // Format YYYY-MM-DD sesuai zona waktu Asia/Jakarta
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(d);
}

export function startOfDayJakarta(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00+07:00`);
}

export function compactDate(dateStr: string): string {
  return dateStr.replace(/-/g, "");
}
