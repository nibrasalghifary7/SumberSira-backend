import { db } from "../../src/lib/db.js";
import { sweepExpiredSessions } from "../../src/lib/sweep.js";
import { check } from "./_helpers.js";

const MARK = "[SMOKE]-token-";

async function run() {
  console.log("=== Menjalankan Smoke Test P12 (penyapu sesi) ===");

  try {
    const admin = await db.adminUser.findUnique({ where: { email: "admin@sumbersira.id" } });
    if (!admin) throw new Error("Akun admin seed tidak ditemukan");

    // Sesi uji: satu sudah kadaluarsa, satu masih berlaku
    await db.adminSession.createMany({
      data: [
        {
          tokenHash: `${MARK}expired`,
          userId: admin.id,
          userAgent: "[SMOKE] penyapu",
          expiresAt: new Date(Date.now() - 1000),
        },
        {
          tokenHash: `${MARK}valid`,
          userId: admin.id,
          userAgent: "[SMOKE] penyapu",
          expiresAt: new Date(Date.now() + 60 * 1000),
        },
      ],
    });

    // 1. Penyapu pertama: sesi kadaluarsa terhapus
    const count = await sweepExpiredSessions();
    check("Penyapu mengembalikan jumlah berupa angka", typeof count === "number");
    check("Penyapu menghapus minimal 1 sesi (sesi uji kadaluarsa)", count >= 1, `dapat ${count}`);

    const expiredGone = await db.adminSession.findUnique({
      where: { tokenHash: `${MARK}expired` },
    });
    check("Sesi uji kadaluarsa terhapus", expiredGone === null);

    const validKept = await db.adminSession.findUnique({
      where: { tokenHash: `${MARK}valid` },
    });
    check("Sesi uji yang masih berlaku tetap ada", validKept !== null);

    // 2. Penyapu kedua: idempoten, tidak menghapus apa pun lagi
    const again = await sweepExpiredSessions();
    check("Penyapu ulang menghapus 0 sesi", again === 0, `dapat ${again}`);

    // 3. Sesi uji yang valid tetap bisa dinonaktifkan manual (belum dikorek penyapu)
    check("Sesi valid masih tersimpan setelah penyapu ulang",
      (await db.adminSession.findUnique({ where: { tokenHash: `${MARK}valid` } })) !== null);

    console.log("=== Seluruh Pemeriksaan P12 LULUS ===");
  } finally {
    await db.adminSession.deleteMany({ where: { tokenHash: { startsWith: MARK } } });
    await db.$disconnect();
  }
}

run().catch((err) => {
  console.error("Smoke test P12 gagal:", err);
  process.exit(1);
});
