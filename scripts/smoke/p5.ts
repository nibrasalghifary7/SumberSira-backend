import { startTestServer, request, loginAs, check } from "./_helpers.js";
import { db } from "../../src/lib/db.js";
import { getCrowdLabel } from "../../src/constants.js";
import { jakartaDate } from "../../src/lib/time.js";

async function run() {
  console.log("=== Menjalankan Smoke Test P5 ===");

  // 1. Uji fungsi label keramaian secara langsung sesuai ambang batas
  check("39% label Sepi", getCrowdLabel(39) === "Sepi");
  check("40% label Sedang", getCrowdLabel(40) === "Sedang");
  check("75% label Sedang", getCrowdLabel(75) === "Sedang");
  check("76% label Ramai", getCrowdLabel(76) === "Ramai");

  const { baseUrl, close } = await startTestServer();

  try {
    const { cookie: petugasCookie } = await loginAs(baseUrl, "petugas");
    const today = jakartaDate();

    // 2. Buat tiket cash pending
    const rTicketPending = await request(baseUrl, "/tickets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "[SMOKE] Pengunjung Crowd Test",
        whatsapp: "081234567890",
        adults: 2,
        kids: 1,
        parking: "motor",
        arrival: "08.00 - 10.00",
        paymentMethod: "cash",
      }),
    });
    const ticket = rTicketPending.body;

    // Check-in tiket belum lunas -> 409 NOT_PAID
    const rCheckInUnpaid = await request(baseUrl, `/admin/tickets/${ticket.code}/check-in`, {
      method: "POST",
      headers: { Cookie: petugasCookie },
    });
    check("Check-in tiket belum lunas ditolak 409 NOT_PAID", rCheckInUnpaid.status === 409 && rCheckInUnpaid.body?.error === "NOT_PAID");

    // Lunaskan tiket lewat confirm-cash
    await request(baseUrl, `/admin/tickets/${ticket.code}/confirm-cash`, {
      method: "POST",
      headers: { Cookie: petugasCookie },
    });

    // Cek crowd awal
    const rCrowdBefore = await request(baseUrl, "/crowd");
    check("GET /crowd status 200", rCrowdBefore.status === 200);
    const insideBefore = rCrowdBefore.body.inside;

    // Check-in tiket yang sudah lunas -> 200 inside
    const rCheckInPaid = await request(baseUrl, `/admin/tickets/${ticket.code}/check-in`, {
      method: "POST",
      headers: { Cookie: petugasCookie },
    });
    check("Check-in tiket lunas berhasil 200", rCheckInPaid.status === 200 && rCheckInPaid.body?.status === "inside");

    // Check-in kedua kali -> 409 INVALID_STATE
    const rCheckInAgain = await request(baseUrl, `/admin/tickets/${ticket.code}/check-in`, {
      method: "POST",
      headers: { Cookie: petugasCookie },
    });
    check("Check-in ulang ditolak 409 INVALID_STATE", rCheckInAgain.status === 409 && rCheckInAgain.body?.error === "INVALID_STATE");

    // Crowd inside naik sesuai adults + kids (2 + 1 = 3)
    const rCrowdAfterIn = await request(baseUrl, "/crowd");
    check("Crowd inside bertambah 3 orang", rCrowdAfterIn.body.inside === insideBefore + 3);

    // Check-out tiket -> 200 out
    const rCheckOut = await request(baseUrl, `/admin/tickets/${ticket.code}/check-out`, {
      method: "POST",
      headers: { Cookie: petugasCookie },
    });
    check("Check-out berhasil 200", rCheckOut.status === 200 && rCheckOut.body?.status === "out");

    // Check-out kedua kali -> 409 INVALID_STATE
    const rCheckOutAgain = await request(baseUrl, `/admin/tickets/${ticket.code}/check-out`, {
      method: "POST",
      headers: { Cookie: petugasCookie },
    });
    check("Check-out ulang ditolak 409 INVALID_STATE", rCheckOutAgain.status === 409 && rCheckOutAgain.body?.error === "INVALID_STATE");

    // Crowd inside turun kembali ke semula
    const rCrowdAfterOut = await request(baseUrl, "/crowd");
    check("Crowd inside turun kembali setelah check-out", rCrowdAfterOut.body.inside === insideBefore);

    // 3. Tiket kemarin (dibuat manual via db) tidak masuk hitungan crowd hari ini
    await db.ticket.create({
      data: {
        code: "TK-SMOKE-YESTERDAY",
        name: "[SMOKE] Tiket Kemarin",
        whatsapp: "081234567890",
        adults: 5,
        kids: 0,
        parking: "none",
        arrival: "08.00 - 10.00",
        visitDate: "2026-11-11", // kemarin
        amount: 25000,
        paymentMethod: "cash",
        paymentStatus: "paid",
        status: "inside",
      },
    });

    const rCrowdCheckYesterday = await request(baseUrl, "/crowd");
    check("Tiket kemarin berstatus inside tidak dihitung di crowd hari ini", rCrowdCheckYesterday.body.inside === insideBefore);

    // 4. GET /admin/dashboard
    const rDashboard = await request(baseUrl, "/admin/dashboard", {
      headers: { Cookie: petugasCookie },
    });
    check("GET /admin/dashboard status 200", rDashboard.status === 200);
    check(
      "Dashboard memiliki field lengkap",
      typeof rDashboard.body?.ticketsToday === "number" &&
        typeof rDashboard.body?.visitorsToday === "number" &&
        typeof rDashboard.body?.bookingsToday === "number" &&
        typeof rDashboard.body?.revenueToday === "number" &&
        typeof rDashboard.body?.pendingCash === "number" &&
        typeof rDashboard.body?.pendingQris === "number" &&
        typeof rDashboard.body?.crowd?.inside === "number"
    );

    console.log("=== Seluruh Pemeriksaan P5 LULUS ===");
  } finally {
    await db.ticket.deleteMany({
      where: {
        OR: [
          { name: { startsWith: "[SMOKE]" } },
          { code: "TK-SMOKE-YESTERDAY" },
        ],
      },
    });
    await close();
  }
}

run().catch((err) => {
  console.error("Smoke test P5 gagal:", err);
  process.exit(1);
});
