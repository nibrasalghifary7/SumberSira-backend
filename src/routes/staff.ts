import { Router } from "express";
import { z } from "zod";
import { db } from "../lib/db.js";
import { hashPassword } from "../lib/password.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

export const adminStaffRouter = Router();

const createStaffSchema = z.object({
  name: z.string().trim().min(1).max(60),
  email: z.string().trim().email(),
  role: z.enum(["petugas", "admin"]),
  password: z.string().min(8).max(72),
});

const patchStaffSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  role: z.enum(["petugas", "admin"]).optional(),
  active: z.boolean().optional(),
});

const resetPasswordSchema = z.object({
  password: z.string().min(8).max(72),
});

// Semua rute di bawah khusus admin
adminStaffRouter.use(requireAuth, requireRole("admin"));

// GET /admin/staff (Admin): daftar akun tanpa hash password
adminStaffRouter.get("/", async (_req, res) => {
  const staff = await db.adminUser.findMany({ orderBy: { createdAt: "asc" } });
  res.json(
    staff.map((s) => ({
      id: s.id,
      name: s.name,
      email: s.email,
      role: s.role,
      active: s.active,
      createdAt: s.createdAt.toISOString(),
    }))
  );
});

// POST /admin/staff (Admin): buat akun petugas atau admin
adminStaffRouter.post("/", async (req, res) => {
  const parsed = createStaffSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "VALIDATION", issues: parsed.error.issues });
  }

  const email = parsed.data.email.toLowerCase();
  const exists = await db.adminUser.findUnique({ where: { email } });
  if (exists) {
    return res.status(409).json({ error: "DUPLICATE" });
  }

  const passwordHash = await hashPassword(parsed.data.password);
  const user = await db.adminUser.create({
    data: {
      name: parsed.data.name,
      email,
      role: parsed.data.role,
      passwordHash,
      active: true,
    },
  });

  res.status(201).json({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    active: user.active,
    createdAt: user.createdAt.toISOString(),
  });
});

// PATCH /admin/staff/:id (Admin): ubah name, role, atau active
adminStaffRouter.patch("/:id", async (req, res) => {
  const parsed = patchStaffSchema.safeParse(req.body);
  if (!parsed.success || Object.keys(parsed.data).length === 0) {
    return res.status(400).json({ error: "VALIDATION" });
  }

  const target = await db.adminUser.findUnique({ where: { id: req.params.id as string } });
  if (!target) {
    return res.status(404).json({ error: "NOT_FOUND" });
  }

  const me = res.locals.user;
  const { name, role, active } = parsed.data;
  const deactivating = active === false;
  const demoting = role === "petugas" && target.role === "admin";

  // Jangan menonaktifkan atau menurunkan peran diri sendiri
  if (target.id === me.id && (deactivating || role === "petugas")) {
    return res.status(409).json({ error: "INVALID_STATE" });
  }

  // Jangan menonaktifkan atau menurunkan admin aktif terakhir
  if ((deactivating || demoting) && target.role === "admin" && target.active) {
    const activeAdmins = await db.adminUser.count({ where: { role: "admin", active: true } });
    if (activeAdmins === 1) {
      return res.status(409).json({ error: "INVALID_STATE" });
    }
  }

  const updated = await db.$transaction(async (tx) => {
    const user = await tx.adminUser.update({
      where: { id: target.id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(role !== undefined ? { role } : {}),
        ...(active !== undefined ? { active } : {}),
      },
    });

    // Menonaktifkan mencabut semua sesi pengguna itu
    if (active === false) {
      await tx.adminSession.deleteMany({ where: { userId: target.id } });
    }

    return user;
  });

  res.json({
    id: updated.id,
    name: updated.name,
    email: updated.email,
    role: updated.role,
    active: updated.active,
    createdAt: updated.createdAt.toISOString(),
  });
});

// POST /admin/staff/:id/reset-password (Admin): ganti password dan cabut semua sesi
adminStaffRouter.post("/:id/reset-password", async (req, res) => {
  const parsed = resetPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "VALIDATION", issues: parsed.error.issues });
  }

  const target = await db.adminUser.findUnique({ where: { id: req.params.id as string } });
  if (!target) {
    return res.status(404).json({ error: "NOT_FOUND" });
  }

  const passwordHash = await hashPassword(parsed.data.password);

  await db.$transaction([
    db.adminUser.update({ where: { id: target.id }, data: { passwordHash } }),
    db.adminSession.deleteMany({ where: { userId: target.id } }),
  ]);

  res.json({ ok: true });
});
