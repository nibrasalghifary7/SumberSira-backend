import { startTestServer, request, loginAs, check } from "./_helpers.js";
import { db } from "../../src/config/database.js";
import { config } from "../../src/config/index.js";
import { setAiClientForTests, type AiClient } from "../../src/services/ai/client.js";
import { batasChat, buatPengetahuan, susunPesan } from "../../src/services/ai/chatbot.js";

// P16: chatbot AI Tanya Sira. Jalur AI diuji dengan klien AI tiruan (tanpa kunci, tanpa memakai kuota gratis): yang diperiksa
// adalah apa yang dikirim ke AI (data resmi, aturan, riwayat), bagaimana balasannya diolah, dan cadangan bila AI gagal.

type Panggilan = { system: string; messages: Array<{ role: string; content: string }>; model: string };

// balasan() mengembalikan teks mentah seperti yang dikirim model (biasanya JSON).
function klienTiruan(balasan: () => string) {
  const panggilan: Panggilan[] = [];
  const klien: AiClient = {
    chat: async (req) => {
      const [sistem, ...sisa] = req.messages;
      panggilan.push({ system: String(sistem.content), messages: sisa as Panggilan["messages"], model: req.model });
      return balasan();
    },
  };
  return { klien, panggilan };
}

const jawab = (terjawab: boolean, jawaban: string) => JSON.stringify({ terjawab, jawaban });

const json = (cookie: string, method: string, body?: unknown) => ({
  method,
  headers: { "Content-Type": "application/json", Cookie: cookie },
  body: body === undefined ? undefined : JSON.stringify(body),
});

