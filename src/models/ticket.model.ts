// Model ticket: skema validasi input (zod) dan pemetaan data ke bentuk respons API.
import { z } from "zod";

export const createTicketSchema = z.object({
  name: z.string().trim().min(1).max(60),
  whatsapp: z.string(),
  adults: z.number().int().min(1).max(30),
  kids: z.number().int().min(0).max(10).default(0),
  parking: z.enum(["none", "motor", "mobil", "bus"]),
  arrival: z.string().min(1),
  paymentMethod: z.enum(["qris", "cash"]),
});

export function formatTicketDto(ticket: any, payment?: any) {
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
