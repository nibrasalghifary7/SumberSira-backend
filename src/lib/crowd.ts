import { CAPACITY } from "./pricing.js";
import { wibAt, wibLabel } from "./time.js";

// Perhitungan Live Crowd dari tiket yang discan. Semuanya fungsi murni (tanpa database) supaya mudah diuji.
// Aturan: tiket check-in menaikkan angka, check-out menurunkannya, dan hanya tiket hari itu yang dihitung.

export type CrowdTicket = {
  people: number; // dewasa + balita
  status: "waiting" | "inside" | "out";
  checkInAt: Date | null;
  checkOutAt: Date | null;
};

// Label keramaian: di bawah 40% Sepi, sampai 75% Sedang, di atasnya Ramai (sama dengan aplikasi).
export const crowdLabel = (percent: number): "Sepi" | "Sedang" | "Ramai" => (percent < 40 ? "Sepi" : percent <= 75 ? "Sedang" : "Ramai");

// Dibatasi 0 sampai 100 supaya grafik tidak melewati batas bila pengunjung melebihi kapasitas.
export const toPercent = (inside: number): number => Math.min(100, Math.max(0, Math.round((inside / CAPACITY) * 100)));

// Jumlah orang yang ada di dalam pada satu waktu tertentu.
export function insideAt(tickets: CrowdTicket[], at: Date): number {
  let n = 0;
  for (const t of tickets) {
    if (t.checkInAt && t.checkInAt <= at && (!t.checkOutAt || t.checkOutAt > at)) n += t.people;
  }
  return n;
}

export type CrowdSummary = { inside: number; percent: number; label: string; waiting: number; out: number; sold: number };

// Ringkasan saat ini dari status tiket (sumber kebenaran: status di database).
export function summarize(tickets: CrowdTicket[]): CrowdSummary {
  const sum = (s: CrowdTicket["status"]) => tickets.filter((t) => t.status === s).reduce((n, t) => n + t.people, 0);
  const inside = sum("inside");
  const percent = toPercent(inside);
  return { inside, percent, label: crowdLabel(percent), waiting: sum("waiting"), out: sum("out"), sold: tickets.length };
}

export type TimelinePoint = { at: string; label: string; inside: number; percent: number };

// Grafik naik turun sepanjang hari: titik tiap 30 menit sejak pukul 08.00 sampai sekarang, ditutup dengan titik "sekarang"
// supaya check-in atau check-out yang baru terjadi langsung terlihat.
export function timeline(tickets: CrowdTicket[], date: string, now: Date, stepMin = 30): TimelinePoint[] {
  const points: Date[] = [];
  for (let t = wibAt(date, 8); t <= now && points.length < 40; t = new Date(t.getTime() + stepMin * 60_000)) points.push(t);
  if (now >= wibAt(date, 8) && (points.length === 0 || points[points.length - 1].getTime() !== now.getTime())) points.push(now);
  return points.map((at) => {
    const inside = insideAt(tickets, at);
    return { at: at.toISOString(), label: wibLabel(at), inside, percent: toPercent(inside) };
  });
}

export type HourPoint = { hour: number; peak: number; percent: number };

// Puncak jumlah orang di dalam pada tiap jam (08 sampai 17). Jam yang belum tiba tidak ikut.
// Jumlah orang hanya berubah saat ada check-in atau check-out, jadi puncaknya ada di awal jam atau saat check-in.
export function hourly(tickets: CrowdTicket[], date: string, now: Date): HourPoint[] {
  const out: HourPoint[] = [];
  for (let h = 8; h <= 17; h++) {
    const start = wibAt(date, h);
    if (start > now) break;
    const end = wibAt(date, h + 1);
    const candidates = [start, ...tickets.filter((t) => t.checkInAt && t.checkInAt > start && t.checkInAt < end && t.checkInAt <= now).map((t) => t.checkInAt as Date)];
    const peak = Math.max(...candidates.map((c) => insideAt(tickets, c)));
    out.push({ hour: h, peak, percent: toPercent(peak) });
  }
  return out;
}
