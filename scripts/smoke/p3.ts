import { startTestServer, request, loginAs, check } from "./_helpers.js";
import { db } from "../../src/lib/db.js";

async function run() {
  console.log("=== Menjalankan Smoke Test P3 ===");
  const { baseUrl, close } = await startTestServer();

  try {
    const { cookie: adminCookie } = await loginAs(baseUrl, "admin");
    const { cookie: petugasCookie } = await loginAs(baseUrl, "petugas");

    // 1. Validasi input: item ganda, qty 0, wahana nonaktif
    const rDuplicateItem = await request(baseUrl, "/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "[SMOKE] Pembeli Ganda",
        whatsapp: "081234567890",
        slot: "08-09",
        items: [
          { rideId: "atv", qty: 1 },
          { rideId: "atv", qty: 2 },
        ],
      }),
    });
    check("Item ganda ditolak 400", rDuplicateItem.status === 400);

    const rQtyZero = await request(baseUrl, "/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "[SMOKE] Pembeli Qty 0",
        whatsapp: "081234567890",
        slot: "08-09",
        items: [{ rideId: "atv", qty: 0 }],
      }),
    });
    check("Qty 0 ditolak 400", rQtyZero.status === 400);

    // Buat wahana nonaktif untuk uji coba
    await db.ride.upsert({
      where: { id: "wahana-nonaktif-smoke" },
      update: { active: false },
      create: {
        id: "wahana-nonaktif-smoke",
        name: "[SMOKE] Wahana Nonaktif",
        category: "Wahana",
        price: 15000,
        unit: "",
        icon: "test",
        active: false,
      },
    });

    const rDisabledRide = await request(baseUrl, "/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "[SMOKE] Pembeli Wahana Nonaktif",
        whatsapp: "081234567890",
        slot: "08-09",
        items: [{ rideId: "wahana-nonaktif-smoke", qty: 1 }],
      }),
    });
    check("Wahana nonaktif ditolak 409 RIDE_UNAVAILABLE", rDisabledRide.status === 409 && rDisabledRide.body?.error === "RIDE_UNAVAILABLE");

    // 2. Buat booking normal: atv (25.000 x 2 = 50.000) + ban-kecil (5.000 x 1 = 5.000) = 55.000
    // Harga dari klien diabaikan jika disisipkan
    const rCreateBooking = await request(baseUrl, "/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "[SMOKE] Pelanggan Booking",
        whatsapp: "+62 856-7890-1234",
        slot: "09-10",
        items: [
          { rideId: "atv", qty: 2 },
          { rideId: "ban-kecil", qty: 1 },
        ],
        amount: 1000, // diabaikan server
      }),
    });
    check("Buat booking 201", rCreateBooking.status === 201);
    const booking = rCreateBooking.body;
    check("Total dihitung server 55000", booking.amount === 55000);
    check("WhatsApp dinormalisasi jadi 085678901234", booking.whatsapp === "085678901234");
    check("Label booking slot benar (09.00 - 10.00)", booking.slotLabel === "09.00 - 10.00");
    check("Lines berjumlah 2 item", Array.isArray(booking.lines) && booking.lines.length === 2);
    check("QRIS simulasi terbentuk", typeof booking.payment?.qrString === "string");

    // 3. Mengubah harga wahana setelah booking TIDAK mengubah unitPrice booking lama
    const originalAtv = await db.ride.findUnique({ where: { id: "atv" } });
    const originalPrice = originalAtv?.price ?? 25000;
    await db.ride.update({ where: { id: "atv" }, data: { price: 99000 } });

    const rCheckOldBooking = await request(baseUrl, `/bookings/${booking.code}?whatsapp=085678901234`);
    const atvLine = rCheckOldBooking.body.lines.find((l: any) => l.rideId === "atv");
    check("Harga unitPrice pada booking lama tetap 25000 tidak terpengaruh", atvLine?.unitPrice === 25000);

    // Kembalikan harga ATV ke semula
    await db.ride.update({ where: { id: "atv" }, data: { price: originalPrice } });

    // 4. simulate-pay mengubah booking menjadi paid
    const bookingPaymentId = booking.payment.id;
    const rPay = await request(baseUrl, `/payments/${bookingPaymentId}/simulate-pay`, {
      method: "POST",
    });
    check("simulate-pay booking berhasil 200", rPay.status === 200 && rPay.body?.status === "paid");

    const rVerifyBookingPaid = await request(baseUrl, `/bookings/${booking.code}?whatsapp=085678901234`);
    check("Status booking menjadi paid", rVerifyBookingPaid.body?.paymentStatus === "paid");

    // 5. Riwayat booking lewat WhatsApp (GET /bookings?whatsapp=)
    const rHistory = await request(baseUrl, "/bookings?whatsapp=085678901234");
    check("Riwayat booking WhatsApp berhasil", rHistory.status === 200 && Array.isArray(rHistory.body) && rHistory.body.length >= 1);

    // 6. Akses admin/petugas
    const rAdminBookings = await request(baseUrl, "/admin/bookings", {
      headers: { Cookie: petugasCookie },
    });
    check("Petugas GET /admin/bookings 200", rAdminBookings.status === 200 && Array.isArray(rAdminBookings.body?.items));

    const rAdminBookingDetail = await request(baseUrl, `/admin/bookings/${booking.code}`, {
      headers: { Cookie: adminCookie },
    });
    check("Admin GET /admin/bookings/:code 200", rAdminBookingDetail.status === 200 && rAdminBookingDetail.body?.code === booking.code);

    // 7. 5 Booking paralel menghasilkan kode urut unik
    console.log("  Menguji 5 pembuatan booking paralel...");
    const parallelBookings = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        request(baseUrl, "/bookings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: `[SMOKE] Pelanggan Paralel ${i}`,
            whatsapp: "081299998888",
            slot: "10-11",
            items: [{ rideId: "ban-kecil", qty: 1 }],
          }),
        })
      )
    );
    const codes = parallelBookings.map((r) => r.body.code);
    const uniqueCodes = new Set(codes);
    check("5 booking paralel memiliki kode unik", uniqueCodes.size === 5);

    console.log("=== Seluruh Pemeriksaan P3 LULUS ===");
  } finally {
    // Bersihkan semua data [SMOKE]
    await db.booking.deleteMany({
      where: { name: { startsWith: "[SMOKE]" } },
    });
    await db.ride.deleteMany({
      where: { id: "wahana-nonaktif-smoke" },
    });
    await close();
  }
}

run().catch((err) => {
  console.error("Smoke test P3 gagal:", err);
  process.exit(1);
});
