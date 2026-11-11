import type { NextFunction, Request, Response } from "express";
import { db } from "../lib/db.js";
import { COOKIE, sha256 } from "../lib/session.js";

// Setiap halaman admin memanggil requireAuth, dan satu pencarian sesi ke database Neon memakan waktu ratusan milidetik.
// Hasilnya disimpan 30 detik di memori supaya pindah halaman terasa cepat. Saat logout atau sesi dicabut, entri dibuang
// segera lewat forgetToken / forgetSession / forgetUserExcept, jadi pencabutan tetap langsung berlaku di server ini.
type SafeUser = { id: string; email: string; name: string; role: "admin" | "petugas"; createdAt: Date };
type Entry = { user: SafeUser; sessionId: string; expiresAt: Date; at: number };

const TTL_MS = 30_000;
const MAX_ENTRIES = 500;
const cache = new Map<string, Entry>();

export const forgetToken = (tokenHash: string) => void cache.delete(tokenHash);

export function forgetSession(sessionId: string): void {
  for (const [k, e] of cache) if (e.sessionId === sessionId) cache.delete(k);
}

// Buang semua sesi tersimpan milik satu akun, kecuali sesi yang sedang dipakai.
export function forgetUserExcept(userId: string, keepSessionId: string): void {
  for (const [k, e] of cache) if (e.user.id === userId && e.sessionId !== keepSessionId) cache.delete(k);
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[COOKIE];
  if (!token) return res.status(401).json({ error: "UNAUTHENTICATED" });

  const tokenHash = sha256(token);
  const now = Date.now();
  let entry = cache.get(tokenHash);

  if (!entry || now - entry.at > TTL_MS) {
    const session = await db.adminSession.findUnique({ where: { tokenHash }, include: { user: true } });
    if (!session) {
      cache.delete(tokenHash);
      return res.status(401).json({ error: "UNAUTHENTICATED" });
    }
    const { passwordHash, ...safeUser } = session.user; // hash tidak boleh keluar
    entry = { user: safeUser, sessionId: session.id, expiresAt: session.expiresAt, at: now };
    if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
    cache.set(tokenHash, entry);
  }

  if (entry.expiresAt.getTime() < now) {
    cache.delete(tokenHash);
    return res.status(401).json({ error: "UNAUTHENTICATED" });
  }

  res.locals.user = entry.user;
  res.locals.sessionId = entry.sessionId;
  next();
}

export const requireRole =
  (...roles: Array<"admin" | "petugas">) =>
  (_req: Request, res: Response, next: NextFunction) =>
    roles.includes(res.locals.user.role)
      ? next()
      : res.status(403).json({ error: "FORBIDDEN" });
