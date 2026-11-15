import { startTestServer, request, loginAs, check } from "./_helpers.js";

async function run() {
  console.log("=== Menjalankan Smoke Test P0 ===");
  const { baseUrl, close } = await startTestServer();

  try {
    // 1. GET /
    const rRoot = await request(baseUrl, "/");
    check("GET / status 200", rRoot.status === 200);
    check("GET / body ok", rRoot.body?.status === "ok" && rRoot.body?.name === "SumberSira API");

    // 2. GET /health
    const rHealth = await request(baseUrl, "/health");
    check("GET /health status 200", rHealth.status === 200 && rHealth.body?.ok === true);

    // 3. GET /health/db
    const rHealthDb = await request(baseUrl, "/health/db");
    check("GET /health/db status 200", rHealthDb.status === 200 && typeof rHealthDb.body?.rides === "number");

    // 4. GET /rides (8 item atau lebih)
    const rRides = await request(baseUrl, "/rides");
    check("GET /rides status 200", rRides.status === 200);
    check("GET /rides >= 8 item", Array.isArray(rRides.body) && rRides.body.length >= 8);

    // 5. GET /time-slots (4 slot)
    const rSlots = await request(baseUrl, "/time-slots");
    check("GET /time-slots status 200", rSlots.status === 200);
    check("GET /time-slots == 4 slot", Array.isArray(rSlots.body) && rSlots.body.length === 4);

    // 6. Rute tak dikenal mengembalikan 404 JSON
    const rNotFound = await request(baseUrl, "/rute-acak-tak-dikenal");
    check("Rute tak dikenal 404", rNotFound.status === 404);
    check("Rute tak dikenal error NOT_FOUND", rNotFound.body?.error === "NOT_FOUND");

    // 7. Login admin berhasil
    const { cookie: adminCookie } = await loginAs(baseUrl, "admin");
    check("Login admin mendapat cookie", adminCookie.includes("ss_admin_session"));

    // 8. GET /auth/me berhasil dengan cookie admin
    const rMe = await request(baseUrl, "/auth/me", {
      headers: { Cookie: adminCookie },
    });
    check("GET /auth/me status 200", rMe.status === 200);
    check("GET /auth/me mengembalikan user admin", rMe.body?.role === "admin" && typeof rMe.body?.sessionId === "string");

    // 9. GET /admin/rides tanpa cookie mengembalikan 401
    const rAdminRidesNoAuth = await request(baseUrl, "/admin/rides");
    check("GET /admin/rides tanpa cookie 401", rAdminRidesNoAuth.status === 401);

    // 10. Login 6 kali berturut-turut dengan password salah menghasilkan 429
    console.log("  Menguji rate limiter login (5 gagal max)...");
    const testEmail = "test-ratelimit@sumbersira.id";
    let lastStatus = 0;
    for (let i = 0; i < 6; i++) {
      const r = await request(baseUrl, "/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: testEmail, password: "salah" }),
      });
      lastStatus = r.status;
    }
    check("Login ke-6 dengan password salah menghasilkan 429", lastStatus === 429);

    console.log("=== Seluruh Pemeriksaan P0 LULUS ===");
  } finally {
    await close();
  }
}

run().catch((err) => {
  console.error("Smoke test P0 gagal:", err);
  process.exit(1);
});
