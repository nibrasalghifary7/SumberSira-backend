import { db } from "./db.js";
import { hourly, summarize, type CrowdSummary, type CrowdTicket } from "./crowd.js";
import { CAPACITY } from "./pricing.js";
import { wibAt, wibDate } from "./time.js";

// Jumlah orang pada satu tiket (dewasa + balita).
export const peopleOf = (t: { adults: number; kids: number }): number => t.adults + t.kids;

export type TicketRow = {
  adults: number;
  kids: number;
  status: CrowdTicket["status"];
  checkInAt: Date | null;
  checkOutAt: Date | null;
};

export const toCrowdTicket = (t: TicketRow): CrowdTicket => ({
  people: peopleOf(t),
  status: t.status,
  checkInAt: t.checkInAt,
  checkOutAt: t.checkOutAt,
});

export type CrowdNow = CrowdSummary & { capacity: number; date: string; updatedAt: string };

// Live Crowd dipanggil sangat sering (tiap pengunjung membuka Beranda, tiap halaman admin). Hasilnya disimpan 3 detik,
// dan dibuang segera setiap kali ada check-in, check-out, atau tiket baru, jadi angka tetap terasa langsung.
const TTL_MS = 3000;
let cache: { at: number; date: string; value: CrowdNow } | null = null;

export function invalidateCrowd(): void {
  cache = null;
  hourlyCache = null;
}

export async function getCrowd(now: Date = new Date()): Promise<CrowdNow> {
  const date = wibDate(now);
  if (cache && cache.date === date && now.getTime() - cache.at < TTL_MS) return cache.value;
  const rows = await db.ticket.findMany({
    where: { visitDate: date },
    select: { adults: true, kids: true, status: true, checkInAt: true, checkOutAt: true },
  });
  const value: CrowdNow = { ...summarize(rows.map(toCrowdTicket)), capacity: CAPACITY, date, updatedAt: now.toISOString() };
  cache = { at: now.getTime(), date, value };
  return value;
}

export type HourlyNow = {
  date: string;
  capacity: number;
  hours: number[]; // 8..16
  today: number[]; // puncak jumlah orang di dalam tiap jam hari ini (jam yang belum tiba = 0)
  usual: (number | null)[] | null; // rata-rata puncak tiap jam pada hari-hari sebelumnya (maks. 7 hari terakhir yang ada datanya), null bila belum ada riwayat
  quietest: number | null; // jam yang biasanya paling sepi menurut riwayat itu
};

const HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16];
let hourlyCache: { at: number; date: string; value: HourlyNow } | null = null;

// Grafik per jam untuk aplikasi pengunjung: kenyataan hari ini (dari tiket yang discan) dan kebiasaan hari-hari sebelumnya.
// Murni hitungan dari data tiket (bukan prediksi AI). Disimpan 10 detik karena dibuka tiap pengunjung di Beranda.
export async function getHourly(now: Date = new Date()): Promise<HourlyNow> {
  const date = wibDate(now);
  if (hourlyCache && hourlyCache.date === date && now.getTime() - hourlyCache.at < 10_000) return hourlyCache.value;

  const from = wibDate(new Date(now.getTime() - 7 * 86_400_000));
  const rows = await db.ticket.findMany({
    where: { visitDate: { gte: from, lte: date } },
    select: { visitDate: true, adults: true, kids: true, status: true, checkInAt: true, checkOutAt: true },
  });
  const byDate = new Map<string, CrowdTicket[]>();
  for (const r of rows) {
    const list = byDate.get(r.visitDate) ?? [];
    list.push(toCrowdTicket(r));
    byDate.set(r.visitDate, list);
  }

  const perHour = (d: string, until: Date) => {
    const h = hourly(byDate.get(d) ?? [], d, until);
    return HOURS.map((hr) => h.find((x) => x.hour === hr)?.peak ?? 0);
  };
  const today = perHour(date, now);

  // Hari sebelumnya yang punya orang masuk dihitung rata-rata per jam.
  const past = [...byDate.keys()].filter((d) => d < date && (byDate.get(d) ?? []).some((t) => t.checkInAt));
  let usual: (number | null)[] | null = null;
  let quietest: number | null = null;
  if (past.length > 0) {
    const sums = HOURS.map(() => 0);
    for (const d of past) perHour(d, wibAt(d, 18)).forEach((v, i) => (sums[i] += v));
    usual = sums.map((v) => Math.round(v / past.length));
    // Jam paling sepi di antara jam yang punya kunjungan (jam 0 semua tidak dihitung sebagai "sepi", itu belum ada data).
    const candidates = usual.map((v, i) => ({ v: v as number, hour: HOURS[i] })).filter((x) => x.v > 0);
    if (candidates.length) quietest = candidates.reduce((a, b) => (b.v < a.v ? b : a)).hour;
  }

  const value: HourlyNow = { date, capacity: CAPACITY, hours: HOURS, today, usual, quietest };
  hourlyCache = { at: now.getTime(), date, value };
  return value;
}
