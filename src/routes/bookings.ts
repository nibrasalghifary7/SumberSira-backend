import { Router } from "express";
import { z } from "zod";
import crypto from "node:crypto";
import { db } from "../lib/db.js";
import { config } from "../config.js";
import { BOOKING_SLOTS, BOOKING_SLOT_ITEMS } from "../constants.js";
import { jakartaDate, compactDate } from "../lib/time.js";
import { nextSeq } from "../lib/seq.js";
import { normalizeWa } from "../lib/phone.js";
import { providerFor } from "../payments/index.js";
import { writeLimiter, publicLimiter } from "../lib/limiters.js";
import { requireAuth } from "../middleware/auth.js";

export const bookingsRouter = Router();
export const adminBookingsRouter = Router();

const bookingItemSchema = z.object({
  rideId: z.string().min(1),
  qty: z.number().int().min(1).max(20),
});

const createBookingSchema = z.object({
  name: z.string().trim().min(1).max(60),
  whatsapp: z.string(),
  slot: z.enum(BOOKING_SLOTS as unknown as [string, ...string[]]),
  visitDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  items: z.array(bookingItemSchema).min(1).max(8),
});

function getSlotLabel(slotId: string): string {
  const found = BOOKING_SLOT_ITEMS.find((s) => s.id === slotId);
  return found ? found.label : slotId;
}

function getBookingLineLabel(ride: { name: string; unit: string }): string {
  if (!ride.unit || ride.unit.trim() === "") {
    return ride.name;
  }
  if (ride.unit.toLowerCase().includes("menit")) {
    return `${ride.name} (${ride.unit})`;
  }
  return `${ride.name} (per ${ride.unit})`;
}

function formatBookingDto(booking: any, payment?: any) {
  const latestPayment = payment ?? (booking.payments && booking.payments.length > 0 ? booking.payments[0] : null);

  return {
    code: booking.code,
    name: booking.name,
    whatsapp: booking.whatsapp,
    slot: booking.slot,
    slotLabel: getSlotLabel(booking.slot),
    visitDate: booking.visitDate,
    amount: booking.amount,
    paymentStatus: booking.paymentStatus,
    createdAt: booking.createdAt.toISOString(),
    lines: (booking.lines || []).map((line: any) => ({
      rideId: line.rideId,
      name: line.name,
      qty: line.qty,
      unitPrice: line.unitPrice,
      subtotal: line.qty * line.unitPrice,
    })),
    payment: latestPayment
      ? {
          id: latestPayment.id,
          method: latestPayment.method,
          status: latestPayment.status,
          amount: latestPayment.amount,
          qrString: latestPayment.qrString ?? null,
          qrUrl: latestPayment.qrUrl ?? null,
          expiresAt: latestPayment.expiresAt ? latestPayment.expiresAt.toISOString() : null,
        }
      : null,
  };
}

