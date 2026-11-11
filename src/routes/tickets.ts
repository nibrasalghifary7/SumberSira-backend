import { Router, type Response } from "express";
import { z } from "zod";
import { db } from "../lib/db.js";
import { hourly, timeline } from "../lib/crowd.js";
import { getCrowd, getHourly, invalidateCrowd, peopleOf, toCrowdTicket } from "../lib/crowd-service.js";
import { isValidWhatsapp, normalizeWhatsapp } from "../lib/phone.js";
import { CAPACITY, ticketTotal } from "../lib/pricing.js";
import { allow } from "../lib/ratelimit.js";
import { wibAt, wibDate } from "../lib/time.js";
import { requireAuth } from "../middleware/auth.js";

type TicketRow = {
  id: string;
  no: number;
  name: string;
  whatsapp: string;
  adults: number;
  kids: number;
  parking: string;
  payment: string;
  total: number;
  arrival: string;
  source: string;
  visitDate: string;
  status: string;
  boughtAt: Date;
  checkInAt: Date | null;
  checkOutAt: Date | null;
};

export const ticketCode = (no: number) => `TK-${1000 + no}`;

const toDto = (t: TicketRow) => ({
  id: t.id,
  code: ticketCode(t.no),
  name: t.name,
  whatsapp: t.whatsapp,
  adults: t.adults,
  kids: t.kids,
  people: peopleOf(t),
  parking: t.parking,
  payment: t.payment,
  total: t.total,
  arrival: t.arrival,
  source: t.source,
  visitDate: t.visitDate,
  status: t.status,
  boughtAt: t.boughtAt.toISOString(),
  checkInAt: t.checkInAt?.toISOString() ?? null,
  checkOutAt: t.checkOutAt?.toISOString() ?? null,
});

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const createSchema = z.object({
  name: z.string().trim().min(2).max(60),
  whatsapp: z.string().trim().min(1).max(20), // format dicek di createTicket supaya pesannya jelas (INVALID_WHATSAPP)
  adults: z.number().int().min(1).max(50),
  kids: z.number().int().min(0).max(50).default(0),
  parking: z.enum(["none", "motor", "mobil", "bus"]).default("none"),
  payment: z.enum(["qris", "cash"]).default("qris"),
  arrival: z.string().trim().max(30).default(""),
  visitDate: dateStr.optional(),
});

// Tiket baru. Harga selalu dihitung di server (bukan dari kiriman klien) supaya tidak bisa dimanipulasi.
async function createTicket(input: z.infer<typeof createSchema>, today: string, source: "app" | "loket") {
  const whatsapp = normalizeWhatsapp(input.whatsapp);
  if (!isValidWhatsapp(whatsapp)) return { error: "INVALID_WHATSAPP" as const };
  const visitDate = input.visitDate ?? today;
  // Tidak boleh tanggal lampau, dan paling jauh 30 hari ke depan.
  const maxDate = wibDate(new Date(Date.parse(`${today}T00:00:00Z`) + 30 * 86_400_000));
  if (visitDate < today || visitDate > maxDate) return { error: "INVALID_DATE" as const };
  const ticket = await db.ticket.create({
    data: {
      name: input.name,
      whatsapp,
      adults: input.adults,
      kids: input.kids,
      parking: input.parking,
      payment: input.payment,
      arrival: input.arrival,
      source,
      visitDate,
      total: ticketTotal(input.adults, input.parking),
    },
  });
  invalidateCrowd();
  return { ticket };
}

// ---------- Publik (aplikasi pengunjung dan layar login) ----------
export const ticketsRouter = Router();

// Beli tiket masuk
ticketsRouter.post("/", async (req, res) => {
  if (!allow(`buy:${req.ip}`, 60, 3600_000)) return res.status(429).json({ error: "TOO_MANY_REQUESTS" });
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "VALIDATION", issues: parsed.error.issues });
  const result = await createTicket(parsed.data, wibDate(), "app");
  if ("error" in result) return res.status(400).json({ error: result.error });
  res.status(201).json(toDto(result.ticket));
});

// Riwayat tiket: dicari dengan nomor WhatsApp yang dipakai saat membeli (tanpa login, sesuai desain aplikasi)
ticketsRouter.get("/", async (req, res) => {
  if (!allow(`hist:${req.ip}`, 60, 60_000)) return res.status(429).json({ error: "TOO_MANY_REQUESTS" });
  const whatsapp = normalizeWhatsapp(String(req.query.whatsapp ?? ""));
  if (!isValidWhatsapp(whatsapp)) return res.status(400).json({ error: "INVALID_WHATSAPP" });
  const rows = await db.ticket.findMany({ where: { whatsapp }, orderBy: { boughtAt: "desc" }, take: 20 });
  res.json(rows.map(toDto));
});

