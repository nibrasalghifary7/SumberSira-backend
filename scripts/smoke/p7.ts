import { startTestServer, request, loginAs, check } from "./_helpers.js";
import { db } from "../../src/lib/db.js";

async function run() {
  console.log("=== Menjalankan Smoke Test P7 ===");
  const { baseUrl, close } = await startTestServer();

  try {
    const { cookie: adminCookie } = await loginAs(baseUrl, "admin");
    const { cookie: petugasCookie } = await loginAs(baseUrl, "petugas");

    // 1. GET /chat/quick-questions
    const rQuick = await request(baseUrl, "/chat/quick-questions");
    check("GET /chat/quick-questions status 200", rQuick.status === 200);
    check("Quick questions berupa array 4 item", Array.isArray(rQuick.body) && rQuick.body.length >= 4);

    // 2. Uji pertanyaan yang cocok dengan FAQ
    const rJamBuka = await request(baseUrl, "/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Permisi, jam buka nya jam berapa?" }),
    });
    check("Pertanyaan 'jam buka' cocok", rJamBuka.status === 200 && rJamBuka.body?.matched === true);
    check("Jawaban jam buka benar", rJamBuka.body?.answer?.includes("Weekday buka"));

    const rSewaAtv = await request(baseUrl, "/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Cara sewa ATV bagaimana?" }),
    });
    check("Pertanyaan 'sewa ATV' cocok", rSewaAtv.status === 200 && rSewaAtv.body?.matched === true);
    check("Jawaban sewa ATV benar", rSewaAtv.body?.answer?.includes("Buka Tiket & Booking"));

    const rHargaTiket = await request(baseUrl, "/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Harga tiket masuk berapa ya?" }),
    });
    check("Pertanyaan 'harga tiket' cocok", rHargaTiket.status === 200 && rHargaTiket.body?.matched === true);
    check("Jawaban harga tiket benar", rHargaTiket.body?.answer?.includes("Rp5.000"));

    const rParkirBus = await request(baseUrl, "/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Apakah bisa parkir bus?" }),
    });
    check("Pertanyaan 'parkir bus' cocok", rParkirBus.status === 200 && rParkirBus.body?.matched === true);
    check("Jawaban parkir bus benar", rParkirBus.body?.answer?.includes("20rb"));

    // 3. Pesan tak dikenal tercatat di UnansweredQuestion
    const unknownQuestion = "[SMOKE] Apakah ada promo tanggal kembar?";
    const rUnknown = await request(baseUrl, "/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: unknownQuestion }),
    });
    check("Pesan tak dikenal matched = false", rUnknown.status === 200 && rUnknown.body?.matched === false);
    check("Pesan fallback default admin", rUnknown.body?.answer?.includes("dicatat untuk admin"));

    // Verifikasi tercatat di database & dapat dibaca admin di /admin/faq/unanswered
    const rAdminUnanswered = await request(baseUrl, "/admin/faq/unanswered", {
      headers: { Cookie: adminCookie },
    });
    check("Admin GET /admin/faq/unanswered 200", rAdminUnanswered.status === 200);
    const recorded = rAdminUnanswered.body.find((q: any) => q.question === unknownQuestion);
    check("Pertanyaan tak dikenal tersimpan", recorded !== undefined);

    // Hapus unanswered question oleh admin
    if (recorded) {
      const rDeleteUnanswered = await request(baseUrl, `/admin/faq/unanswered/${recorded.id}`, {
        method: "DELETE",
        headers: { Cookie: adminCookie },
      });
      check("Admin DELETE /admin/faq/unanswered/:id 200", rDeleteUnanswered.status === 200);
    }

    // 4. Hak akses Petugas vs Admin pada /admin/faq -> 403
    const rPetugasFaq = await request(baseUrl, "/admin/faq", {
      headers: { Cookie: petugasCookie },
    });
    check("Petugas akses /admin/faq ditolak 403", rPetugasFaq.status === 403);

    // 5. Admin CRUD FAQ
    const rAdminCreateFaq = await request(baseUrl, "/admin/faq", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({
        keys: ["[smoke-key]"],
        answer: "Jawaban smoke test",
        sortOrder: 999,
        active: true,
      }),
    });
    check("Admin POST /admin/faq 201", rAdminCreateFaq.status === 201);
    const createdFaqId = rAdminCreateFaq.body.id;

    // PATCH FAQ
    const rAdminPatchFaq = await request(baseUrl, `/admin/faq/${createdFaqId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({
        answer: "Jawaban smoke test diupdate",
      }),
    });
    check("Admin PATCH /admin/faq/:id 200", rAdminPatchFaq.status === 200 && rAdminPatchFaq.body?.answer === "Jawaban smoke test diupdate");

    // DELETE FAQ
    const rAdminDeleteFaq = await request(baseUrl, `/admin/faq/${createdFaqId}`, {
      method: "DELETE",
      headers: { Cookie: adminCookie },
    });
    check("Admin DELETE /admin/faq/:id 200", rAdminDeleteFaq.status === 200);

    console.log("=== Seluruh Pemeriksaan P7 LULUS ===");
  } finally {
    await db.unansweredQuestion.deleteMany({
      where: { question: { startsWith: "[SMOKE]" } },
    });
    await db.faq.deleteMany({
      where: { answer: { contains: "smoke test" } },
    });
    await close();
  }
}

run().catch((err) => {
  console.error("Smoke test P7 gagal:", err);
  process.exit(1);
});