// POST /bookings (Publik, pembayaran HANYA QRIS)
bookingsRouter.post("/", writeLimiter, async (req, res) => {
  const parsed = createBookingSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "VALIDATION", issues: parsed.error.issues });
  }

  const { name, whatsapp: rawWa, slot, visitDate: inputVisitDate, items } = parsed.data;

  // Normalisasi WhatsApp (A2)
  const wa = normalizeWa(rawWa);
  if (!wa) {
    return res.status(400).json({
      error: "VALIDATION",
      issues: [{ path: ["whatsapp"], message: "Nomor WhatsApp tidak valid" }],
    });
  }

  // Cek rideId tidak boleh ganda
  const rideIds = items.map((i) => i.rideId);
  const uniqueRideIds = new Set(rideIds);
  if (uniqueRideIds.size !== rideIds.length) {
    return res.status(400).json({
      error: "VALIDATION",
      issues: [{ path: ["items"], message: "Item tidak boleh ganda" }],
    });
  }

  // Validasi visitDate (A3): default hari ini WIB, maks 30 hari ke depan
  const todayStr = jakartaDate();
  const visitDate = inputVisitDate ?? todayStr;

  const maxDate = new Date();
  maxDate.setDate(maxDate.getDate() + 30);
  const maxDateStr = jakartaDate(maxDate);

  if (visitDate < todayStr || visitDate > maxDateStr) {
    return res.status(400).json({
      error: "VALIDATION",
      issues: [{ path: ["visitDate"], message: `Tanggal kunjungan harus antara ${todayStr} dan ${maxDateStr}` }],
    });
  }

  // Validasi ketersediaan wahana dari DB
  const dbRides = await db.ride.findMany({
    where: { id: { in: Array.from(uniqueRideIds) } },
  });

  const rideMap = new Map(dbRides.map((r) => [r.id, r]));

  for (const item of items) {
    const ride = rideMap.get(item.rideId);
    if (!ride || !ride.active) {
      return res.status(409).json({
        error: "RIDE_UNAVAILABLE",
        rideId: item.rideId,
      });
    }
  }

  // Siapkan data lines & hitung total amount di server
  let totalAmount = 0;
  const linesData = items.map((item) => {
    const ride = rideMap.get(item.rideId)!;
    const label = getBookingLineLabel(ride);
    const unitPrice = ride.price;
    totalAmount += item.qty * unitPrice;
    return {
      rideId: item.rideId,
      name: label,
      qty: item.qty,
      unitPrice,
    };
  });

  // Nomor kode booking berurutan per tanggal pembuatan (WIB)
  const yyyymmdd = compactDate(todayStr);
  const seq = await nextSeq(`booking:${yyyymmdd}`, 1);
  const seqStr = String(seq).padStart(3, "0");
  const code = `SS-${yyyymmdd}-${seqStr}`;

  const providerType = config.PAYMENT_MODE === "midtrans" ? "midtrans" : "simulation";

  // Transaksi pembuatan Booking, BookingLine, dan Payment
  const { booking, payment } = await db.$transaction(async (tx) => {
    const b = await tx.booking.create({
      data: {
        code,
        name,
        whatsapp: wa,
        slot,
        visitDate,
        amount: totalAmount,
        paymentStatus: "pending",
        lines: {
          create: linesData,
        },
      },
      include: {
        lines: true,
      },
    });

    const p = await tx.payment.create({
      data: {
        bookingId: b.id,
        method: "qris",
        provider: providerType,
        status: "pending",
        amount: totalAmount,
      },
    });

    return { booking: b, payment: p };
  });

  try {
    const provider = providerFor(config.PAYMENT_MODE);
    const randomSuffix = crypto.randomBytes(3).toString("hex").toUpperCase();
    const providerOrderId = `${code}-${randomSuffix}`;

    const qrisItems = linesData.map((line, idx) => ({
      id: `line-${idx + 1}`,
      name: line.name.slice(0, 50),
      price: line.unitPrice,
      quantity: line.qty,
    }));

    const qrisResult = await provider.createQris({
      orderId: providerOrderId,
      amount: totalAmount,
      customerName: name,
      customerPhone: wa,
      items: qrisItems,
    });

    const updatedPayment = await db.payment.update({
      where: { id: payment.id },
      data: {
        providerOrderId,
        providerTransactionId: qrisResult.providerTransactionId,
        qrString: qrisResult.qrString,
        qrUrl: qrisResult.qrUrl,
        expiresAt: qrisResult.expiresAt,
      },
    });

    return res.status(201).json(formatBookingDto(booking, updatedPayment));
  } catch (err) {
    console.error("Gagal membuat QRIS Booking:", err);
    await db.booking.delete({ where: { id: booking.id } }).catch(() => {});
    return res.status(502).json({ error: "PAYMENT_PROVIDER_ERROR" });
  }
});

// GET /bookings?whatsapp= (Riwayat booking nomor WhatsApp)
bookingsRouter.get("/", publicLimiter, async (req, res) => {
  const rawWa = req.query.whatsapp as string | undefined;
  if (!rawWa) {
    return res.status(400).json({ error: "VALIDATION", issues: [{ path: ["whatsapp"], message: "WhatsApp wajib disertakan" }] });
  }

  const wa = normalizeWa(rawWa);
  if (!wa) {
    return res.json([]);
  }

  const bookings = await db.booking.findMany({
    where: { whatsapp: wa },
    orderBy: { createdAt: "desc" },
    include: {
      lines: true,
      payments: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });

  res.json(bookings.map((b) => formatBookingDto(b)));
});

// GET /bookings/:code?whatsapp= (Satu booking, wajib WhatsApp cocok sesuai A4)
bookingsRouter.get("/:code", publicLimiter, async (req, res) => {
  const code = req.params.code as string;
  const rawWa = req.query.whatsapp as string | undefined;

  if (!rawWa) {
    return res.status(404).json({ error: "NOT_FOUND" });
  }

  const wa = normalizeWa(rawWa);
  if (!wa) {
    return res.status(404).json({ error: "NOT_FOUND" });
  }

  const booking = await db.booking.findUnique({
    where: { code },
    include: {
      lines: true,
      payments: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });

  if (!booking || booking.whatsapp !== wa) {
    return res.status(404).json({ error: "NOT_FOUND" });
  }

  res.json(formatBookingDto(booking));
});

// GET /admin/bookings (Admin & Petugas)
adminBookingsRouter.get("/", requireAuth, async (req, res) => {
  const date = req.query.date as string | undefined;
  const q = (req.query.q as string) || "";
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  const skip = (page - 1) * limit;

  const where: any = {};
  if (date) {
    where.visitDate = date;
  }

  if (q.trim()) {
    const searchTerm = q.trim();
    where.OR = [
      { code: { contains: searchTerm, mode: "insensitive" } },
      { name: { contains: searchTerm, mode: "insensitive" } },
      { whatsapp: { contains: searchTerm } },
    ];
  }

  const [total, items] = await Promise.all([
    db.booking.count({ where }),
    db.booking.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      include: {
        lines: true,
        payments: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    }),
  ]);

  res.json({
    total,
    page,
    limit,
    items: items.map((b) => formatBookingDto(b)),
  });
});

// GET /admin/bookings/:code (Admin & Petugas)
adminBookingsRouter.get("/:code", requireAuth, async (req, res) => {
  const code = req.params.code as string;
  const booking = await db.booking.findUnique({
    where: { code },
    include: {
      lines: true,
      payments: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });

  if (!booking) {
    return res.status(404).json({ error: "NOT_FOUND" });
  }

  res.json(formatBookingDto(booking));
});
