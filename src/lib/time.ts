// Waktu Indonesia Barat (UTC+7, tanpa jam musim panas). Semua tanggal "hari ini" di tiket dan Live Crowd memakai WIB.
const WIB_MS = 7 * 3600_000;

// Tanggal WIB dari satu waktu, mis. "2026-11-11".
export const wibDate = (d: Date = new Date()): string => new Date(d.getTime() + WIB_MS).toISOString().slice(0, 10);

// Jam dan menit WIB.
export function wibClock(d: Date): { h: number; m: number } {
  const w = new Date(d.getTime() + WIB_MS);
  return { h: w.getUTCHours(), m: w.getUTCMinutes() };
}

// Jam dengan format 10.42 (sama dengan tampilan di web admin dan aplikasi).
export function wibLabel(d: Date): string {
  const { h, m } = wibClock(d);
  return `${String(h).padStart(2, "0")}.${String(m).padStart(2, "0")}`;
}

// Waktu (UTC) tepat pukul jam:menit WIB pada tanggal tertentu.
export const wibAt = (date: string, hour: number, minute = 0): Date =>
  new Date(Date.parse(`${date}T00:00:00Z`) + (hour * 60 + minute) * 60_000 - WIB_MS);
