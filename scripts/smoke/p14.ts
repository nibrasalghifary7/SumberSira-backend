/**
 * Smoke test P14 — JSON rusak/terlalu besar dibalas 4xx VALIDATION, bukan 500.
 */
import { startTestServer, request, check } from "./_helpers.js";

async function run() {
  console.log("=== Menjalankan Smoke Test P14 (galat body parser) ===");
  const { baseUrl, close } = await startTestServer();

  const originalError = console.error;
  const errorLogs: string[] = [];
  console.error = (...args: unknown[]) => {
    errorLogs.push(args.map((a) => String(a)).join(" "));
  };

  try {
    // 1. Body "null" (klien mengirim JSON.stringify(null)) → 400 VALIDATION
    const rNull = await request(baseUrl, "/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "null",
    });
    check("Body 'null' dibalas 400", rNull.status === 400, `status ${rNull.status}`);
    check("Body 'null' error VALIDATION", rNull.body?.error === "VALIDATION");
    check(
      "Respons body 'null' tidak membocorkan detail parser",
      Object.keys(rNull.body ?? {})
        .filter((k) => k !== "requestId")
        .join(",") === "error"
    );

    // 2. Body bukan JSON sama sekali → 400 VALIDATION
    const rBroken = await request(baseUrl, "/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{bukan json",
    });
    check("Body JSON rusak dibalas 400", rBroken.status === 400);
    check("Body JSON rusak error VALIDATION", rBroken.body?.error === "VALIDATION");

    // 3. Body terlalu besar (>100kb) → 413 VALIDATION
    const bigBody = JSON.stringify({ message: "a".repeat(150 * 1024) });
    const rBig = await request(baseUrl, "/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: bigBody,
    });
    check("Body terlalu besar dibalas 413", rBig.status === 413, `status ${rBig.status}`);
    check("Body terlalu besar error VALIDATION", rBig.body?.error === "VALIDATION");

    // 4. JSON valid tetapi isian salah tetap 400 VALIDATION (perilaku lama)
    const rInvalid = await request(baseUrl, "/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "" }),
    });
    check("JSON valid dengan isian salah tetap 400", rInvalid.status === 400);
    check("JSON valid dengan isian salah error VALIDATION", rInvalid.body?.error === "VALIDATION");

    // 5. Tidak ada galat klien yang di-log sebagai Internal Server Error
    check(
      "Tidak ada log 'Internal Server Error' untuk galat klien",
      !errorLogs.some((line) => line.includes("Internal Server Error")),
      errorLogs.join(" | ")
    );

    console.log("=== Seluruh Pemeriksaan P14 LULUS ===");
  } finally {
    console.error = originalError;
    await close();
  }
}

run().catch((err) => {
  console.error("Smoke test P14 gagal:", err);
  process.exit(1);
});
