import { Router } from "express";
import { z } from "zod";
import { db } from "../lib/db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

type RideRow = {
  id: string;
  name: string;
  category: string;
  price: number;
  unit: string;
  icon: string;
  active: boolean;
};

// Bentuk yang sama dengan objek WAHANA di frontend
const toDto = (r: RideRow) => ({
  id: r.id,
  name: r.name,
  category: r.category,
  price: r.price,
  unit: r.unit,
  icon: r.icon,
  status: r.active ? "Aktif" : "Nonaktif",
});

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const baseSchema = z.object({
  name: z.string().trim().min(1).max(80),
  category: z.enum(["Sewa Alat", "Wahana"]),
  price: z.number().int().min(0).max(10_000_000),
  unit: z.string().trim().max(30),
  icon: z.string().trim().min(1).max(30),
  status: z.enum(["Aktif", "Nonaktif"]),
});

// Saat menambah: unit, icon, status boleh kosong (diisi default di bawah)
const createSchema = baseSchema.partial({ unit: true, icon: true, status: true });
// Saat mengubah: semua field boleh dikirim sebagian
const updateSchema = baseSchema.partial();

// ---------- Publik (Flutter) ----------
export const ridesRouter = Router();

ridesRouter.get("/", async (_req, res) => {
  const rows = await db.ride.findMany({
    where: { active: true },
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });
  res.json(rows.map(toDto));
});

export const slotsRouter = Router();

slotsRouter.get("/", async (_req, res) => {
  const rows = await db.timeSlot.findMany({ orderBy: { id: "asc" } });
  res.json(
    rows.map((s) => ({ id: s.id, label: s.label, range: s.timeRange, busy: s.busy })),
  );
});

// ---------- Admin (web admin) ----------
export const adminRidesRouter = Router();
adminRidesRouter.use(requireAuth); // semua rute di bawah wajib login

// Admin dan petugas boleh melihat semuanya, termasuk yang nonaktif
adminRidesRouter.get("/", async (_req, res) => {
  const rows = await db.ride.findMany({ orderBy: [{ category: "asc" }, { name: "asc" }] });
  res.json(rows.map(toDto));
});

// Tambah, ubah, hapus: khusus admin
adminRidesRouter.post("/", requireRole("admin"), async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "VALIDATION", issues: parsed.error.issues });
  }
  const d = parsed.data;

  const id = slugify(d.name);
  if (!id) return res.status(400).json({ error: "VALIDATION" });

  const exists = await db.ride.findUnique({ where: { id } });
  if (exists) return res.status(409).json({ error: "DUPLICATE" });

  const ride = await db.ride.create({
    data: {
      id,
      name: d.name,
      category: d.category,
      price: d.price,
      unit: d.unit ?? "",
      icon: d.icon ?? "ring",
      active: (d.status ?? "Aktif") === "Aktif",
    },
  });
  res.status(201).json(toDto(ride));
});

adminRidesRouter.patch("/:id", requireRole("admin"), async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success || Object.keys(parsed.data).length === 0) {
    return res.status(400).json({ error: "VALIDATION" });
  }

  const current = await db.ride.findUnique({ where: { id: req.params.id } });
  if (!current) return res.status(404).json({ error: "NOT_FOUND" });

  const { status, ...rest } = parsed.data;
  const ride = await db.ride.update({
    where: { id: req.params.id },
    data: { ...rest, ...(status !== undefined ? { active: status === "Aktif" } : {}) },
  });
  res.json(toDto(ride));
});

adminRidesRouter.delete("/:id", requireRole("admin"), async (req, res) => {
  const current = await db.ride.findUnique({ where: { id: req.params.id } });
  if (!current) return res.status(404).json({ error: "NOT_FOUND" });

  await db.ride.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});