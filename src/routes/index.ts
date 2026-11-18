import type { Express } from "express";
import { authRouter } from "../controllers/auth.controller.js";
import { adminRidesRouter, ridesRouter, slotsRouter } from "../controllers/rides.controller.js";
import { adminPricingRouter, bookingSlotsRouter, pricingRouter } from "../controllers/pricing.controller.js";
import { adminTicketsRouter, ticketsRouter } from "../controllers/tickets.controller.js";
import { adminPaymentsRouter, paymentsRouter } from "../controllers/payments.controller.js";
import { adminBookingsRouter, bookingsRouter } from "../controllers/bookings.controller.js";
import { adminDashboardRouter, crowdRouter } from "../controllers/crowd.controller.js";
import { adminReviewsRouter, reviewsRouter } from "../controllers/reviews.controller.js";
import { adminFaqRouter, chatRouter } from "../controllers/chat.controller.js";
import { adminGalleryRouter, galleryRouter } from "../controllers/gallery.controller.js";
import { aiPhotoRouter } from "../controllers/ai-photo.controller.js";
import { adminInsightRouter } from "../controllers/insight.controller.js";
import { adminStaffRouter } from "../controllers/staff.controller.js";

// Daftar alamat dasar tiap controller. Urutannya sama dengan sebelumnya.
// Publik: dipakai aplikasi pengunjung. Awalan /admin: khusus web admin dan wajib login.
export function registerRoutes(app: Express) {
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
}