// "TK-1043" -> 43 (nomor urut di database), atau null bila bentuknya bukan kode tiket.
function ticketNo(code: string): number | null {
  const m = /^TK-(\d+)$/i.exec(code);
  const no = m ? Number(m[1]) - 1000 : NaN;
  return Number.isInteger(no) && no >= 1 && no < 2_000_000_000 ? no : null;
}

// Status satu tiket (dipakai e-tiket untuk melihat apakah sudah discan). Sengaja tanpa nama dan nomor WhatsApp.
ticketsRouter.get("/:code/status", async (req, res) => {
  const no = ticketNo(String(req.params.code));
  if (no === null) return res.status(404).json({ error: "NOT_FOUND" });
  const t = await db.ticket.findUnique({ where: { no } });
  if (!t) return res.status(404).json({ error: "NOT_FOUND" });
  res.json({
    code: ticketCode(t.no),
    status: t.status,
    visitDate: t.visitDate,
    checkInAt: t.checkInAt?.toISOString() ?? null,
    checkOutAt: t.checkOutAt?.toISOString() ?? null,
  });
});

// Live Crowd saat ini
export const crowdRouter = Router();
crowdRouter.get("/", async (_req, res) => {
  res.json(await getCrowd());
});

// Grafik per jam hari ini untuk Beranda aplikasi pengunjung (angka ringkas, tanpa data pengunjung)
crowdRouter.get("/hourly", async (_req, res) => {
  res.json(await getHourly());
});

// ---------- Admin (admin dan petugas) ----------
export const adminTicketsRouter = Router();
adminTicketsRouter.use(requireAuth);

// Daftar tiket satu hari (bawaan hari ini) beserta ringkasan keramaian
adminTicketsRouter.get("/", async (req, res) => {
  const date = dateStr.safeParse(req.query.date).data ?? wibDate();
  // Daftar dan keramaian diambil bersamaan: database di Neon jauh, tiap query berurutan menambah ratusan milidetik.
  const [rows, crowd] = await Promise.all([
    db.ticket.findMany({ where: { visitDate: date }, orderBy: { no: "desc" } }),
    date === wibDate() ? getCrowd() : Promise.resolve(null),
  ]);
  res.json({ date, tickets: rows.map(toDto), crowd });
});

// Cari satu tiket dari kodenya, tanggal berapa pun (untuk scan tiket yang berlaku hari lain)
adminTicketsRouter.get("/code/:code", async (req, res) => {
  const no = ticketNo(String(req.params.code));
  const t = no === null ? null : await db.ticket.findUnique({ where: { no } });
  if (!t) return res.status(404).json({ error: "NOT_FOUND" });
  res.json(toDto(t));
});

// Penjualan di loket (pengunjung yang membeli langsung)
adminTicketsRouter.post("/", async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "VALIDATION", issues: parsed.error.issues });
  const result = await createTicket(parsed.data, wibDate(), "loket");
  if ("error" in result) return res.status(400).json({ error: result.error });
  res.status(201).json(toDto(result.ticket));
});

// Check-in: hanya tiket yang berlaku hari ini, belum masuk, dan selama kapasitas masih cukup. updateMany bersyarat membuat
// dua petugas yang menekan tombol bersamaan tidak menghitung orang yang sama dua kali.
adminTicketsRouter.post("/:id/check-in", async (req, res) => {
  const id = String(req.params.id);
  const now = new Date();
  const today = wibDate(now);
  const [t, inside] = await Promise.all([
    db.ticket.findUnique({ where: { id } }),
    db.ticket.aggregate({ where: { visitDate: today, status: "inside" }, _sum: { adults: true, kids: true } }),
  ]);
  if (!t) return res.status(404).json({ error: "NOT_FOUND" });
  if (t.status !== "waiting") return res.status(409).json({ error: "WRONG_STATE" });
  if (t.visitDate !== today) return res.status(409).json({ error: "NOT_VALID_TODAY" });
  const insideNow = (inside._sum.adults ?? 0) + (inside._sum.kids ?? 0);
  if (insideNow + peopleOf(t) > CAPACITY) return res.status(409).json({ error: "CAPACITY_FULL", inside: insideNow, capacity: CAPACITY });

  const { count } = await db.ticket.updateMany({ where: { id, status: "waiting", visitDate: today }, data: { status: "inside", checkInAt: now } });
  if (count === 0) return res.status(409).json({ error: "WRONG_STATE" });
  invalidateCrowd();
  const [ticket, crowd] = await Promise.all([db.ticket.findUniqueOrThrow({ where: { id } }), getCrowd()]);
  res.json({ ticket: toDto(ticket), crowd });
});

