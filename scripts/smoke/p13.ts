/**
 * Smoke test P13 — CORS menerima daftar origin (ADMIN_ORIGIN dipisah koma).
 *
 * Environment diatur sebelum memuat app agar konfigurasi CORS memakai
 * daftar origin uji, termasuk entri dengan garis miring di akhir.
 */
async function run() {
  process.env.ADMIN_ORIGIN = "https://admin.contoh.com, https://app.contoh.com/";

  const { startTestServer, request, check } = await import("./_helpers.js");

  console.log("=== Menjalankan Smoke Test P13 (CORS daftar origin) ===");
  const { baseUrl, close } = await startTestServer();

  try {
    // 1. Preflight untuk origin pertama (ADMIN_ORIGIN)
    const rPreflight = await request(baseUrl, "/health", {
      method: "OPTIONS",
      headers: {
        Origin: "https://admin.contoh.com",
        "Access-Control-Request-Method": "GET",
      },
    });
    check(
      "Preflight origin pertama diizinkan",
      rPreflight.headers.get("access-control-allow-origin") === "https://admin.contoh.com",
      `ACAO=${rPreflight.headers.get("access-control-allow-origin")}`
    );
    check(
      "Preflight mengaktifkan credentials untuk origin terdaftar",
      rPreflight.headers.get("access-control-allow-credentials") === "true"
    );

    // 2. Respons biasa untuk origin kedua (entri dengan garis miring di akhir)
    const rSecond = await request(baseUrl, "/health", {
      headers: { Origin: "https://app.contoh.com" },
    });
    check("Respons biasa origin kedua status 200", rSecond.status === 200);
    check(
      "Origin kedua (ternormalisasi) diizinkan",
      rSecond.headers.get("access-control-allow-origin") === "https://app.contoh.com",
      `ACAO=${rSecond.headers.get("access-control-allow-origin")}`
    );

    // 3. Origin di luar daftar ditolak tanpa error 500
    const rOther = await request(baseUrl, "/health", {
      headers: { Origin: "https://evil.contoh.com" },
    });
    check("Origin lain tetap mendapat respons 200", rOther.status === 200);
    check(
      "Origin lain tidak mendapat Access-Control-Allow-Origin",
      rOther.headers.get("access-control-allow-origin") === null
    );

    // 4. Tanpa header Origin (Postman/mobile/server-ke-server) tetap diizinkan
    const rNoOrigin = await request(baseUrl, "/health");
    check("Permintaan tanpa Origin status 200", rNoOrigin.status === 200);

    // 5. localhost tetap diizinkan saat bukan produksi
    const rLocalhost = await request(baseUrl, "/health", {
      headers: { Origin: "http://localhost:5173" },
    });
    check(
      "localhost diizinkan saat development",
      rLocalhost.headers.get("access-control-allow-origin") === "http://localhost:5173"
    );

    console.log("=== Seluruh Pemeriksaan P13 LULUS ===");
  } finally {
    await close();
  }
}

run().catch((err) => {
  console.error("Smoke test P13 gagal:", err);
  process.exit(1);
});
