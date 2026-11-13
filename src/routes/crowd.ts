import { Router } from "express";
import { db } from "../lib/db.js";
import { getPricing } from "../lib/pricing.js";
import { jakartaDate, startOfDayJakarta } from "../lib/time.js";
import { HOURLY_FORECAST, getCrowdLabel } from "../constants.js";
import { publicLimiter } from "../lib/limiters.js";
import { requireAuth } from "../middleware/auth.js";

export const crowdRouter = Router();
export const adminDashboardRouter = Router();

export async function calculateCurrentCrowd() {
  const today = jakartaDate();
  const pricing = await getPricing();

  const insideTickets = await db.ticket.findMany({
    where: {
      visitDate: today,
      status: "inside",
    },
    select: {
      adults: true,
      kids: true,
    },
  });

  const inside = insideTickets.reduce((sum, t) => sum + t.adults + t.kids, 0);
  const capacity = pricing.capacity;
  const percent = Math.round((inside / capacity) * 100);
  const label = getCrowdLabel(percent);

  return {
    inside,
    capacity,
    percent,
    label,
    updatedAt: new Date().toISOString(),
    forecast: HOURLY_FORECAST,
  };
}

// GET /crowd (Publik)
crowdRouter.get("/", publicLimiter, async (_req, res) => {
  const crowd = await calculateCurrentCrowd();
  res.json(crowd);
});

// GET /admin/dashboard (Admin & Petugas)
adminDashboardRouter.get("/", requireAuth, async (_req, res) => {
  const today = jakartaDate();
  const startOfDay = startOfDayJakarta(today);
  const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

  const [
    paidTickets,
    paidBookingsCount,
    paidPayments,
    pendingCashTicketsCount,
    pendingQrisPaymentsCount,
    crowd,
  ] = await Promise.all([
    // Tiket lunas hari ini
    db.ticket.findMany({
      where: {
        visitDate: today,
        paymentStatus: "paid",
      },
      select: {
        adults: true,
        kids: true,
      },
    }),

    // Booking lunas hari ini
    db.booking.count({
      where: {
        visitDate: today,
        paymentStatus: "paid",
      },
    }),

    // Revenue hari ini (paidAt dalam hari ini WIB)
    db.payment.aggregate({
      where: {
        status: "paid",
        paidAt: {
          gte: startOfDay,
          lt: endOfDay,
        },
      },
      _sum: {
        amount: true,
      },
    }),

    // Pending Cash tiket hari ini
    db.ticket.count({
      where: {
        visitDate: today,
        paymentMethod: "cash",
        paymentStatus: "pending",
      },
    }),

    // Pending QRIS belum expired
    db.payment.count({
      where: {
        method: "qris",
        status: "pending",
        OR: [
          { expiresAt: { gt: new Date() } },
          { expiresAt: null },
        ],
      },
    }),

    // Data crowd hari ini
    calculateCurrentCrowd(),
  ]);

  const ticketsToday = paidTickets.length;
  const visitorsToday = paidTickets.reduce((sum, t) => sum + t.adults + t.kids, 0);
  const bookingsToday = paidBookingsCount;
  const revenueToday = paidPayments._sum.amount ?? 0;
  const pendingCash = pendingCashTicketsCount;
  const pendingQris = pendingQrisPaymentsCount;

  res.json({
    ticketsToday,
    visitorsToday,
    bookingsToday,
    revenueToday,
    pendingCash,
    pendingQris,
    crowd: {
      inside: crowd.inside,
      capacity: crowd.capacity,
      percent: crowd.percent,
      label: crowd.label,
    },
  });
});