// Check-out: hanya tiket yang sedang di dalam.
adminTicketsRouter.post("/:id/check-out", async (req, res) => {
  const id = String(req.params.id);
  const now = new Date();
  const { count } = await db.ticket.updateMany({
    where: { id, status: "inside" },
    data: { status: "out", checkOutAt: now },
  });
  if (count === 0) return conflict(res, await whyNotChangeable(id));
  invalidateCrowd();
  const [ticket, crowd] = await Promise.all([db.ticket.findUniqueOrThrow({ where: { id } }), getCrowd()]);
  res.json({ ticket: toDto(ticket), crowd });
});

// Tiket tidak ada = 404, tiket ada tapi statusnya tidak cocok = 409.
const conflict = (res: Response, error: string) => res.status(error === "NOT_FOUND" ? 404 : 409).json({ error });

async function whyNotChangeable(id: string): Promise<string> {
  return (await db.ticket.findUnique({ where: { id }, select: { id: true } })) ? "WRONG_STATE" : "NOT_FOUND";
}

// ---------- Insight: grafik keramaian dari tiket yang discan (tanpa AI) ----------
export const adminInsightRouter = Router();
adminInsightRouter.use(requireAuth);

adminInsightRouter.get("/", async (req, res) => {
  const now = new Date();
  const today = wibDate(now);
  const date = dateStr.safeParse(req.query.date).data ?? today;
  const [rows, crowdNow] = await Promise.all([
    db.ticket.findMany({ where: { visitDate: date } }),
    date === today ? getCrowd(now) : Promise.resolve(null),
  ]);
  const crowd = rows.map(toCrowdTicket);
  // Hari yang sudah lewat dihitung sampai tutup (18.00), hari ini sampai sekarang, hari depan belum ada data.
  const until = date < today ? wibAt(date, 18) : now;
  const future = date > today;
  const points = future ? [] : timeline(crowd, date, until);
  const hours = future ? [] : hourly(crowd, date, until);
  const peak = hours.reduce<{ hour: number; peak: number; percent: number } | null>((b, h) => (!b || h.peak > b.peak ? h : b), null);
  const sold = rows.length;
  res.json({
    date,
    summary: {
      sold,
      people: rows.reduce((n, t) => n + peopleOf(t), 0),
      revenue: rows.reduce((n, t) => n + t.total, 0),
      entered: rows.filter((t) => t.status !== "waiting").reduce((n, t) => n + peopleOf(t), 0),
      peak: peak && peak.peak > 0 ? peak : null,
      // Rincian tiket hari itu (jumlah tiket, bukan orang)
      payment: { qris: rows.filter((t) => t.payment === "qris").length, cash: rows.filter((t) => t.payment === "cash").length },
      parking: {
        none: rows.filter((t) => t.parking === "none").length,
        motor: rows.filter((t) => t.parking === "motor").length,
        mobil: rows.filter((t) => t.parking === "mobil").length,
        bus: rows.filter((t) => t.parking === "bus").length,
      },
      source: { app: rows.filter((t) => t.source === "app").length, loket: rows.filter((t) => t.source === "loket").length },
    },
    timeline: points,
    hourly: hours,
    crowd: crowdNow,
  });
});

const DAY_NAMES = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
const WEEK_HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16];

// Pola keramaian 7 hari terakhir (persen kapasitas puncak per jam), dihitung dari tiket yang discan. Dipakai heatmap dashboard.
adminInsightRouter.get("/week", async (_req, res) => {
  const now = new Date();
  const today = wibDate(now);
  const dates = Array.from({ length: 7 }, (_, i) => wibDate(new Date(now.getTime() - (6 - i) * 86_400_000)));
  const rows = await db.ticket.findMany({ where: { visitDate: { in: dates } } });
  const days = dates.map((date) => {
    const tickets = rows.filter((t) => t.visitDate === date).map(toCrowdTicket);
    const perHour = hourly(tickets, date, date === today ? now : wibAt(date, 18));
    return {
      date,
      day: DAY_NAMES[new Date(`${date}T00:00:00Z`).getUTCDay()],
      values: WEEK_HOURS.map((h) => perHour.find((x) => x.hour === h)?.percent ?? 0),
    };
  });
  // Catatan satu kalimat dari angka (bukan AI): hari dan jam dengan keramaian tertinggi.
  let best = { day: "", hour: 0, value: 0 };
  for (const d of days) d.values.forEach((v, i) => v > best.value && (best = { day: d.day, hour: WEEK_HOURS[i], value: v }));
  const note =
    best.value === 0
      ? "Belum ada data keramaian minggu ini. Grafik terisi saat tiket discan masuk."
      : `Paling ramai ${best.day} pukul ${String(best.hour).padStart(2, "0")}.00 (${best.value}% kapasitas).`;
  res.json({ hours: WEEK_HOURS.map((h) => String(h).padStart(2, "0")), days, note });
});
