import "dotenv/config";
import { app } from "./app.js";
import { config } from "./config.js";
import { db } from "./lib/db.js";
import { applyPaymentStatus, syncPayment } from "./payments/service.js";
import { sweepExpiredSessions } from "./lib/sweep.js";

const port = config.PORT;
const server = app.listen(port, () => console.log(`API jalan di http://localhost:${port}`));

// Penyapu berkala setiap 5 menit: ambil pembayaran QRIS pending yang expiresAt sudah lewat > 2 menit
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
const sweepInterval = setInterval(async () => {
  try {
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
    const expiredPendingPayments = await db.payment.findMany({
      where: {
        method: "qris",
        status: "pending",
        expiresAt: { lt: twoMinutesAgo },
      },
      take: 50,
    });

    for (const payment of expiredPendingPayments) {
      try {
        const synced = await syncPayment(payment.id);
        if (synced && synced.status === "pending") {
          await applyPaymentStatus(payment.id, "expired", { swept: true, sweptAt: new Date().toISOString() });
        }
      } catch (err) {
        console.error(`Gagal menyapu payment ${payment.id}:`, err);
      }
    }
  } catch (err) {
    console.error("Gagal menjalankan penyapu berkala pembayaran:", err);
  }

  // Penyapu sesi admin kadaluarsa (housekeeping; requireAuth tetap memeriksa expiresAt)
  try {
    const count = await sweepExpiredSessions();
    if (count > 0) console.log(`Menyapu ${count} sesi admin kadaluarsa.`);
  } catch (err) {
    console.error("Gagal menyapu sesi admin kadaluarsa:", err);
  }
}, SWEEP_INTERVAL_MS);

function cleanup() {
  clearInterval(sweepInterval);
  server.close(() => {
    db.$disconnect().finally(() => process.exit(0));
  });
}

process.on("SIGTERM", cleanup);
process.on("SIGINT", cleanup);
