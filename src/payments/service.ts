import { db } from "../lib/db.js";
import { config } from "../config.js";
import { providerFor } from "./index.js";

type AllowedPaymentStatus = "pending" | "paid" | "failed" | "expired" | "cancelled";

/**
 * Menerapkan perubahan status pembayaran dalam satu transaksi.
 * Hanya transisi maju dari pending (paid/failed/expired/cancelled bersifat final).
 * Idempoten: mengulang status yang sama tidak mengubah apa pun.
 */
export async function applyPaymentStatus(
  paymentId: string,
  newStatus: AllowedPaymentStatus,
  payload?: any
): Promise<{ ok: boolean; status: AllowedPaymentStatus }> {
  return await db.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({
      where: { id: paymentId },
    });

    if (!payment) {
      throw new Error("PAYMENT_NOT_FOUND");
    }

    // Jika sudah status yang sama, idempoten
    if (payment.status === newStatus) {
      return { ok: true, status: payment.status as AllowedPaymentStatus };
    }

    // Jika sudah final (bukan pending), tidak boleh diubah lagi
    if (payment.status !== "pending") {
      return { ok: true, status: payment.status as AllowedPaymentStatus };
    }

    const isPaid = newStatus === "paid";
    const updateData: any = {
      status: newStatus,
      ...(isPaid ? { paidAt: new Date() } : {}),
      ...(payload !== undefined ? { lastPayload: payload } : {}),
    };

    await tx.payment.update({
      where: { id: paymentId },
      data: updateData,
    });

    // Perbarui status tiket terkait jika ada
    if (payment.ticketId) {
      await tx.ticket.update({
        where: { id: payment.ticketId },
        data: {
          paymentStatus: newStatus,
        },
      });
    }

    // Perbarui status booking terkait jika ada (P3)
    if (payment.bookingId) {
      await tx.booking.update({
        where: { id: payment.bookingId },
        data: {
          paymentStatus: newStatus,
        },
      });
    }

    return { ok: true, status: newStatus };
  });
}

/**
 * Sinkronisasi pembayaran dengan provider jika masih pending dan metode QRIS.
 */
export async function syncPayment(paymentId: string) {
  const payment = await db.payment.findUnique({
    where: { id: paymentId },
  });

  if (!payment || payment.status !== "pending" || payment.method !== "qris") {
    return payment;
  }

  // Jika simulation, simulation getStatus tetap pending
  if (payment.provider === "simulation" || payment.provider === "midtrans") {
    const provider = providerFor(payment.provider);
    if (payment.providerOrderId) {
      const res = await provider.getStatus(payment.providerOrderId);
      if (res.status !== payment.status) {
        await applyPaymentStatus(payment.id, res.status, res.raw);
      }
    }
  }

  return await db.payment.findUnique({ where: { id: paymentId } });
}
