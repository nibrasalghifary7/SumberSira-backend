// Model booking: skema validasi input (zod) dan pemetaan data ke bentuk respons API.
import { z } from "zod";
import { BOOKING_SLOT_ITEMS, BOOKING_SLOTS } from "../config/constants.js";

export const bookingItemSchema = z.object({
  rideId: z.string().min(1),
  qty: z.number().int().min(1).max(20),
});

export const createBookingSchema = z.object({
  name: z.string().trim().min(1).max(60),
  whatsapp: z.string(),
  slot: z.enum(BOOKING_SLOTS as unknown as [string, ...string[]]),
  visitDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  items: z.array(bookingItemSchema).min(1).max(8),
});

export function getSlotLabel(slotId: string): string {
  const found = BOOKING_SLOT_ITEMS.find((s) => s.id === slotId);
  return found ? found.label : slotId;
}

export function getBookingLineLabel(ride: { name: string; unit: string }): string {
  if (!ride.unit || ride.unit.trim() === "") {
    return ride.name;
  }
  if (ride.unit.toLowerCase().includes("menit")) {
    return `${ride.name} (${ride.unit})`;
  }
  return `${ride.name} (per ${ride.unit})`;
}

export function formatBookingDto(booking: any, payment?: any) {
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