async function run() {
  console.log("=== Menjalankan Smoke Test P16 (chatbot AI) ===");
  const { baseUrl, close } = await startTestServer();
  const dibuat = { faq: [] as string[] };
  const tombolAwal = await db.setting.findUnique({ where: { key: "quickQuestions" } });
  const batasAwal = config.CHAT_AI_DAILY_LIMIT;

  try {
    const { cookie: admin } = await loginAs(baseUrl, "admin");
    const { cookie: petugas } = await loginAs(baseUrl, "petugas");

    // FAQ uji
    const faq = await request(baseUrl, "/admin/faq", json(admin, "POST", { keys: ["smokeunik"], answer: "Jawaban resmi uji [SMOKE]: tiket murah.", sortOrder: 999 }));
    check("Admin membuat FAQ uji 201", faq.status === 201);
    dibuat.faq.push(faq.body.id);

    // ---- Tombol jawaban cepat: admin bisa atur ----
    const awal = await request(baseUrl, "/admin/faq/quick-questions", { headers: { Cookie: admin } });
    check("Admin GET tombol cepat 200 berisi daftar", awal.status === 200 && Array.isArray(awal.body.questions) && awal.body.questions.length >= 1);
    check("Tombol cepat tanpa login 401", (await request(baseUrl, "/admin/faq/quick-questions")).status === 401);
    check("Petugas atur tombol cepat 403", (await request(baseUrl, "/admin/faq/quick-questions", json(petugas, "PUT", { questions: ["Halo?"] }))).status === 403);
    check("Daftar kosong ditolak 400", (await request(baseUrl, "/admin/faq/quick-questions", json(admin, "PUT", { questions: [] }))).status === 400);
    check("Lebih dari 6 tombol ditolak 400", (await request(baseUrl, "/admin/faq/quick-questions", json(admin, "PUT", { questions: ["a1", "b2", "c3", "d4", "e5", "f6", "g7"] }))).status === 400);
    const simpan = await request(baseUrl, "/admin/faq/quick-questions", json(admin, "PUT", { questions: ["smokeunik", "Jam buka?", "SMOKEUNIK"] }));
    check("Admin simpan tombol cepat 200, duplikat dibuang", simpan.status === 200 && simpan.body.questions.length === 2);
    const publik = await request(baseUrl, "/chat/quick-questions");
    check("Tombol cepat publik mengikuti pengaturan admin", publik.status === 200 && publik.body[0] === "smokeunik");

    // ---- Tanpa AI (tidak ada klien): cadangan kata kunci FAQ ----
    setAiClientForTests(null);
    const tanpaKunci = !config.AI_API_KEY;
    if (tanpaKunci) {
      const st = await request(baseUrl, "/admin/faq/ai-status", { headers: { Cookie: admin } });
      check("Status AI: nonaktif tanpa kunci", st.status === 200 && st.body.enabled === false);
      const cocok = await request(baseUrl, "/chat", json("", "POST", { message: "zzsmokeunikzz" }));
      check("Tanpa AI, kata kunci FAQ tetap menjawab", cocok.body.matched === true && cocok.body.source === "faq" && String(cocok.body.answer).includes("[SMOKE]"), JSON.stringify(cocok.body));
      const tak = await request(baseUrl, "/chat", json("", "POST", { message: "[SMOKE] qwxzv plmkj" }));
      check("Tanpa AI, pertanyaan tak dikenal dijawab jujur dan dicatat", tak.body.matched === false && (await db.unansweredQuestion.count({ where: { question: "[SMOKE] qwxzv plmkj" } })) === 1);
    }

    // ---- Dengan AI tiruan ----
    config.CHAT_AI_DAILY_LIMIT = 3;
    const awalTerpakai = batasChat.terpakai();

    // Tombol cepat dijawab langsung dari FAQ, AI tidak dipanggil
    const t1 = klienTiruan(() => jawab(true, "tidak boleh dipakai"));
    setAiClientForTests(t1.klien);
    const dariTombol = await request(baseUrl, "/chat", json("", "POST", { message: "smokeunik" }));
    check("Tombol cepat dijawab FAQ admin tanpa memanggil AI", dariTombol.body.source === "faq" && String(dariTombol.body.answer).includes("[SMOKE]") && t1.panggilan.length === 0);

    // Pertanyaan bebas dijawab AI dan diberi data resmi
    const t2 = klienTiruan(() => jawab(true, "Tiket Rp5.000 per orang ya."));
    setAiClientForTests(t2.klien);
    const bebas = await request(baseUrl, "/chat", json("", "POST", {
      message: "kalau berdua pakai motor jadinya berapa?",
      history: [{ role: "assistant", text: "Halo!" }, { role: "user", text: "harga tiket?" }, { role: "assistant", text: "Rp5.000" }],
    }));
    check("Pertanyaan bebas dijawab AI", bebas.status === 200 && bebas.body.source === "ai" && bebas.body.matched === true && bebas.body.answer.includes("Rp5.000"));
    const p = t2.panggilan[0];
    check("Model sesuai konfigurasi", p.model === config.CHAT_MODEL);
    check("Prompt meminta balasan JSON terjawab dan jawaban", p.system.includes('"terjawab"') && p.system.includes('"jawaban"'));
    check("Prompt memuat aturan anti-mengarang", p.system.includes("HANYA dari bagian DATA RESMI") && p.system.includes("terjawab=false"));
    check("Data resmi memuat harga tiket dan parkir", p.system.includes("Tiket masuk: Rp") && p.system.includes("Parkir: motor Rp"));
    check("Data resmi memuat FAQ admin", p.system.includes("smokeunik") && p.system.includes("[SMOKE]"));
    check("Data resmi memuat wahana dan keramaian", p.system.includes("Sewa alat dan wahana") && p.system.includes("Keramaian sekarang:"));
    check("Teks pengunjung hanya di pesan, bukan di prompt sistem", !p.system.includes("berdua pakai motor") && p.messages[p.messages.length - 1].content.includes("berdua pakai motor"));
    check("Riwayat dimulai dari pengunjung dan berselang-seling", p.messages[0].role === "user" && p.messages.every((m, i) => i === 0 || m.role !== p.messages[i - 1].role));

    // AI bilang tidak tahu: dicatat untuk admin
    const t3 = klienTiruan(() => jawab(false, "Aku belum punya infonya, sudah dicatat untuk pengelola ya."));
    setAiClientForTests(t3.klien);
    const tidakTahu = await request(baseUrl, "/chat", json("", "POST", { message: "[SMOKE] ada diskon pelajar?" }));
    check("AI tidak tahu: matched false dan dicatat ke admin", tidakTahu.body.matched === false && tidakTahu.body.source === "ai" && (await db.unansweredQuestion.count({ where: { question: "[SMOKE] ada diskon pelajar?" } })) === 1);

    // Jatah harian: setelah habis, beralih ke cadangan
    const t4 = klienTiruan(() => jawab(true, "x"));
    setAiClientForTests(t4.klien);
    config.CHAT_AI_DAILY_LIMIT = batasChat.terpakai();
    const lewat = await request(baseUrl, "/chat", json("", "POST", { message: "zzsmokeunikzz" }));
    check("Jatah AI habis: cadangan FAQ dipakai, AI tidak dipanggil", lewat.body.source === "faq" && t4.panggilan.length === 0);
    config.CHAT_AI_DAILY_LIMIT = batasAwal;

    // Galat dari penyedia AI tidak membuat 500
    const rusak: AiClient = { chat: async () => { throw new Error("jaringan putus"); } };
    setAiClientForTests(rusak);
    const jatahSebelum = batasChat.terpakai();
    const galat = await request(baseUrl, "/chat", json("", "POST", { message: "zzsmokeunikzz" }));
    check("AI galat: tetap 200 dengan cadangan FAQ", galat.status === 200 && galat.body.source === "faq");
    check("Jatah dikembalikan saat panggilan gagal", batasChat.terpakai() === jatahSebelum);

    // Balasan bukan JSON (model menolak atau melantur), JSON tanpa kolom wajib, atau jawaban kosong: cadangan, tidak ditebak
    const bukanJson = klienTiruan(() => "Maaf, saya tidak bisa membantu soal itu.");
    setAiClientForTests(bukanJson.klien);
    const ditolak = await request(baseUrl, "/chat", json("", "POST", { message: "zzsmokeunikzz" }));
    check("Balasan bukan JSON: cadangan FAQ", ditolak.status === 200 && ditolak.body.source === "faq" && bukanJson.panggilan.length === 1);
    const takLengkap = klienTiruan(() => JSON.stringify({ jawaban: "tanpa kolom terjawab" }));
    setAiClientForTests(takLengkap.klien);
    const t5 = await request(baseUrl, "/chat", json("", "POST", { message: "zzsmokeunikzz" }));
    check("JSON tanpa kolom terjawab: cadangan FAQ", t5.status === 200 && t5.body.source === "faq");
    const jawabanKosong = klienTiruan(() => jawab(true, "   "));
    setAiClientForTests(jawabanKosong.klien);
    const t6 = await request(baseUrl, "/chat", json("", "POST", { message: "zzsmokeunikzz" }));
    check("Jawaban kosong: cadangan FAQ", t6.status === 200 && t6.body.source === "faq");

    // Model sering membungkus JSON dengan pagar kode atau menulis true sebagai teks: tetap terbaca
    const berpagar = klienTiruan(() => 'Tentu!\n```json\n{"terjawab": "true", "jawaban": "Buka pukul 08.00."}\n```');
    setAiClientForTests(berpagar.klien);
    const t7 = await request(baseUrl, "/chat", json("", "POST", { message: "[SMOKE] kapan buka?" }));
    check("JSON berpagar kode dan true sebagai teks tetap terbaca", t7.body.source === "ai" && t7.body.matched === true && t7.body.answer === "Buka pukul 08.00.", JSON.stringify(t7.body));

    // Status AI untuk admin
    const st2 = await request(baseUrl, "/admin/faq/ai-status", { headers: { Cookie: admin } });
    check("Status AI aktif saat klien tersedia", st2.status === 200 && st2.body.enabled === true && typeof st2.body.usedToday === "number");
    check("Status AI tidak bocorkan kunci", !JSON.stringify(st2.body).includes("sk-"));

    // ---- Unit: pengetahuan dan penyusunan pesan ----
    const pengetahuan = await buatPengetahuan();
    check("Pengetahuan tidak memuat rahasia (kunci, hash, sesi)", !/API_KEY|passwordHash|tokenHash|DATABASE_URL/i.test(pengetahuan));
    const pesan = susunPesan([{ role: "assistant", text: "pembuka" }, { role: "user", text: "a" }, { role: "user", text: "b" }, { role: "assistant", text: "c" }], "d");
    check("Pesan: pembuka asisten dibuang, peran sama digabung, berakhir di pengunjung", pesan[0].role === "user" && pesan[0].content === "a\nb" && pesan[pesan.length - 1].role === "user");

    console.log("=== Seluruh Pemeriksaan P16 LULUS ===");
    void awalTerpakai;
  } finally {
    setAiClientForTests(null);
    config.CHAT_AI_DAILY_LIMIT = batasAwal;
    for (const id of dibuat.faq) await db.faq.delete({ where: { id } }).catch(() => {});
    await db.unansweredQuestion.deleteMany({ where: { question: { startsWith: "[SMOKE]" } } });
    if (tombolAwal) await db.setting.update({ where: { key: "quickQuestions" }, data: { value: tombolAwal.value as any } });
    else await db.setting.deleteMany({ where: { key: "quickQuestions" } });
    await close();
  }
}

run().catch((err) => {
  console.error("Smoke test P16 gagal:", err);
  process.exit(1);
});
