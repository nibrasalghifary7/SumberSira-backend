import { Router } from "express";
import { z } from "zod";
import { db } from "../config/database.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { toRideDto, slugify, createRideSchema, updateRideSchema } from "../models/ride.model.js";












// ---------- Publik (Flutter) ----------
export const ridesRouter = Router();

ridesRouter.get("/", async (_req, res) => {
  const rows = await db.ride.findMany({
    where: { active: true },
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });
  res.json(rows.map(toRideDto));
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
  res.json(rows.map(toRideDto));
});

// Tambah, ubah, hapus: khusus admin
adminRidesRouter.post("/", requireRole("admin"), async (req, res) => {
  const parsed = createRideSchema.safeParse(req.body);
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
  res.status(201).json(toRideDto(ride));
});

adminRidesRouter.patch("/:id", requireRole("admin"), async (req, res) => {
  const parsed = updateRideSchema.safeParse(req.body);
  if (!parsed.success || Object.keys(parsed.data).length === 0) {
    return res.status(400).json({ error: "VALIDATION" });
  }

  const id = req.params.id as string;
  const current = await db.ride.findUnique({ where: { id } });
  if (!current) return res.status(404).json({ error: "NOT_FOUND" });

  const { status, ...rest } = parsed.data;
  const ride = await db.ride.update({
    where: { id },
    data: { ...rest, ...(status !== undefined ? { active: status === "Aktif" } : {}) },
  });
  res.json(toRideDto(ride));
});

adminRidesRouter.delete("/:id", requireRole("admin"), async (req, res) => {
  const id = req.params.id as string;
  const current = await db.ride.findUnique({ where: { id } });
  if (!current) return res.status(404).json({ error: "NOT_FOUND" });

  await db.ride.delete({ where: { id } });
  res.json({ ok: true });
});