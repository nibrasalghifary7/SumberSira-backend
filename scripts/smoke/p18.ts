import http from "node:http";
import type { AddressInfo } from "node:net";
import { startTestServer, request, check } from "./_helpers.js";
import { db } from "../../src/config/database.js";
import { config } from "../../src/config/index.js";
import { AiGalat, getAiClient, resetJedaUntukUji, setAiClientForTests, sisaJedaDetik, uraiJson } from "../../src/services/ai/client.js";
import { batasChat } from "../../src/services/ai/chatbot.js";
import { z } from "zod";

// P18: klien AI SUNGGUHAN (fetch ke penyedia gratis yang kompatibel dengan OpenAI), diuji terhadap server tiruan lokal yang
// meniru balasan Gemini. Diperiksa: bentuk permintaan (alamat, kunci, isi), pembacaan balasan, jeda otomatis saat kuota
// habis (429) atau kunci ditolak (401), dan jalur lengkap dari /chat sampai ke "penyedia AI" tanpa memakai kuota sungguhan.

interface Terima {
  path: string;
  method: string;
  auth: string | undefined;
  body: any;
}

// Server tiruan: nextReply menentukan balasan berikutnya. Semua permintaan yang masuk dicatat.
function mulaiServerAi() {
  const masuk: Terima[] = [];
  let balas: (n: number) => { status: number; body: unknown; headers?: Record<string, string> } = () => ({ status: 200, body: {} });
  const server = http.createServer((req, res) => {
    let data = "";
    req.on("data", (d) => (data += d));
    req.on("end", () => {
      masuk.push({ path: req.url ?? "", method: req.method ?? "", auth: req.headers.authorization, body: data ? JSON.parse(data) : null });
      const r = balas(masuk.length);
      res.writeHead(r.status, { "Content-Type": "application/json", ...(r.headers ?? {}) });
      res.end(JSON.stringify(r.body));
    });
  });
  return new Promise<{ url: string; masuk: Terima[]; atur: (f: typeof balas) => void; tutup: () => Promise<void> }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      resolve({
        url: `http://127.0.0.1:${port}/v1beta/openai`,
        masuk,
        atur: (f) => (balas = f),
        tutup: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

const gemini = (teks: string) => ({ status: 200, body: { choices: [{ index: 0, message: { role: "assistant", content: teks }, finish_reason: "stop" }] } });
const galatGoogle = (status: number, message: string, headers?: Record<string, string>) => ({ status, body: [{ error: { code: status, message, status: "X" } }], headers });

async function run() {
  console.log("=== Menjalankan Smoke Test P18 (klien AI sungguhan) ===");
  const ai = await mulaiServerAi();
  const awal = { kunci: config.AI_API_KEY, url: config.AI_BASE_URL, usaha: config.AI_REASONING_EFFORT, batas: config.CHAT_AI_DAILY_LIMIT };
  const { baseUrl, close } = await startTestServer();
  const dibuat: string[] = [];

  try {
    setAiClientForTests(null);
    resetJedaUntukUji();
    config.AI_API_KEY = "kunci-uji-rahasia";
    config.AI_BASE_URL = `${ai.url}/`; // garis miring di akhir sengaja, harus dirapikan
    config.AI_REASONING_EFFORT = "";
    const klien = getAiClient();
    check("Dengan kunci, klien sungguhan tersedia", klien !== null);

    // ---- Bentuk permintaan dan pembacaan balasan ----
    ai.atur(() => gemini('{"terjawab": true, "jawaban": "ok"}'));
    const teks = await klien!.chat({
      model: "gemini-uji",
      messages: [
        { role: "system", content: "aturan" },
        { role: "user", content: [{ type: "text", text: "lihat" }, { type: "image_url", image_url: { url: "data:image/jpeg;base64,AAAA" } }] },
      ],
    });
    const p = ai.masuk[0];
    check("Balasan dibaca dari choices[0].message.content", teks === '{"terjawab": true, "jawaban": "ok"}');
    check("Alamat: POST ke /chat/completions tanpa garis miring ganda", p.method === "POST" && p.path === "/v1beta/openai/chat/completions", `${p.method} ${p.path}`);
    check("Kunci dikirim sebagai Bearer di header", p.auth === "Bearer kunci-uji-rahasia");
    check("Isi: model dan pesan ikut, gambar sebagai image_url", p.body.model === "gemini-uji" && p.body.messages[1].content[1].image_url.url.startsWith("data:image/jpeg;base64,"));
    check("Isi minimal: tanpa temperature, max_tokens, reasoning_effort bila tidak diatur", !("temperature" in p.body) && !("max_tokens" in p.body) && !("reasoning_effort" in p.body));
    check("Kunci tidak ikut di badan permintaan", !JSON.stringify(p.body).includes("kunci-uji-rahasia"));

    config.AI_REASONING_EFFORT = "low";
    await klien!.chat({ model: "m", messages: [{ role: "user", content: "x" }] });
    check("reasoning_effort dikirim hanya bila diatur", ai.masuk[1].body.reasoning_effort === "low");
    config.AI_REASONING_EFFORT = "";

    // ---- Balasan kosong atau salah bentuk ----
    ai.atur(() => gemini("   "));
    const kosong = await klien!.chat({ model: "m", messages: [{ role: "user", content: "x" }] }).then(() => null, (e) => e);
    check("Balasan kosong melempar AiGalat", kosong instanceof AiGalat);
    ai.atur(() => ({ status: 200, body: { aneh: true } }));
    const aneh = await klien!.chat({ model: "m", messages: [{ role: "user", content: "x" }] }).then(() => null, (e) => e);
    check("Balasan tanpa choices melempar AiGalat", aneh instanceof AiGalat);

    // ---- Galat penyedia ----
    ai.atur(() => galatGoogle(400, "Model tidak dikenal"));
    const e400 = await klien!.chat({ model: "m", messages: [{ role: "user", content: "x" }] }).then(() => null, (e) => e);
    check("400 melempar AiGalat berisi alasan penyedia dan TANPA jeda", e400 instanceof AiGalat && e400.status === 400 && e400.message.includes("Model tidak dikenal") && sisaJedaDetik() === 0);
    check("Pesan galat tidak membocorkan kunci", !String(e400?.message).includes("kunci-uji-rahasia"));

    ai.atur(() => galatGoogle(500, "gangguan"));
    const e500 = await klien!.chat({ model: "m", messages: [{ role: "user", content: "x" }] }).then(() => null, (e) => e);
    check("500 melempar AiGalat tanpa jeda", e500 instanceof AiGalat && e500.status === 500 && sisaJedaDetik() === 0);

    // ---- Jeda otomatis saat kuota habis ----
    const sebelum = ai.masuk.length;
    ai.atur(() => galatGoogle(429, "Quota exceeded for metric: requests per minute", { "Retry-After": "2" }));
    const e429 = await klien!.chat({ model: "m", messages: [{ role: "user", content: "x" }] }).then(() => null, (e) => e);
    check("429 per menit: AiGalat dan jeda mengikuti Retry-After", e429 instanceof AiGalat && e429.status === 429 && sisaJedaDetik() >= 1 && sisaJedaDetik() <= 2, `sisa ${sisaJedaDetik()}`);
    const saatJeda = await klien!.chat({ model: "m", messages: [{ role: "user", content: "x" }] }).then(() => null, (e) => e);
    check("Selama jeda, penyedia TIDAK ditembak lagi", saatJeda instanceof AiGalat && ai.masuk.length === sebelum + 1);
    await new Promise((r) => setTimeout(r, 2200));
    ai.atur(() => gemini('{"terjawab": true, "jawaban": "pulih"}'));
    const pulih = await klien!.chat({ model: "m", messages: [{ role: "user", content: "x" }] });
    check("Setelah jeda selesai, AI dipakai lagi", pulih.includes("pulih") && sisaJedaDetik() === 0);

    // Bentuk galat kuota Google yang sebenarnya: pesan umum, nama kuota harian hanya ada di bagian detail
    resetJedaUntukUji();
    ai.atur(() => ({
      status: 429,
      body: [{ error: { code: 429, message: "You exceeded your current quota, please check your plan and billing details.", status: "RESOURCE_EXHAUSTED", details: [{ "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }] }] } }],
    }));
    await klien!.chat({ model: "m", messages: [{ role: "user", content: "x" }] }).catch(() => {});
    check("429 kuota harian (penanda di bagian detail): jeda panjang sekitar 1 jam", sisaJedaDetik() > 3000, `sisa ${sisaJedaDetik()}`);
    resetJedaUntukUji();
    ai.atur(() => galatGoogle(429, "Quota exceeded for metric: generate_requests_per_day_per_project_per_model, limit: 500"));
    await klien!.chat({ model: "m", messages: [{ role: "user", content: "x" }] }).catch(() => {});
    check("429 kuota harian (penulisan per_day dengan garis bawah): jeda panjang", sisaJedaDetik() > 3000, `sisa ${sisaJedaDetik()}`);

    resetJedaUntukUji();
    ai.atur(() => galatGoogle(401, "API key not valid"));
    await klien!.chat({ model: "m", messages: [{ role: "user", content: "x" }] }).catch(() => {});
    check("401 kunci ditolak: jeda 10 menit agar tidak menembak berulang", sisaJedaDetik() > 500 && sisaJedaDetik() <= 600, `sisa ${sisaJedaDetik()}`);
    resetJedaUntukUji();
    // Google membalas kunci yang salah dengan 400, bukan 401 (dicek langsung ke server Google dengan kunci palsu)
    ai.atur(() => galatGoogle(400, "Please pass a valid API key"));
    await klien!.chat({ model: "m", messages: [{ role: "user", content: "x" }] }).catch(() => {});
    check("400 'valid API key' juga dijeda 10 menit", sisaJedaDetik() > 500 && sisaJedaDetik() <= 600, `sisa ${sisaJedaDetik()}`);
    resetJedaUntukUji();

    // ---- Server tidak terjangkau ----
    config.AI_BASE_URL = "http://127.0.0.1:1/v1beta/openai";
    const mati = await klien!.chat({ model: "m", messages: [{ role: "user", content: "x" }] }).then(() => null, (e) => e);
    check("Penyedia tak terjangkau melempar AiGalat, bukan crash", mati instanceof AiGalat);
    config.AI_BASE_URL = ai.url;

    // ---- uraiJson ----
    const skema = z.object({ a: z.number() });
    check("uraiJson: JSON polos", uraiJson('{"a": 1}', skema)?.a === 1);
    check("uraiJson: dibungkus pagar kode dan kalimat pembuka", uraiJson('Ini hasilnya:\n```json\n{"a": 2}\n```\nSemoga membantu', skema)?.a === 2);
    check("uraiJson: bentuk salah atau bukan JSON menghasilkan null", uraiJson('{"a": "x"}', skema) === null && uraiJson("tidak ada json", skema) === null && uraiJson("{rusak", skema) === null);

    // ---- Jalur lengkap: /chat -> klien sungguhan -> penyedia tiruan ----
    const faq = await db.faq.create({ data: { keys: ["smokeunik15"], answer: "Jawaban FAQ uji [SMOKE15]", sortOrder: 999 } });
    dibuat.push(faq.id);
    config.CHAT_AI_DAILY_LIMIT = batasChat.terpakai() + 5;
    ai.masuk.length = 0;
    ai.atur(() => gemini('{"terjawab": true, "jawaban": "Tiket Rp5.000 per orang."}'));
    const bebas = await request(baseUrl, "/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: "berapa harga masuknya?" }) });
    check("/chat -> penyedia: dijawab AI", bebas.status === 200 && bebas.body.source === "ai" && bebas.body.answer.includes("Rp5.000"), JSON.stringify(bebas.body));
    check("Penyedia menerima data resmi di pesan sistem dan pertanyaan di pesan pengguna", ai.masuk.length === 1 && String(ai.masuk[0].body.messages[0].content).includes("DATA RESMI") && ai.masuk[0].body.messages.at(-1).content.includes("harga masuknya"));
    check("Jawaban ke aplikasi tidak memuat kunci", !JSON.stringify(bebas.body).includes("kunci-uji-rahasia"));

    ai.atur(() => galatGoogle(429, "Quota exceeded: requests per minute"));
    const jatahSebelum = batasChat.terpakai();
    const habis = await request(baseUrl, "/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: "smokeunik15" }) });
    check("Kuota penyedia habis: pengunjung tetap dijawab dari FAQ (200)", habis.status === 200 && habis.body.source === "faq" && String(habis.body.answer).includes("[SMOKE15]"), JSON.stringify(habis.body));
    check("Jatah harian dikembalikan saat panggilan gagal", batasChat.terpakai() === jatahSebelum);
    const hitAwal = ai.masuk.length;
    const lagi = await request(baseUrl, "/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: "kalau parkir mobil?" }) });
    check("Selama jeda, chat tidak menembak penyedia dan tidak 500", lagi.status === 200 && ai.masuk.length === hitAwal);

    console.log("=== Seluruh Pemeriksaan P18 LULUS ===");
  } finally {
    setAiClientForTests(null);
    resetJedaUntukUji();
    config.AI_API_KEY = awal.kunci;
    config.AI_BASE_URL = awal.url;
    config.AI_REASONING_EFFORT = awal.usaha;
    config.CHAT_AI_DAILY_LIMIT = awal.batas;
    for (const id of dibuat) await db.faq.delete({ where: { id } }).catch(() => {});
    await db.unansweredQuestion.deleteMany({ where: { question: { in: ["berapa harga masuknya?", "kalau parkir mobil?"] } } }).catch(() => {});
    await close();
    await ai.tutup();
  }
}

run().catch((err) => {
  console.error("Smoke test P18 gagal:", err);
  process.exit(1);
});
