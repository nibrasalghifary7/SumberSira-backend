import type { NextFunction, Request, Response } from "express";
import { db } from "../lib/db.js";
import { COOKIE, sha256 } from "../lib/session.js";

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[COOKIE];
  if (!token) return res.status(401).json({ error: "UNAUTHENTICATED" });

  const session = await db.adminSession.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: true },
  });

  if (!session || session.expiresAt < new Date()) {
    return res.status(401).json({ error: "UNAUTHENTICATED" });
  }

  const { passwordHash, ...safeUser } = session.user; // hash tidak boleh keluar
  res.locals.user = safeUser;
  res.locals.sessionId = session.id;
  next();
}

export const requireRole =
  (...roles: Array<"admin" | "petugas">) =>
  (_req: Request, res: Response, next: NextFunction) =>
    roles.includes(res.locals.user.role)
      ? next()
      : res.status(403).json({ error: "FORBIDDEN" });