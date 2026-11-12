import { startTestServer, request, loginAs, check } from "./_helpers.js";
import { db } from "../../src/lib/db.js";

async function run() {
  console.log("=== Menjalankan Smoke Test P10 ===");
  const { baseUrl, close } = await startTestServer();

  // Ulasan [SMOKE] dengan sebaran bintang yang diketahui
  const smokeReviews = [
    { name: "[SMOKE] A", stars: 5, text: "Bagus" },
    { name: "[SMOKE] B", stars: 5, text: "Mantap" },
    { name: "[SMOKE] C", stars: 4, text: "Oke" },
    { name: "[SMOKE] D", stars: 3, text: "Cukup" },
    { name: "[SMOKE] E", stars: 1, text: "Kurang" },
    { name: "[SMOKE] F", stars: 2, text: "Biasa" },
  ];

  try {
    const { cookie: adminCookie } = await loginAs(baseUrl, "admin");
    const { cookie: petugasCookie } = await loginAs(baseUrl, "petugas");

    // 1. Akses: tanpa cookie 401, petugas 403
    const rNoAuth = await request(baseUrl, "/admin/insight");
    check("Tanpa cookie ditolak 401", rNoAuth.status === 401, `dapat ${rNoAuth.status}`);
    const rPetugas = await request(baseUrl, "/admin/insight", {
      headers: { Cookie: petugasCookie },
    });
    check("Petugas ditolak 403", rPetugas.status === 403, `dapat ${rPetugas.status}`);

    // 2. Kondisi awal: bentuk respons
    const rBefore = await request(baseUrl, "/admin/insight", {
      headers: { Cookie: adminCookie },
    });
    check("Admin GET /admin/insight 200", rBefore.status === 200, `dapat ${rBefore.status}`);
    check("rating berupa angka", typeof rBefore.body?.rating === "number");
    check("reviewCount berupa angka", typeof rBefore.body?.reviewCount === "number");
    check("distribution punya kunci 1..5",
      ["1", "2", "3", "4", "5"].every((k) => typeof rBefore.body?.distribution?.[k] === "number"));
    check("crowd berisi inside/percent/label",
      typeof rBefore.body?.crowd?.inside === "number" &&
      typeof rBefore.body?.crowd?.percent === "number" &&
      typeof rBefore.body?.crowd?.label === "string");
    check("peakHour jam terpadat HOURLY_FORECAST", rBefore.body?.peakHour === "12");
    check("suggestions array tidak kosong",
      Array.isArray(rBefore.body?.suggestions) && rBefore.body.suggestions.length >= 1);
    check("suggestions maksimal 5", rBefore.body.suggestions.length <= 5);

    // 3. Tambah ulasan [SMOKE] lalu bandingkan distribusi dan rating dengan perhitungan database
    await db.review.createMany({ data: smokeReviews });

    const allStars = await db.review.findMany({
      where: { stars: { in: [1, 2, 3, 4, 5] } },
      select: { stars: true },
    });
    const expectedDistribution = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 } as Record<string, number>;
    let starSum = 0;
    for (const r of allStars) {
      expectedDistribution[String(r.stars)] += 1;
      starSum += r.stars;
    }
    const expectedCount = allStars.length;
    const expectedRating = expectedCount > 0 ? Math.round((starSum / expectedCount) * 10) / 10 : 0;

    const rAfter = await request(baseUrl, "/admin/insight", {
      headers: { Cookie: adminCookie },
    });
    check("Distribusi sesuai data uji",
      ["1", "2", "3", "4", "5"].every((k) => rAfter.body?.distribution?.[k] === expectedDistribution[k]),
      JSON.stringify({ got: rAfter.body?.distribution, expected: expectedDistribution }));
    check("reviewCount sesuai", rAfter.body?.reviewCount === expectedCount,
      `dapat ${rAfter.body?.reviewCount}, harap ${expectedCount}`);
    check("rating 1 desimal sesuai", rAfter.body?.rating === expectedRating,
      `dapat ${rAfter.body?.rating}, harap ${expectedRating}`);

    // 4. Aturan peringatan: ada ulasan bintang 1-2 dalam 7 hari terakhir (baru dibuat)
    const hasLowStarWarning = rAfter.body.suggestions.some((s: string) => s.includes("bintang 1-2"));
    check("Saran memuat peringatan bintang 1-2", hasLowStarWarning);

    // 5. Aturan rating di bawah 4,0 (karena data uji menurunkan rata-rata)
    if (expectedRating < 4.0) {
      const hasRatingTip = rAfter.body.suggestions.some((s: string) => s.includes("di bawah 4,0"));
      check("Saran memuat imbauan rating di bawah 4,0", hasRatingTip);
    }

    console.log("=== Seluruh Pemeriksaan P10 LULUS ===");
  } finally {
    await db.review.deleteMany({
      where: { name: { startsWith: "[SMOKE]" } },
    });
    await close();
  }
}

run().catch((err) => {
  console.error("Smoke test P10 gagal:", err);
  process.exit(1);
});
