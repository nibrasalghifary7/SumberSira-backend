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

// Di mode pengembangan, semua localhost boleh (Flutter web memakai port acak).
// Di produksi, hanya alamat web admin.
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // Postman, Flutter mobile, server-ke-server
      const dev = config.NODE_ENV !== "production" && /^http:\/\/localhost:\d+$/.test(origin);
      cb(null, dev || origin === config.ADMIN_ORIGIN);
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
