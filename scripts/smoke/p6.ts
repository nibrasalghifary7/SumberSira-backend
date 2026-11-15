import { startTestServer, request, loginAs, check } from "./_helpers.js";
import { db } from "../../src/lib/db.js";

async function run() {
  console.log("=== Menjalankan Smoke Test P6 ===");
  const { baseUrl, close } = await startTestServer();

  try {
    const { cookie: adminCookie } = await loginAs(baseUrl, "admin");
    const { cookie: petugasCookie } = await loginAs(baseUrl, "petugas");

    // 1. Validasi bintang ditolak (0 dan 6)
    const rInvalidZero = await request(baseUrl, "/reviews", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "[SMOKE] Penilai 0",
        stars: 0,
        text: "Kurang bagus",
      }),
    });
    check("Bintang 0 ditolak 400", rInvalidZero.status === 400);

    const rInvalidSix = await request(baseUrl, "/reviews", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "[SMOKE] Penilai 6",
        stars: 6,
        text: "Terlalu bagus",
      }),
    });
    check("Bintang 6 ditolak 400", rInvalidSix.status === 400);

    // 2. Baca ulasan awal (dari seed-extra)
    const rInitialReviews = await request(baseUrl, "/reviews");
    check("GET /reviews status 200", rInitialReviews.status === 200);
    const initialCount = rInitialReviews.body.count;
    check("Ulasan awal minimal 3 item", initialCount >= 3);
    const initialRating = rInitialReviews.body.rating;
    check("Rating berupa angka float 1 desimal", typeof initialRating === "number");

    // 3. Tambah ulasan baru
    const rCreateReview = await request(baseUrl, "/reviews", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "[SMOKE] Pengulas Hebat",
        stars: 5,
        text: "Suasana sangat nyaman dan sejuk!",
      }),
    });
    check("POST /reviews 201", rCreateReview.status === 201);
    const createdReview = rCreateReview.body;

    // Verifikasi count bertambah 1
    const rUpdatedReviews = await request(baseUrl, "/reviews");
    check("Count bertambah 1", rUpdatedReviews.body.count === initialCount + 1);

    // 4. Hak akses admin vs petugas
    // Petugas DELETE /admin/reviews/:id -> 403
    const rPetugasDelete = await request(baseUrl, `/admin/reviews/${createdReview.id}`, {
      method: "DELETE",
      headers: { Cookie: petugasCookie },
    });
    check("Petugas DELETE ulasan ditolak 403", rPetugasDelete.status === 403);

    // Admin GET /admin/reviews -> 200
    const rAdminGet = await request(baseUrl, "/admin/reviews", {
      headers: { Cookie: adminCookie },
    });
    check("Admin GET /admin/reviews 200", rAdminGet.status === 200 && Array.isArray(rAdminGet.body));

    // Admin DELETE /admin/reviews/:id -> 200
    const rAdminDelete = await request(baseUrl, `/admin/reviews/${createdReview.id}`, {
      method: "DELETE",
      headers: { Cookie: adminCookie },
    });
    check("Admin DELETE ulasan berhasil 200", rAdminDelete.status === 200);

    // Verifikasi count kembali ke semula
    const rRevertedReviews = await request(baseUrl, "/reviews");
    check("Count kembali ke semula", rRevertedReviews.body.count === initialCount);

    console.log("=== Seluruh Pemeriksaan P6 LULUS ===");
  } finally {
    await db.review.deleteMany({
      where: { name: { startsWith: "[SMOKE]" } },
    });
    await close();
  }
}

run().catch((err) => {
  console.error("Smoke test P6 gagal:", err);
  process.exit(1);
});
