import { db } from "./db.js";

/**
 * Hapus sesi admin yang sudah melewati `expiresAt`.
 * Aman: `requireAuth` selalu menolak sesi kadaluarsa, jadi ini murni housekeeping
 * agar tabel `AdminSession` tidak menumpuk baris yang tidak berguna.
 * Sesi yang masih berlaku (termasuk yang sedang dipakai) tidak tersentuh.
 */
export async function sweepExpiredSessions(): Promise<number> {
  const { count } = await db.adminSession.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return count;
}
