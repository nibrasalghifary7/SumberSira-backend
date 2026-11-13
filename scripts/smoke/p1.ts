import { startTestServer, request, loginAs, check } from "./_helpers.js";
import { nextSeq } from "../../src/lib/seq.js";
import { db } from "../../src/lib/db.js";

async function run() {
  console.log("=== Menjalankan Smoke Test P1 ===");
  const { baseUrl, close } = await startTestServer();

  try {
    // 1. GET /pricing (Publik)
    const rPricing = await request(baseUrl, "/pricing");
    check("GET /pricing status 200", rPricing.status === 200);
    check(
      "GET /pricing struktur valid",
      typeof rPricing.body?.ticketPricePerPerson === "number" &&
        typeof rPricing.body?.capacity === "number" &&
        Array.isArray(rPricing.body?.parking) &&
        rPricing.body?.parking.length === 4
    );

    // 2. GET /booking-slots (Publik)
    const rSlots = await request(baseUrl, "/booking-slots");
    check("GET /booking-slots status 200", rSlots.status === 200);
    check(
      "GET /booking-slots 8 slot 1 jam",
      Array.isArray(rSlots.body) && rSlots.body.length === 8 && rSlots.body[0]?.id === "08-09"
    );

    // 3. Login petugas dan admin
    const { cookie: petugasCookie } = await loginAs(baseUrl, "petugas");
    const { cookie: adminCookie } = await loginAs(baseUrl, "admin");

    // 4. Petugas PUT /admin/pricing -> 403
    const rPetugasPut = await request(baseUrl, "/admin/pricing", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Cookie: petugasCookie,
      },
      body: JSON.stringify({
        ticketPricePerPerson: 7000,
        capacity: 400,
        parking: { none: 0, motor: 4000, mobil: 12000, bus: 25000 },
      }),
    });
    check("Petugas PUT /admin/pricing 403", rPetugasPut.status === 403);

    // 5. Input tak valid PUT /admin/pricing -> 400 VALIDATION
    const rInvalidPut = await request(baseUrl, "/admin/pricing", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Cookie: adminCookie,
      },
      body: JSON.stringify({
        ticketPricePerPerson: 100, // di bawah minimum 500
        capacity: 0,
        parking: { none: 1000, motor: 3000, mobil: 10000, bus: 20000 }, // none harus 0
      }),
    });
    check("Input tak valid PUT /admin/pricing 400", rInvalidPut.status === 400);
    check("Galat VALIDATION", rInvalidPut.body?.error === "VALIDATION");

    // 6. Admin ubah harga, baca ulang, lalu kembalikan ke semula
    const rAdminGetInitial = await request(baseUrl, "/admin/pricing", {
      headers: { Cookie: adminCookie },
    });
    check("Admin GET /admin/pricing 200", rAdminGetInitial.status === 200);
    const initialPricing = rAdminGetInitial.body;

    const modifiedPricing = {
      ticketPricePerPerson: 6000,
      capacity: 350,
      parking: { none: 0, motor: 4000, mobil: 12000, bus: 25000 },
    };

    const rAdminPut = await request(baseUrl, "/admin/pricing", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Cookie: adminCookie,
      },
      body: JSON.stringify(modifiedPricing),
    });
    check("Admin PUT /admin/pricing berhasil 200", rAdminPut.status === 200);

    // Verifikasi harga berubah
    const rVerifyPublic = await request(baseUrl, "/pricing");
    check("Harga tiket berubah jadi 6000", rVerifyPublic.body?.ticketPricePerPerson === 6000);

    // Kembalikan ke semula
    await request(baseUrl, "/admin/pricing", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Cookie: adminCookie,
      },
      body: JSON.stringify(initialPricing),
    });
    const rReverted = await request(baseUrl, "/pricing");
    check(
      "Harga berhasil dikembalikan ke semula",
      rReverted.body?.ticketPricePerPerson === initialPricing.ticketPricePerPerson
    );

    // 7. Test atomic counter: 20 panggilan paralel nextSeq
    console.log("  Menguji nextSeq paralel 20x...");
    const seqKey = "smoke-seq";
    try {
      const promises = Array.from({ length: 20 }, () => nextSeq(seqKey, 100));
      const results = await Promise.all(promises);
      const uniqueResults = new Set(results);
      check("20 hasil nomor unik berurutan", uniqueResults.size === 20);
      const sorted = [...results].sort((a, b) => a - b);
      check("Nomor pertama adalah initial (100)", sorted[0] === 100);
      check("Nomor terakhir adalah 119", sorted[19] === 119);
    } finally {
      // Bersihkan data smoke di database
      await db.counter.deleteMany({ where: { key: seqKey } });
    }

    console.log("=== Seluruh Pemeriksaan P1 LULUS ===");
  } finally {
    await close();
  }
}

run().catch((err) => {
  console.error("Smoke test P1 gagal:", err);
  process.exit(1);
});
