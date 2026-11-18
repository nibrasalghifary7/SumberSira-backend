import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { config } from "./config.js";
import path from "node:path";
import { authRouter } from "./routes/auth.js";
import { adminRidesRouter, ridesRouter, slotsRouter } from "./routes/rides.js";
import { adminPricingRouter, bookingSlotsRouter, pricingRouter } from "./routes/pricing.js";
import { adminTicketsRouter, ticketsRouter } from "./routes/tickets.js";
import { adminPaymentsRouter, paymentsRouter } from "./routes/payments.js";
import { adminBookingsRouter, bookingsRouter } from "./routes/bookings.js";
import { adminDashboardRouter, crowdRouter } from "./routes/crowd.js";
import { adminReviewsRouter, reviewsRouter } from "./routes/reviews.js";
import { adminFaqRouter, chatRouter } from "./routes/chat.js";
import { adminGalleryRouter, galleryRouter } from "./routes/gallery.js";
import { aiPhotoRouter } from "./routes/ai-photo.js";
import { adminInsightRouter } from "./routes/insight.js";
import { adminStaffRouter } from "./routes/staff.js";
import { errorHandler, notFoundHandler } from "./lib/errors.js";
import { db } from "./lib/db.js";
import { generalLimiter } from "./lib/limiters.js";
import { httpLogger, requestId } from "./logger.js";

export const app = express();

app.set("trust proxy", config.TRUST_PROXY);
app.disable("x-powered-by");

// 1. Request ID + request logger dipasang paling awal, supaya setiap log dan
//    setiap respons galat memakai ID yang sama.
app.use(requestId);
app.use(httpLogger);

// 2. Header keamanan (helmet) dan pembatasan CORS.
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

// Di mode pengembangan, semua localhost boleh (Flutter web memakai port acak).
// Di produksi, hanya origin yang terdaftar di ADMIN_ORIGIN (boleh lebih dari satu,
// dipisah koma di environment variable).
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // Postman, Flutter mobile, server-ke-server
      const dev = config.NODE_ENV !== "production" && /^http:\/\/localhost:\d+$/.test(origin);
      cb(null, dev || config.ADMIN_ORIGIN.includes(origin));
    },
    credentials: true,
  }),
);

// 3. Jaring pengaman rate limit untuk seluruh endpoint (selain health dan file statis).
app.use(generalLimiter);

// 4. Parser body dan cookie.
app.use(express.json({ limit: "100kb" }));
app.use(cookieParser());

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("HEALTH_TIMEOUT")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

// Koneksi pertama ke database cloud (Neon) bisa beberapa detik. Server
// melakukan pemanasan sekali saat start supaya readiness check berikutnya cepat.
const HEALTH_TIMEOUT_MS = 5_000;

// Liveness: server hidup dan menerima request. Tidak menyentuh database,
// jadi cocok untuk probe yang sering dipanggil.
app.get("/health/live", (_req, res) => {
  res.json({ ok: true, status: "ok", uptime: Math.round(process.uptime()) });
});

// Readiness: memastikan koneksi database benar-benar bisa dipakai.
// Dipakai deployment (zero-downtime) sebelum trafik dialihkan ke versi baru.
app.get("/health", async (req, res) => {
  const startedAt = Date.now();
  try {
    await withTimeout(db.$queryRaw`SELECT 1`, HEALTH_TIMEOUT_MS);
    res.json({
      ok: true,
      status: "ok",
      db: "up",
      dbLatencyMs: Date.now() - startedAt,
      uptime: Math.round(process.uptime()),
    });
  } catch (err) {
    (req.log ?? console).error({ err }, "health check database gagal");
    res.status(503).json({ ok: false, status: "degraded", db: "down", requestId: req.id });
  }
});

app.get("/health/db", async (_req, res) => {
  const rides = await db.ride.count();
  res.json({ ok: true, rides });
});

app.get("/", (_req, res) => {
  res.json({ name: "SumberSira API", status: "ok" });
});

app.use("/auth", authRouter);
app.use("/rides", ridesRouter);
app.use("/time-slots", slotsRouter);
app.use("/admin/rides", adminRidesRouter);
app.use("/pricing", pricingRouter);
app.use("/booking-slots", bookingSlotsRouter);
app.use("/admin/pricing", adminPricingRouter);
app.use("/tickets", ticketsRouter);
app.use("/admin/tickets", adminTicketsRouter);
app.use("/payments", paymentsRouter);
app.use("/admin/payments", adminPaymentsRouter);
app.use("/bookings", bookingsRouter);
app.use("/admin/bookings", adminBookingsRouter);
app.use("/crowd", crowdRouter);
app.use("/admin/dashboard", adminDashboardRouter);
app.use("/reviews", reviewsRouter);
app.use("/admin/reviews", adminReviewsRouter);
app.use("/chat", chatRouter);
app.use("/admin/faq", adminFaqRouter);
app.use("/gallery", galleryRouter);
app.use("/admin/gallery", adminGalleryRouter);
app.use("/ai-photo", aiPhotoRouter);
app.use("/admin/insight", adminInsightRouter);
app.use("/admin/staff", adminStaffRouter);

// Sajikan file statis uploads hanya saat STORAGE_DRIVER=local
if (config.STORAGE_DRIVER === "local") {
  app.use("/uploads", express.static(path.resolve(process.cwd(), "uploads")));
}

// Handler 404 untuk rute tak dikenal
app.use(notFoundHandler);

// Handler galat global
app.use(errorHandler);
