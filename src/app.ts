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

export const app = express();

app.set("trust proxy", config.TRUST_PROXY);

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

app.use(express.json());
app.use(cookieParser());

// Di mode pengembangan, semua localhost, 127.0.0.1, dan IP LAN boleh (Flutter web memakai port acak, HP memakai IP LAN).
// Di produksi, hanya alamat web admin dan EXTRA_ORIGINS (mis. web Flutter yang dideploy).
// Garis miring di akhir alamat dibuang supaya https://contoh.com/ dan https://contoh.com dianggap sama.
const extraOrigins = config.EXTRA_ORIGINS.split(",")
  .map((s) => s.trim().replace(/\/+$/, ""))
  .filter(Boolean);
const adminOrigin = config.ADMIN_ORIGIN.replace(/\/+$/, "");
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // Postman, Flutter mobile, server-ke-server
      const dev =
        config.NODE_ENV !== "production" &&
        /^http:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+)(:\d+)?$/.test(origin);
      cb(null, dev || origin === adminOrigin || extraOrigins.includes(origin));
    },
    credentials: true,
  }),
);

app.get("/", (_req, res) => {
  res.json({ name: "SumberSira API", status: "ok" });
});

app.get("/health", (_req, res) => res.json({ ok: true }));

app.get("/health/db", async (_req, res) => {
  const rides = await db.ride.count();
  res.json({ ok: true, rides });
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
