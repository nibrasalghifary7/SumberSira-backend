/**
 * Smoke test P15 — kesiapan Midtrans.
 *
 * Tidak memanggil jaringan Midtrans sungguhan: seluruh request ke
 * api.sandbox.midtrans.com dicegat oleh fetch palsu. Yang diuji:
 * - charge QRIS: qr_string / URL dari actions[], expiresAt WIB, galat tanpa QR;
 * - webhook: signature valid + settlement -> paid, signature salah -> 403,
 *   amount tidak cocok / status tak dikenal -> 200 ignored, idempoten;
 * - polling GET /payments/:id memakai getStatus saat PAYMENT_MODE=midtrans;
 * - simulate-pay mati di mode midtrans;
 * - pemetaan transaction_status.
 */
import crypto from "node:crypto";

const MARK = `[SMOKE]-MT-${Date.now()}`;
const SERVER_KEY = "SMOKE-MIDTRANS-SERVER-KEY";

process.env.PAYMENT_MODE = "midtrans";
process.env.MIDTRANS_ENV = "sandbox";
process.env.MIDTRANS_SERVER_KEY = SERVER_KEY;

type FakeJson = Record<string, unknown>;

let chargeResponse: FakeJson = {};
let statusResponse: FakeJson = {};

function jsonResponse(data: FakeJson, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const originalFetch = globalThis.fetch;
(globalThis as any).fetch = async (input: any, init?: any) => {
  const url = typeof input === "string" ? input : String(input);

  if (url.includes("/v2/charge")) {
    return jsonResponse(chargeResponse);
  }

  if (/\/v2\/.+\/status/.test(url)) {
    return jsonResponse(statusResponse);
  }

  return originalFetch(input, init);
};

function sign(orderId: string, statusCode: string, grossAmount: string): string {
  return crypto
    .createHash("sha512")
    .update(`${orderId}${statusCode}${grossAmount}${SERVER_KEY}`)
    .digest("hex");
}

async function run() {
  const { startTestServer, request, check } = await import("./_helpers.js");
  const { db } = await import("../../src/lib/db.js");
  const { midtransProvider, mapMidtransStatus } = await import("../../src/payments/index.js");

  console.log("=== Menjalankan Smoke Test P15 (kesiapan Midtrans) ===");
  const { baseUrl, close } = await startTestServer();
  const paymentIds: string[] = [];

  try {
    // ---------- 1. Charge QRIS ----------
    chargeResponse = {
      status_code: "201",
      transaction_id: "mt-tx-1",
      qr_string: "00020101021226670016COM.GOJEK.WWW0118",
      expiry_time: "2026-11-18 10:00:00",
    };
    const charge1 = await midtransProvider.createQris({
      orderId: `${MARK}-charge-1`,
      amount: 50000,
      customerName: "Uji",
      customerPhone: "08123456789",
      items: [{ id: "ticket", name: "Tiket Masuk", price: 50000, quantity: 1 }],
    });
    check("Charge mengambil qr_string", charge1.qrString === chargeResponse.qr_string);
    check("Charge menyimpan transaction_id", charge1.providerTransactionId === "mt-tx-1");
    check(
      "expiry_time WIB (10:00) menjadi 03:00Z",
      charge1.expiresAt.toISOString() === "2026-11-18T03:00:00.000Z",
      charge1.expiresAt.toISOString()
    );

    chargeResponse = {
      status_code: "201",
      transaction_id: "mt-tx-2",
      actions: [{ name: "generate-qr-code", method: "GET", url: "https://api.example/qr-2" }],
    };
    const charge2 = await midtransProvider.createQris({
      orderId: `${MARK}-charge-2`,
      amount: 25000,
      customerName: "Uji",
      customerPhone: "08123456789",
      items: [{ id: "ticket", name: "Tiket Masuk", price: 25000, quantity: 1 }],
    });
    check("Charge memakai URL QR dari actions[]", charge2.qrUrl === "https://api.example/qr-2");
    check(
      "expiresAt default ~15 menit",
      charge2.expiresAt.getTime() > Date.now() + 14 * 60 * 1000 &&
        charge2.expiresAt.getTime() <= Date.now() + 16 * 60 * 1000
    );

    chargeResponse = { status_code: "201", transaction_id: "mt-tx-3" };
    let noQrError = "";
    try {
      await midtransProvider.createQris({
        orderId: `${MARK}-charge-3`,
        amount: 25000,
        customerName: "Uji",
        customerPhone: "08123456789",
        items: [{ id: "ticket", name: "Tiket Masuk", price: 25000, quantity: 1 }],
      });
    } catch (err) {
      noQrError = String(err);
    }
    check("Charge tanpa QR melempar galat (route -> PAYMENT_PROVIDER_ERROR)", noQrError.length > 0);

    // ---------- 2. Pemetaan status ----------
    check("settlement -> paid", mapMidtransStatus("settlement") === "paid");
    check("capture -> paid", mapMidtransStatus("capture", "accept") === "paid");
    check("expire -> expired", mapMidtransStatus("expire") === "expired");
    check("cancel -> cancelled", mapMidtransStatus("cancel") === "cancelled");
    check("deny -> failed", mapMidtransStatus("deny") === "failed");
    check("failure -> failed", mapMidtransStatus("failure") === "failed");

    // ---------- 3. Webhook ----------
    const p1 = await db.payment.create({
      data: {
        method: "qris",
        provider: "midtrans",
        status: "pending",
        amount: 50000,
        providerOrderId: `${MARK}-order-1`,
      },
    });
    paymentIds.push(p1.id);

    const p2 = await db.payment.create({
      data: {
        method: "qris",
        provider: "midtrans",
        status: "pending",
        amount: 50000,
        providerOrderId: `${MARK}-order-2`,
      },
    });
    paymentIds.push(p2.id);

    statusResponse = {
      status_code: "200",
      transaction_status: "settlement",
      fraud_status: "accept",
      gross_amount: "50000.00",
    };

    const validBody = {
      order_id: p1.providerOrderId,
      status_code: "200",
      gross_amount: "50000.00",
      transaction_status: "settlement",
      signature_key: sign(p1.providerOrderId!, "200", "50000.00"),
    };

    const rValid = await request(baseUrl, "/payments/midtrans/notification", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validBody),
    });
    check("Webhook signature valid dibalas 200", rValid.status === 200 && rValid.body?.ok === true);

    const p1After = await db.payment.findUnique({ where: { id: p1.id } });
    check("Webhook settlement membuat payment paid", p1After?.status === "paid");
    check("paidAt terisi", p1After?.paidAt instanceof Date);

    const firstPaidAt = p1After?.paidAt?.getTime();
    const rRepeat = await request(baseUrl, "/payments/midtrans/notification", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validBody),
    });
    const p1Repeat = await db.payment.findUnique({ where: { id: p1.id } });
    check("Webhook berulang idempoten (200)", rRepeat.status === 200 && rRepeat.body?.ok === true);
    check("paidAt tidak berubah saat diulang", p1Repeat?.paidAt?.getTime() === firstPaidAt);

    const rBadSig = await request(baseUrl, "/payments/midtrans/notification", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...validBody, order_id: p2.providerOrderId, signature_key: "abc123" }),
    });
    check("Signature salah dibalas 403", rBadSig.status === 403, `status ${rBadSig.status}`);
    check("Signature salah error FORBIDDEN", rBadSig.body?.error === "FORBIDDEN");
    const p2AfterBadSig = await db.payment.findUnique({ where: { id: p2.id } });
    check("Signature salah tidak mengubah status", p2AfterBadSig?.status === "pending");

    const mismatchBody = {
      order_id: p2.providerOrderId,
      status_code: "200",
      gross_amount: "1000.00",
      transaction_status: "settlement",
      signature_key: sign(p2.providerOrderId!, "200", "1000.00"),
    };
    const rMismatch = await request(baseUrl, "/payments/midtrans/notification", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(mismatchBody),
    });
    check(
      "Amount tidak cocok dibalas 200 ignored",
      rMismatch.status === 200 && rMismatch.body?.ignored === true,
      JSON.stringify(rMismatch.body)
    );
    const p2AfterMismatch = await db.payment.findUnique({ where: { id: p2.id } });
    check("Amount tidak cocok tidak mengubah status", p2AfterMismatch?.status === "pending");

    // Status tak dikenal (refund) -> getStatus memetakan pending -> ignored
    statusResponse = { status_code: "200", transaction_status: "refund", gross_amount: "50000.00" };
    const refundBody = {
      order_id: p2.providerOrderId,
      status_code: "200",
      gross_amount: "50000.00",
      transaction_status: "refund",
      signature_key: sign(p2.providerOrderId!, "200", "50000.00"),
    };
    const rUnknown = await request(baseUrl, "/payments/midtrans/notification", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(refundBody),
    });
    check(
      "Status tak dikenal dibalas 200 ignored",
      rUnknown.status === 200 && rUnknown.body?.ignored === true,
      JSON.stringify(rUnknown.body)
    );

    const unknownOrder = {
      order_id: `${MARK}-tidak-ada`,
      status_code: "200",
      gross_amount: "50000.00",
      transaction_status: "settlement",
      signature_key: sign(`${MARK}-tidak-ada`, "200", "50000.00"),
    };
    const rUnknownOrder = await request(baseUrl, "/payments/midtrans/notification", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(unknownOrder),
    });
    check(
      "Order id tak dikenal dibalas 200 ignored",
      rUnknownOrder.status === 200 && rUnknownOrder.body?.ignored === true
    );

    // ---------- 4. Polling GET /payments/:id memakai getStatus ----------
    statusResponse = {
      status_code: "200",
      transaction_status: "settlement",
      fraud_status: "accept",
      gross_amount: "50000.00",
    };
    const rPoll = await request(baseUrl, `/payments/${p2.id}`);
    check("Polling status 200", rPoll.status === 200);
    check("Polling menyinkronkan settlement menjadi paid", rPoll.body?.status === "paid");
    const p2AfterPoll = await db.payment.findUnique({ where: { id: p2.id } });
    check("Polling menyimpan status paid ke database", p2AfterPoll?.status === "paid");

    // ---------- 5. simulate-pay mati di mode midtrans ----------
    const rSimulate = await request(baseUrl, `/payments/${p2.id}/simulate-pay`, {
      method: "POST",
    });
    check("simulate-pay 404 saat PAYMENT_MODE=midtrans", rSimulate.status === 404);

    console.log("=== Seluruh Pemeriksaan P15 LULUS ===");
  } finally {
    (globalThis as any).fetch = originalFetch;
    if (paymentIds.length > 0) {
      await db.payment.deleteMany({ where: { id: { in: paymentIds } } });
    }
    await close();
  }
}

run().catch((err) => {
  (globalThis as any).fetch = originalFetch;
  console.error("Smoke test P15 gagal:", err);
  process.exit(1);
});
