// Model payment: skema validasi input (zod) dan pemetaan data ke bentuk respons API.
export function formatPaymentDto(p: any) {
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
