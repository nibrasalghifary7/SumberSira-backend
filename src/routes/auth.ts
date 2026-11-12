import { Router } from "express";
import { z } from "zod";
import { db } from "../lib/db.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import { COOKIE, newToken, sha256 } from "../lib/session.js";
import { requireAuth } from "../middleware/auth.js";
import { loginLimiter } from "../lib/limiters.js";

export const authRouter = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  remember: z.boolean().optional(),
});

authRouter.post("/login", loginLimiter, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "VALIDATION" });
  const { email, password, remember } = parsed.data;

  const user = await db.adminUser.findUnique({ where: { email } });
  const ok = user ? await verifyPassword(password, user.passwordHash) : false;

  // pesan yang sama untuk email salah, password salah, atau akun nonaktif
  if (!user || !ok || !user.active) return res.status(401).json({ error: "INVALID_CREDENTIALS" });

  const token = newToken();
  const ttlMs = remember ? 7 * 24 * 3600_000 : 8 * 3600_000;

  await db.adminSession.create({
    data: {
      tokenHash: sha256(token),
      userId: user.id,
      userAgent: req.get("user-agent") ?? null,
      expiresAt: new Date(Date.now() + ttlMs),
    },
  });

  res.cookie(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: remember ? ttlMs : undefined, // tanpa "ingat saya": hilang saat browser ditutup
  });

  res.json({ id: user.id, name: user.name, email: user.email, role: user.role });
});

authRouter.post("/logout", requireAuth, async (req, res) => {
  await db.adminSession.deleteMany({ where: { tokenHash: sha256(req.cookies[COOKIE]) } });
  res.clearCookie(COOKIE);
  res.json({ ok: true });
});

// BERUBAH: sekarang ikut mengirim sessionId
authRouter.get("/me", requireAuth, (_req, res) => {
  res.json({ ...res.locals.user, sessionId: res.locals.sessionId });
});

// Daftar sesi milik akun yang sedang login
authRouter.get("/sessions", requireAuth, async (_req, res) => {
  const sessions = await db.adminSession.findMany({
    where: { userId: res.locals.user.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, userAgent: true, createdAt: true, expiresAt: true },
  });
  res.json(sessions.map((s) => ({ ...s, current: s.id === res.locals.sessionId })));
});

// BARU: keluar dari semua perangkat lain; sesi yang sedang dipakai tetap aktif
authRouter.post("/sessions/revoke-others", requireAuth, async (_req, res) => {
  const { count } = await db.adminSession.deleteMany({
    where: { userId: res.locals.user.id, id: { not: res.locals.sessionId } },
  });
  res.json({ ok: true, count });
});

// Cabut satu sesi. Filter userId wajib, supaya tidak bisa mencabut sesi orang lain.
authRouter.delete("/sessions/:id", requireAuth, async (req, res) => {
  const { count } = await db.adminSession.deleteMany({
    where: { id: req.params.id as string, userId: res.locals.user.id },
  });
  if (count === 0) return res.status(404).json({ error: "NOT_FOUND" });
  res.json({ ok: true });
});

// Ubah password sendiri: sesi lain dicabut, sesi saat ini tetap
const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(72),
});

authRouter.post("/change-password", requireAuth, async (req, res) => {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "VALIDATION", issues: parsed.error.issues });
  }

  const { currentPassword, newPassword } = parsed.data;

  const user = await db.adminUser.findUnique({ where: { id: res.locals.user.id } });
  if (!user || !user.active) return res.status(401).json({ error: "INVALID_CREDENTIALS" });

  const ok = await verifyPassword(currentPassword, user.passwordHash);
  if (!ok) return res.status(401).json({ error: "INVALID_CREDENTIALS" });

  // Password baru tidak boleh sama dengan email atau password lama
  if (
    newPassword === currentPassword ||
    newPassword.toLowerCase() === user.email.toLowerCase()
  ) {
    return res.status(400).json({
      error: "VALIDATION",
      issues: [
        {
          path: ["newPassword"],
          message: "Password baru tidak boleh sama dengan email atau password lama",
        },
      ],
    });
  }

  const passwordHash = await hashPassword(newPassword);

  await db.$transaction([
    db.adminUser.update({ where: { id: user.id }, data: { passwordHash } }),
    // Mencabut sesi lain; sesi saat ini tetap aktif
    db.adminSession.deleteMany({ where: { userId: user.id, id: { not: res.locals.sessionId } } }),
  ]);

  res.json({ ok: true });
});