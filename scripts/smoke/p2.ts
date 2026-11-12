import { startTestServer, request, loginAs, check } from "./_helpers.js";
import { db } from "../../src/lib/db.js";

async function run() {
  console.log("=== Menjalankan Smoke Test P2 ===");
  const { baseUrl, close } = await startTestServer();

  try {
    const { cookie: petugasCookie } = await loginAs(baseUrl, "petugas");
    const { cookie: adminCookie } = await loginAs(baseUrl, "admin");

    // 1. Validasi input ditolak: adults 0, arrival ngawur, whatsapp ngawur
    const rInvalidAdults = await request(baseUrl, "/tickets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "[SMOKE] Budi",
        whatsapp: "081234567890",
        adults: 0,
        kids: 0,
        parking: "motor",
        arrival: "08.00 - 10.00",
        paymentMethod: "qris",
      }),
    });
    check("adults 0 ditolak 400", rInvalidAdults.status === 400);

    const rInvalidArrival = await request(baseUrl, "/tickets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "[SMOKE] Budi",
        whatsapp: "081234567890",
        adults: 2,
        kids: 0,
        parking: "motor",
        arrival: "slot tidak valid",
        paymentMethod: "qris",
      }),
    });
    check("arrival ngawur ditolak 400", rInvalidArrival.status === 400);

    const rInvalidWa = await request(baseUrl, "/tickets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "[SMOKE] Budi",
        whatsapp: "abc1234",
        adults: 2,
        kids: 0,
        parking: "motor",
        arrival: "08.00 - 10.00",
        paymentMethod: "qris",
      }),
    });
    check("whatsapp tak valid ditolak 400", rInvalidWa.status === 400);

    // 2. Normalisasi WhatsApp (+62 812-3456-7890 -> 081234567890)
    // Harga dihitung benar: 2 dewasa (2 * 5000) + motor (3000) + 1 anak (0) = 13000
    // Harga dari klien diabaikan jika disisipkan
    const rCreateQris = await request(baseUrl, "/tickets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "[SMOKE] Pembeli QRIS",
        whatsapp: "+62 812-3456-7890",
        adults: 2,
        kids: 1,
        parking: "motor",
        arrival: "08.00 - 10.00",
        paymentMethod: "qris",
        amount: 999999, // sengaja dikirim klien untuk diuji bahwa server mengabaikannya
      }),
    });
    check("Beli tiket QRIS 201", rCreateQris.status === 201);
    const qrisTicket = rCreateQris.body;
    check("WhatsApp dinormalisasi jadi 081234567890", qrisTicket.whatsapp === "081234567890");
    check("Harga dihitung server 13000", qrisTicket.amount === 13000);
    check("people adalah adults + kids (3)", qrisTicket.people === 3);
    check("QRIS simulasi menghasilkan qrString", typeof qrisTicket.payment?.qrString === "string" && qrisTicket.payment.qrString.startsWith("QRIS-SIM:"));

    // 3. GET /tickets/:code?whatsapp= (A4)
    const rGetTicketWrongWa = await request(baseUrl, `/tickets/${qrisTicket.code}?whatsapp=081111111111`);
    check("Ambil tiket dengan WhatsApp salah menghasilkan 404", rGetTicketWrongWa.status === 404);

    const rGetTicketCorrect = await request(baseUrl, `/tickets/${qrisTicket.code}?whatsapp=081234567890`);
    check("Ambil tiket dengan WhatsApp benar berhasil 200", rGetTicketCorrect.status === 200);

    // 4. GET /payments/:id
    const paymentId = qrisTicket.payment.id;
    const rGetPayment = await request(baseUrl, `/payments/${paymentId}`);
    check("GET /payments/:id status 200", rGetPayment.status === 200 && rGetPayment.body?.status === "pending");

    // 5. POST /payments/:id/simulate-pay -> mengubah jadi paid
    const rSimPay = await request(baseUrl, `/payments/${paymentId}/simulate-pay`, {
      method: "POST",
    });
    check("simulate-pay berhasil 200", rSimPay.status === 200 && rSimPay.body?.status === "paid");

    // Ulangi simulate-pay -> idempoten
    const rSimPayAgain = await request(baseUrl, `/payments/${paymentId}/simulate-pay`, {
      method: "POST",
    });
    check("simulate-pay idempoten tetap 200 paid", rSimPayAgain.status === 200 && rSimPayAgain.body?.status === "paid");

    // Verifikasi tiket ikut berubah jadi paid
    const rCheckTicketPaid = await request(baseUrl, `/tickets/${qrisTicket.code}?whatsapp=081234567890`);
    check("Tiket status pembayaran menjadi paid", rCheckTicketPaid.body?.paymentStatus === "paid");

    // 6. Alur Cash / Tunai
    const rCreateCash = await request(baseUrl, "/tickets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "[SMOKE] Pembeli Cash",
        whatsapp: "089876543210",
        adults: 1,
        kids: 0,
        parking: "none",
        arrival: "08.00 - 10.00",
        paymentMethod: "cash",
      }),
    });
    check("Beli tiket Cash 201", rCreateCash.status === 201);
    const cashTicket = rCreateCash.body;
    check("QR fields bernilai null untuk Cash", cashTicket.payment?.qrString === null);

    // confirm-cash tanpa auth -> 401
    const rConfirmNoAuth = await request(baseUrl, `/admin/tickets/${cashTicket.code}/confirm-cash`, {
      method: "POST",
    });
    check("confirm-cash tanpa login menghasilkan 401", rConfirmNoAuth.status === 401);

    // confirm-cash oleh petugas -> 200
    const rConfirmPetugas = await request(baseUrl, `/admin/tickets/${cashTicket.code}/confirm-cash`, {
      method: "POST",
      headers: { Cookie: petugasCookie },
    });
    check("confirm-cash oleh petugas berhasil 200", rConfirmPetugas.status === 200 && rConfirmPetugas.body?.paymentStatus === "paid");

    // 7. mark-paid & cancel pembayaran oleh Admin vs Petugas
    const rCreatePendingForAdmin = await request(baseUrl, "/tickets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "[SMOKE] Pembeli Demo Admin",
        whatsapp: "087777777777",
        adults: 1,
        kids: 0,
        parking: "none",
        arrival: "08.00 - 10.00",
        paymentMethod: "qris",
      }),
    });
    const pendingPaymentId = rCreatePendingForAdmin.body.payment.id;

    // mark-paid oleh petugas -> 403
    const rMarkPaidPetugas = await request(baseUrl, `/admin/payments/${pendingPaymentId}/mark-paid`, {
      method: "POST",
      headers: { Cookie: petugasCookie },
    });
    check("mark-paid oleh petugas ditolak 403", rMarkPaidPetugas.status === 403);

    // mark-paid oleh admin -> 200
    const rMarkPaidAdmin = await request(baseUrl, `/admin/payments/${pendingPaymentId}/mark-paid`, {
      method: "POST",
      headers: { Cookie: adminCookie },
    });
    check("mark-paid oleh admin berhasil 200", rMarkPaidAdmin.status === 200 && rMarkPaidAdmin.body?.status === "paid");

    // 8. 10 Pembelian tiket paralel menghasilkan kode unik berurutan
    console.log("  Menguji 10 pembuatan tiket paralel...");
    const parallelTickets = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        request(baseUrl, "/tickets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: `[SMOKE] Pembeli Paralel ${i}`,
            whatsapp: "081234567890",
            adults: 1,
            kids: 0,
            parking: "none",
            arrival: "08.00 - 10.00",
            paymentMethod: "cash",
          }),
        })
      )
    );
    const codes = parallelTickets.map((r) => r.body.code);
    const uniqueCodes = new Set(codes);
    check("10 tiket paralel memiliki kode unik", uniqueCodes.size === 10);

    // 9. Riwayat tiket berdasarkan nomor WhatsApp (GET /tickets?whatsapp=)
    const rHistory = await request(baseUrl, "/tickets?whatsapp=081234567890");
    check("Riwayat tiket WhatsApp 200", rHistory.status === 200 && Array.isArray(rHistory.body) && rHistory.body.length >= 11);

    console.log("=== Seluruh Pemeriksaan P2 LULUS ===");
  } finally {
    // Bersihkan semua data [SMOKE]
    await db.ticket.deleteMany({
      where: { name: { startsWith: "[SMOKE]" } },
    });
    await close();
  }
}

run().catch((err) => {
  console.error("Smoke test P2 gagal:", err);
  process.exit(1);
});
