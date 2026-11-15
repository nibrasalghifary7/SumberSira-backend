import { Router } from "express";
import crypto from "node:crypto";
import { db } from "../lib/db.js";
import { config } from "../config.js";
import { applyPaymentStatus, syncPayment } from "../payments/service.js";
import { providerFor } from "../payments/index.js";
import { publicLimiter } from "../lib/limiters.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

export const paymentsRouter = Router();
export const adminPaymentsRouter = Router();

function formatPaymentDto(p: any) {
  return {
    id: p.id,
    ticketId: p.ticketId,
    bookingId: p.bookingId,
    method: p.method,
    provider: p.provider,
    status: p.status,
    amount: p.amount,
    providerOrderId: p.providerOrderId,
    qrString: p.qrString,
    qrUrl: p.qrUrl,
    expiresAt: p.expiresAt ? p.expiresAt.toISOString() : null,
    paidAt: p.paidAt ? p.paidAt.toISOString() : null,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

// POST /payments/midtrans/notification (Webhook Midtrans: Publik, tanpa auth, tanpa limit ketat)
paymentsRouter.post("/midtrans/notification", async (req, res) => {
  const { order_id, status_code, gross_amount, signature_key, transaction_status } = req.body || {};

  if (!order_id || !status_code || !gross_amount || !signature_key || !transaction_status) {
    return res.status(400).json({ error: "VALIDATION" });
  }

  // 1. Verifikasi signature: sha512(order_id + status_code + gross_amount + SERVER_KEY)
  const expectedSig = crypto
    .createHash("sha512")
    .update(`${order_id}${status_code}${gross_amount}${config.MIDTRANS_SERVER_KEY}`)
    .digest("hex");

  const sigBuffer = Buffer.from(String(signature_key), "utf-8");
  const expectedBuffer = Buffer.from(expectedSig, "utf-8");

  if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
    return res.status(403).json({ error: "FORBIDDEN" });
  }

  // 2. Cari Payment berdasarkan providerOrderId
  const payment = await db.payment.findUnique({
    where: { providerOrderId: String(order_id) },
  });

  if (!payment) {
    console.warn(`[MIDTRANS WEBHOOK] Order id tidak ditemukan: ${order_id}`);
    return res.status(200).json({ ok: true, ignored: true });
  }

  // 3. Konfirmasi ulang dengan provider.getStatus(order_id) sebagai sumber kebenaran
  try {
    const provider = providerFor("midtrans");
    const statusResult = await provider.getStatus(String(order_id));

    // Pastikan gross_amount sesuai payment.amount
    if (Number(gross_amount) !== payment.amount) {
      console.warn(`[MIDTRANS WEBHOOK] Amount tidak cocok: received ${gross_amount}, expected ${payment.amount}`);
      return res.status(200).json({ ok: true, ignored: true });
    }

    // Apply status pembayaran
    await applyPaymentStatus(payment.id, statusResult.status, req.body);
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("[MIDTRANS WEBHOOK] Gagal memverifikasi status ke Midtrans API:", err);
    return res.status(500).json({ error: "INTERNAL" });
  }
});

// GET /payments/:id (Publik)
paymentsRouter.get("/:id", publicLimiter, async (req, res) => {
  const id = req.params.id as string;
  let payment = await db.payment.findUnique({ where: { id } });

  if (!payment) {
    return res.status(404).json({ error: "NOT_FOUND" });
  }

  // Jika masih pending dan QRIS, panggil syncPayment dulu
  if (payment.status === "pending" && payment.method === "qris") {
    payment = (await syncPayment(payment.id)) ?? payment;
  }

  res.json(formatPaymentDto(payment));
});

// POST /payments/:id/simulate-pay (Publik, hanya simulation mode dan bukan produksi)
paymentsRouter.post("/:id/simulate-pay", publicLimiter, async (req, res) => {
  if (config.PAYMENT_MODE !== "simulation" || config.NODE_ENV === "production") {
    return res.status(404).json({ error: "NOT_FOUND" });
  }

  const id = req.params.id as string;
  const payment = await db.payment.findUnique({ where: { id } });

  if (!payment) {
    return res.status(404).json({ error: "NOT_FOUND" });
  }

  // Idempoten apply status "paid"
  await applyPaymentStatus(payment.id, "paid", { simulated: true, simulatedAt: new Date().toISOString() });

  const updated = await db.payment.findUnique({ where: { id } });
  res.json(formatPaymentDto(updated));
});

// POST /admin/payments/:id/mark-paid (Khusus Admin)
adminPaymentsRouter.post("/:id/mark-paid", requireAuth, requireRole("admin"), async (req, res) => {
  const id = req.params.id as string;
  const payment = await db.payment.findUnique({ where: { id } });

  if (!payment) {
    return res.status(404).json({ error: "NOT_FOUND" });
  }

  if (payment.status !== "pending") {
    return res.status(409).json({ error: "INVALID_STATE" });
  }

  await applyPaymentStatus(payment.id, "paid", { manualMarkedByAdmin: true });

  const updated = await db.payment.findUnique({ where: { id } });
  res.json(formatPaymentDto(updated));
});

// POST /admin/payments/:id/cancel (Khusus Admin)
adminPaymentsRouter.post("/:id/cancel", requireAuth, requireRole("admin"), async (req, res) => {
  const id = req.params.id as string;
  const payment = await db.payment.findUnique({ where: { id } });

  if (!payment) {
    return res.status(404).json({ error: "NOT_FOUND" });
  }

  if (payment.status !== "pending") {
    return res.status(409).json({ error: "INVALID_STATE" });
  }

  await applyPaymentStatus(payment.id, "cancelled", { manualCancelledByAdmin: true });

  const updated = await db.payment.findUnique({ where: { id } });
  res.json(formatPaymentDto(updated));
});
