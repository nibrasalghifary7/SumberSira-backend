import { Router } from "express";
import { getPricing, setPricing, PARKING_LABELS, pricingSchema } from "../lib/pricing.js";
import { BOOKING_SLOT_ITEMS } from "../constants.js";
import { publicLimiter } from "../lib/limiters.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

export const pricingRouter = Router();
export const bookingSlotsRouter = Router();
export const adminPricingRouter = Router();

// GET /pricing (Publik)
pricingRouter.get("/", publicLimiter, async (_req, res) => {
  const p = await getPricing();
  const parkingList = (Object.keys(p.parking) as Array<keyof typeof p.parking>).map((key) => ({
    key,
    label: PARKING_LABELS[key],
    price: p.parking[key],
  }));

  res.json({
    ticketPricePerPerson: p.ticketPricePerPerson,
    capacity: p.capacity,
    parking: parkingList,
  });
});

// GET /booking-slots (Publik)
bookingSlotsRouter.get("/", publicLimiter, (_req, res) => {
  res.json(BOOKING_SLOT_ITEMS);
});

// GET /admin/pricing (Admin & Petugas)
adminPricingRouter.get("/", requireAuth, async (_req, res) => {
  const p = await getPricing();
  res.json(p);
});

// PUT /admin/pricing (Hanya Admin)
adminPricingRouter.put("/", requireAuth, requireRole("admin"), async (req, res) => {
  const parsed = pricingSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "VALIDATION", issues: parsed.error.issues });
  }

  const updated = await setPricing(parsed.data);
  res.json(updated);
});
