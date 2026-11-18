import "dotenv/config";
import { app } from "./app.js";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { db } from "./lib/db.js";
import { applyPaymentStatus, syncPayment } from "./payments/service.js";
import { sweepExpiredSessions } from "./lib/sweep.js";

const port = config.PORT;
const server = app.listen(port, () => logger.info({ port }, "API jalan"));

// Pemanasan koneksi database. Tidak memblokir start: bila database belum siap,
// server tetap hidup dan /health akan melaporkan status "degraded" sampai pulih.
async function warmUpDatabase() {
  const startedAt = Date.now();
  try {
    await db.$queryRaw`SELECT 1`;
    logger.info({ ms: Date.now() - startedAt }, "koneksi database siap");
  } catch (err) {
    logger.warn({ err }, "database belum siap saat start; /health akan melaporkan degraded");
  }
}

void warmUpDatabase();

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
        logger.warn({ err, paymentId: payment.id }, "gagal menyapu payment");
      }
    }
  } catch (err) {
    logger.error({ err }, "gagal menjalankan penyapu berkala pembayaran");
  }

  // Penyapu sesi admin kadaluarsa (housekeeping; requireAuth tetap memeriksa expiresAt)
  try {
    const count = await sweepExpiredSessions();
    if (count > 0) logger.info({ count }, "menyapu sesi admin kadaluarsa");
  } catch (err) {
    logger.error({ err }, "gagal menyapu sesi admin kadaluarsa");
  }
}, SWEEP_INTERVAL_MS);

// Batas waktu shutdown. Kalau koneksi menggantung lebih lama dari ini,
// proses keluar paksa supaya container tidak menunggu selamanya.
const SHUTDOWN_TIMEOUT_MS = 10_000;
let shuttingDown = false;

/**
 * Graceful shutdown:
 * 1. berhenti menerima request baru (server.close),
 * 2. menyelesaikan request yang sedang berjalan,
 * 3. memutus koneksi database dengan rapi,
 * 4. baru keluar.
 * SIGTERM dikirim Docker/orchestrator saat rilis versi baru; SIGINT dari Ctrl+C.
 */
async function shutdown(signal: string, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info({ signal }, "sinyal diterima, menghentikan server dengan rapi");
  clearInterval(sweepInterval);

  const forceExit = setTimeout(() => {
    logger.error({ signal, timeoutMs: SHUTDOWN_TIMEOUT_MS }, "batas waktu shutdown habis, keluar paksa");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  try {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
      // Koneksi keep-alive yang menganggur tidak dipakai lagi; tutup sekarang
      // agar `server.close` tidak menunggu sampai timeout.
      server.closeIdleConnections?.();
    });
    logger.info("koneksi HTTP ditutup");

    await db.$disconnect();
    logger.info("koneksi database ditutup");

    clearTimeout(forceExit);
    process.exit(exitCode);
  } catch (err) {
    logger.error({ err }, "gagal menutup server dengan rapi");
    clearTimeout(forceExit);
    process.exit(1);
  }
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

// Jangan biarkan proses mati diam-diam tanpa jejak log.
process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "unhandled rejection");
});

process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "uncaught exception, server dihentikan");
  void shutdown("uncaughtException", 1);
});
