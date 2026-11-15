import { Router } from "express";
import { z } from "zod";
import crypto from "node:crypto";
import { db } from "../lib/db.js";
import { config } from "../config.js";
import { getPricing, PARKING_LABELS } from "../lib/pricing.js";
import { jakartaDate } from "../lib/time.js";
import { nextSeq } from "../lib/seq.js";
import { normalizeWa } from "../lib/phone.js";
import { providerFor } from "../payments/index.js";
import { writeLimiter, publicLimiter } from "../lib/limiters.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import type { Parking, PaymentMethod, PaymentStatus, TicketStatus } from "../../generated/prisma/enums.js";

export const ticketsRouter = Router();
export const adminTicketsRouter = Router();

const createTicketSchema = z.object({
  name: z.string().trim().min(1).max(60),
  whatsapp: z.string(),
  adults: z.number().int().min(1).max(30),
  kids: z.number().int().min(0).max(10).default(0),
  parking: z.enum(["none", "motor", "mobil", "bus"]),
  arrival: z.string().min(1),
  paymentMethod: z.enum(["qris", "cash"]),
});

function formatTicketDto(ticket: any, payment?: any) {
  const latestPayment = payment ?? (ticket.payments && ticket.payments.length > 0 ? ticket.payments[0] : null);

  return {
    code: ticket.code,
    name: ticket.name,
    whatsapp: ticket.whatsapp,
    adults: ticket.adults,
    kids: ticket.kids,
    people: ticket.adults + ticket.kids,
    parking: ticket.parking,
    arrival: ticket.arrival,
    visitDate: ticket.visitDate,
    amount: ticket.amount,
    status: ticket.status,
    paymentStatus: ticket.paymentStatus,
    checkInAt: ticket.checkInAt ? ticket.checkInAt.toISOString() : null,
    checkOutAt: ticket.checkOutAt ? ticket.checkOutAt.toISOString() : null,
    createdAt: ticket.createdAt.toISOString(),
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

// POST /tickets (Beli tiket)
ticketsRouter.post("/", writeLimiter, async (req, res) => {
  const parsed = createTicketSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "VALIDATION", issues: parsed.error.issues });
  }

  const { name, whatsapp: rawWa, adults, kids, parking, arrival, paymentMethod } = parsed.data;

  // Normalisasi WhatsApp sesuai A2
  const wa = normalizeWa(rawWa);
  if (!wa) {
    return res.status(400).json({
      error: "VALIDATION",
      issues: [{ path: ["whatsapp"], message: "Nomor WhatsApp tidak valid" }],
    });
  }

  // Validasi arrival harus salah satu TimeSlot di DB
  const validSlot = await db.timeSlot.findFirst({
    where: { timeRange: arrival },
  });
  if (!validSlot) {
    return res.status(400).json({
      error: "VALIDATION",
      issues: [{ path: ["arrival"], message: "Slot waktu kedatangan tidak valid" }],
    });
  }

  // Hitung total di server dari pricing
  const pricing = await getPricing();
  const ticketAmount = adults * pricing.ticketPricePerPerson;
  const parkingAmount = pricing.parking[parking as keyof typeof pricing.parking] ?? 0;
  const totalAmount = ticketAmount + parkingAmount;

  const visitDate = jakartaDate(); // hari ini WIB

  // Generate sequence atomik
  const seq = await nextSeq("ticket", 1001);
  const code = `TK-${seq}`;

  const isQris = paymentMethod === "qris";
  const providerType = isQris
    ? config.PAYMENT_MODE === "midtrans"
      ? "midtrans"
      : "simulation"
    : "manual";

  // Transaksi pembuatan Ticket dan Payment awal
  const { ticket, payment } = await db.$transaction(async (tx) => {
    const t = await tx.ticket.create({
      data: {
        code,
        name,
        whatsapp: wa,
        adults,
        kids,
        parking: parking as Parking,
        arrival,
        visitDate,
        amount: totalAmount,
        paymentMethod: paymentMethod as PaymentMethod,
        paymentStatus: "pending",
        status: "waiting",
      },
    });

    const p = await tx.payment.create({
      data: {
        ticketId: t.id,
        method: paymentMethod as PaymentMethod,
        provider: providerType,
        status: "pending",
        amount: totalAmount,
      },
    });

    return { ticket: t, payment: p };
  });

  if (isQris) {
    try {
      const provider = providerFor(config.PAYMENT_MODE);
      const randomSuffix = crypto.randomBytes(3).toString("hex").toUpperCase();
      const providerOrderId = `${code}-${randomSuffix}`;

      const items = [
        {
          id: "ticket",
          name: "Tiket Masuk",
          price: pricing.ticketPricePerPerson,
          quantity: adults,
        },
      ];
      if (parkingAmount > 0) {
        items.push({
          id: `parking-${parking}`,
          name: `Parkir ${PARKING_LABELS[parking as keyof typeof PARKING_LABELS]}`,
          price: parkingAmount,
          quantity: 1,
        });
      }

      const qrisResult = await provider.createQris({
        orderId: providerOrderId,
        amount: totalAmount,
        customerName: name,
        customerPhone: wa,
        items,
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

      return res.status(201).json(formatTicketDto(ticket, updatedPayment));
    } catch (err) {
      console.error("Gagal membuat QRIS:", err);
      // Hapus data tiket & payment yang baru dibuat
      await db.ticket.delete({ where: { id: ticket.id } }).catch(() => {});
      return res.status(502).json({ error: "PAYMENT_PROVIDER_ERROR" });
    }
  }

  // Cash / manual
  return res.status(201).json(formatTicketDto(ticket, payment));
});

// GET /tickets (Riwayat tiket pengunjung berdasarkan nomor WhatsApp)
ticketsRouter.get("/", publicLimiter, async (req, res) => {
  const rawWa = req.query.whatsapp as string | undefined;
  if (!rawWa) {
    return res.status(400).json({ error: "VALIDATION", issues: [{ path: ["whatsapp"], message: "WhatsApp wajib disertakan" }] });
  }

  const wa = normalizeWa(rawWa);
  if (!wa) {
    return res.json([]);
  }

  const tickets = await db.ticket.findMany({
    where: { whatsapp: wa },
    orderBy: { createdAt: "desc" },
    include: {
      payments: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });

  res.json(tickets.map((t) => formatTicketDto(t)));
});

// GET /tickets/:code?whatsapp= (Satu tiket, wajib WhatsApp cocok sesuai A4)
ticketsRouter.get("/:code", publicLimiter, async (req, res) => {
  const code = req.params.code as string;
  const rawWa = req.query.whatsapp as string | undefined;

  if (!rawWa) {
    return res.status(404).json({ error: "NOT_FOUND" });
  }

  const wa = normalizeWa(rawWa);
  if (!wa) {
    return res.status(404).json({ error: "NOT_FOUND" });
  }

  const ticket = await db.ticket.findUnique({
    where: { code },
    include: {
      payments: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });

  if (!ticket || ticket.whatsapp !== wa) {
    return res.status(404).json({ error: "NOT_FOUND" });
  }

  res.json(formatTicketDto(ticket));
});

// GET /admin/tickets (Admin & Petugas)
adminTicketsRouter.get("/", requireAuth, async (req, res) => {
  const date = (req.query.date as string) || jakartaDate();
  const status = req.query.status as TicketStatus | undefined;
  const q = (req.query.q as string) || "";
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  const skip = (page - 1) * limit;

  const where: any = {
    visitDate: date,
  };

  if (status) {
    where.status = status;
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
    db.ticket.count({ where }),
    db.ticket.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      include: {
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
    items: items.map((t) => formatTicketDto(t)),
  });
});

// POST /admin/tickets/:code/confirm-cash (Admin & Petugas)
adminTicketsRouter.post("/:code/confirm-cash", requireAuth, async (req, res) => {
  const code = req.params.code as string;

  const ticket = await db.ticket.findUnique({
    where: { code },
    include: {
      payments: {
        where: { method: "cash", status: "pending" },
        take: 1,
      },
    },
  });

  if (!ticket) {
    return res.status(404).json({ error: "NOT_FOUND" });
  }

  if (ticket.paymentMethod !== "cash" || ticket.paymentStatus !== "pending" || ticket.payments.length === 0) {
    return res.status(409).json({ error: "INVALID_STATE" });
  }

  const payment = ticket.payments[0];

  await db.$transaction(async (tx) => {
    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: "paid",
        paidAt: new Date(),
      },
    });

    await tx.ticket.update({
      where: { id: ticket.id },
      data: {
        paymentStatus: "paid",
      },
    });
  });

  const updatedTicket = await db.ticket.findUnique({
    where: { id: ticket.id },
    include: {
      payments: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });

  res.json(formatTicketDto(updatedTicket));
});


// POST /admin/tickets/:code/check-in (Admin & Petugas)
adminTicketsRouter.post("/:code/check-in", requireAuth, async (req, res) => {
  const code = req.params.code as string;
  const ticket = await db.ticket.findUnique({
    where: { code },
    include: {
      payments: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });

  if (!ticket) {
    return res.status(404).json({ error: "NOT_FOUND" });
  }

  if (ticket.paymentStatus !== "paid") {
    return res.status(409).json({ error: "NOT_PAID" });
  }

  const today = jakartaDate();
  if (ticket.status !== "waiting" || ticket.visitDate !== today) {
    return res.status(409).json({ error: "INVALID_STATE" });
  }

  const updated = await db.ticket.update({
    where: { id: ticket.id },
    data: {
      status: "inside",
      checkInAt: new Date(),
    },
    include: {
      payments: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });

  res.json(formatTicketDto(updated));
});

// POST /admin/tickets/:code/check-out (Admin & Petugas)
adminTicketsRouter.post("/:code/check-out", requireAuth, async (req, res) => {
  const code = req.params.code as string;
  const ticket = await db.ticket.findUnique({
    where: { code },
    include: {
      payments: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });

  if (!ticket) {
    return res.status(404).json({ error: "NOT_FOUND" });
  }

  if (ticket.status !== "inside") {
    return res.status(409).json({ error: "INVALID_STATE" });
  }

  const updated = await db.ticket.update({
    where: { id: ticket.id },
    data: {
      status: "out",
      checkOutAt: new Date(),
    },
    include: {
      payments: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });

  res.json(formatTicketDto(updated));
});
