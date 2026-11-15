import crypto from "node:crypto";
import { startTestServer, request, check } from "./_helpers.js";
import { db } from "../../src/lib/db.js";
import { mapMidtransStatus } from "../../src/payments/index.js";
import { config } from "../../src/config.js";

async function run() {
  console.log("=== Menjalankan Smoke Test P4 ===");

  // 1. Uji pemetaan seluruh transaction_status Midtrans
  check("Pemetaan settlement -> paid", mapMidtransStatus("settlement") === "paid");
  check("Pemetaan capture accept -> paid", mapMidtransStatus("capture", "accept") === "paid");
  check("Pemetaan capture challenge -> pending", mapMidtransStatus("capture", "challenge") === "pending");
  check("Pemetaan pending -> pending", mapMidtransStatus("pending") === "pending");
  check("Pemetaan expire -> expired", mapMidtransStatus("expire") === "expired");
  check("Pemetaan cancel -> cancelled", mapMidtransStatus("cancel") === "cancelled");
  check("Pemetaan deny -> failed", mapMidtransStatus("deny") === "failed");
  check("Pemetaan failure -> failed", mapMidtransStatus("failure") === "failed");
  check("Pemetaan refund -> pending (tidak diubah)", mapMidtransStatus("refund") === "pending");

  const { baseUrl, close } = await startTestServer();

  try {
    const originalServerKey = config.MIDTRANS_SERVER_KEY;
    const testServerKey = "SB-Mid-server-test-key-12345";
    (config as any).MIDTRANS_SERVER_KEY = testServerKey;

    // Buat data tiket & payment simulasi untuk webhook
    const orderId = `TK-9999-TEST`;
    const grossAmount = "13000.00";
    const amountNum = 13000;

    const testTicket = await db.ticket.create({
      data: {
        code: "TK-9999",
        name: "[SMOKE] Pembeli Midtrans Test",
        whatsapp: "081234567890",
        adults: 2,
        kids: 0,
        parking: "motor",
        arrival: "08.00 - 10.00",
        visitDate: "2026-11-12",
        amount: amountNum,
        paymentMethod: "qris",
        paymentStatus: "pending",
        status: "waiting",
      },
    });

    const testPayment = await db.payment.create({
      data: {
        ticketId: testTicket.id,
        method: "qris",
        provider: "midtrans",
        status: "pending",
        amount: amountNum,
        providerOrderId: orderId,
      },
    });

    // 2. Tanda tangan Midtrans: sha512(order_id + status_code + gross_amount + SERVER_KEY)
    const validSignature = crypto
      .createHash("sha512")
      .update(`${orderId}200${grossAmount}${testServerKey}`)
      .digest("hex");

    const invalidSignature = crypto
      .createHash("sha512")
      .update(`${orderId}200${grossAmount}KUNCI_SALAH`)
      .digest("hex");

    // Uji tanda tangan salah ditolak 403
    const rInvalidSig = await request(baseUrl, "/payments/midtrans/notification", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        order_id: orderId,
        status_code: "200",
        gross_amount: grossAmount,
        signature_key: invalidSignature,
        transaction_status: "settlement",
      }),
    });
    check("Signature salah ditolak 403", rInvalidSig.status === 403);

    // Uji gross_amount yang dikonversi angka (misal "13000" bukan "13000.00") menghasilkan penolakan 403
    const wrongFormatSignature = crypto
      .createHash("sha512")
      .update(`${orderId}20013000${testServerKey}`)
      .digest("hex");
    const rWrongAmountFormat = await request(baseUrl, "/payments/midtrans/notification", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        order_id: orderId,
        status_code: "200",
        gross_amount: grossAmount, // "13000.00"
        signature_key: wrongFormatSignature, // di-hash dari "13000"
        transaction_status: "settlement",
      }),
    });
    check("gross_amount format tidak persis menghasilkan penolakan 403", rWrongAmountFormat.status === 403);

    // 3. order_id tak dikenal menghasilkan 200 ignored
    const unknownOrderId = "TK-UNKNOWN-0000";
    const unknownSignature = crypto
      .createHash("sha512")
      .update(`${unknownOrderId}200${grossAmount}${testServerKey}`)
      .digest("hex");

    const rUnknownOrder = await request(baseUrl, "/payments/midtrans/notification", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        order_id: unknownOrderId,
        status_code: "200",
        gross_amount: grossAmount,
        signature_key: unknownSignature,
        transaction_status: "settlement",
      }),
    });
    check("order_id tak dikenal menghasilkan 200 ignored", rUnknownOrder.status === 200 && rUnknownOrder.body?.ignored === true);

    // 4. Mock global fetch untuk getStatus saat validasi webhook
    const originalFetch = global.fetch;
    try {
      (global as any).fetch = async (url: string, init?: any) => {
        if (typeof url === "string" && url.includes(`/v2/${orderId}/status`)) {
          return new Response(
            JSON.stringify({
              status_code: "200",
              transaction_status: "settlement",
              gross_amount: grossAmount,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        return originalFetch(url, init);
      };

      // Notifikasi settlement mengubah pembayaran dan tiket menjadi paid
      const rValidNotification = await request(baseUrl, "/payments/midtrans/notification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order_id: orderId,
          status_code: "200",
          gross_amount: grossAmount,
          signature_key: validSignature,
          transaction_status: "settlement",
        }),
      });
      check("Notifikasi valid berhasil 200", rValidNotification.status === 200 && rValidNotification.body?.ok === true);

      // Verifikasi status di DB
      const updatedPayment = await db.payment.findUnique({ where: { id: testPayment.id } });
      const updatedTicket = await db.ticket.findUnique({ where: { id: testTicket.id } });
      check("Payment status menjadi paid", updatedPayment?.status === "paid");
      check("Ticket status menjadi paid", updatedTicket?.paymentStatus === "paid");

      // Mengirim dua kali tidak mengubah apa pun (idempoten)
      const rDuplicateNotification = await request(baseUrl, "/payments/midtrans/notification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order_id: orderId,
          status_code: "200",
          gross_amount: grossAmount,
          signature_key: validSignature,
          transaction_status: "settlement",
        }),
      });
      check("Notifikasi duplikat tetap 200 idempoten", rDuplicateNotification.status === 200);

      // 5. Uji amount tidak cocok tidak mengubah status
      const mismatchOrderId = "TK-MISMATCH-123";
      const mismatchPayment = await db.payment.create({
        data: {
          method: "qris",
          provider: "midtrans",
          status: "pending",
          amount: 50000, // DB amount 50000
          providerOrderId: mismatchOrderId,
        },
      });

      const mismatchGross = "13000.00"; // payload gross 13000
      const mismatchSignature = crypto
        .createHash("sha512")
        .update(`${mismatchOrderId}200${mismatchGross}${testServerKey}`)
        .digest("hex");

      const rMismatchAmount = await request(baseUrl, "/payments/midtrans/notification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order_id: mismatchOrderId,
          status_code: "200",
          gross_amount: mismatchGross,
          signature_key: mismatchSignature,
          transaction_status: "settlement",
        }),
      });
      check("Amount tidak cocok menghasilkan 200 ignored", rMismatchAmount.status === 200 && rMismatchAmount.body?.ignored === true);

      const checkPaymentMismatch = await db.payment.findUnique({ where: { id: mismatchPayment.id } });
      check("Payment amount tidak cocok tetap pending", checkPaymentMismatch?.status === "pending");

      await db.payment.delete({ where: { id: mismatchPayment.id } });
    } finally {
      global.fetch = originalFetch;
      (config as any).MIDTRANS_SERVER_KEY = originalServerKey;
    }

    console.log("=== Seluruh Pemeriksaan P4 LULUS ===");
  } finally {
    await db.ticket.deleteMany({
      where: { name: { startsWith: "[SMOKE]" } },
    });
    await close();
  }
}

run().catch((err) => {
  console.error("Smoke test P4 gagal:", err);
  process.exit(1);
});
