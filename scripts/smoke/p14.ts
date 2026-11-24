import sharp from "sharp";
import { startTestServer, request, check } from "./_helpers.js";
import { db } from "../../src/config/database.js";
import { config } from "../../src/config/index.js";
import { getStorageDriver } from "../../src/services/storage/index.js";
import { setAiClientForTests, type AiClient } from "../../src/services/ai/client.js";
import { MAKS_SISI, perbaikiFoto, tebakMode, hitungParameter } from "../../src/services/photo/engine.js";

// P14: AI Photo Studio. Dua hal diuji:
//  (1) mesin perbaikan TIDAK mengubah bentuk: ukuran dan proporsi sama, tepi-tepi objek tetap di tempatnya (korelasi tepi tinggi),
//      yang berubah hanya warna, kabut, kecerahan, dan kontras;
//  (2) endpoint: kolom strength, atur ulang kekuatan dari foto asli, dan penilaian AI (klien Claude tiruan) yang dijepit aman.

// Foto sintetis ala bawah air: gradasi biru-hijau yang miskin merah, kabut, "perenang" berkulit, batu gelap, dan garis cahaya.
async function fotoBawahAir(w: number, h: number): Promise<Buffer> {
  const px = Buffer.alloc(w * h * 3);
  let seed = 12345;
  const acak = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) - 0.5;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      const t = y / h;
      let r = 18 + 25 * t, g = 105 + 40 * t, b = 150 - 25 * t;
      // garis cahaya diagonal
      if (((x + y * 0.6) % 90) < 14) { r += 25; g += 30; b += 25; }
      // batu gelap persegi panjang
      if (x > w * 0.62 && x < w * 0.82 && y > h * 0.55 && y < h * 0.85) { r = 15; g = 40; b = 45; }
      // perenang: lingkaran kulit
      const dx = x - w * 0.3, dy = y - h * 0.45;
      if (dx * dx + dy * dy < (h * 0.12) ** 2) { r = 120; g = 90; b = 80; }
      const n = acak() * 8;
      px[i] = Math.max(0, Math.min(255, r + n));
      px[i + 1] = Math.max(0, Math.min(255, g + n));
      px[i + 2] = Math.max(0, Math.min(255, b + n));
    }
  }
  return sharp(px, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 92 }).toBuffer();
}

async function abuAbu(buf: Buffer, w: number, h: number): Promise<Float64Array> {
  const g = await sharp(buf).resize(w, h, { fit: "fill" }).greyscale().raw().toBuffer();
  return Float64Array.from(g);
}

// Besaran tepi (Sobel) sederhana
function tepi(g: Float64Array, w: number, h: number): Float64Array {
  const out = new Float64Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = (dx: number, dy: number) => g[(y + dy) * w + (x + dx)];
      const gx = -p(-1, -1) - 2 * p(-1, 0) - p(-1, 1) + p(1, -1) + 2 * p(1, 0) + p(1, 1);
      const gy = -p(-1, -1) - 2 * p(0, -1) - p(1, -1) + p(-1, 1) + 2 * p(0, 1) + p(1, 1);
      out[y * w + x] = Math.hypot(gx, gy);
    }
  }
  return out;
}

function korelasi(a: Float64Array, b: Float64Array): number {
  const n = a.length;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; }
  return sab / Math.sqrt(saa * sbb || 1);
}

async function rataKanal(buf: Buffer): Promise<[number, number, number]> {
  const s = await sharp(buf).stats();
  return [s.channels[0].mean, s.channels[1].mean, s.channels[2].mean];
}

async function selisihRata(a: Buffer, b: Buffer): Promise<number> {
  const [wa, ha] = [(await sharp(a).metadata()).width!, (await sharp(a).metadata()).height!];
  const x = await sharp(a).raw().toBuffer();
  const y = await sharp(b).resize(wa, ha, { fit: "fill" }).raw().toBuffer();
  let s = 0;
  for (let i = 0; i < x.length; i++) s += Math.abs(x[i] - y[i]);
  return s / x.length;
}

const form = (foto: Buffer, kolom: Record<string, string> = {}) => {
  const f = new FormData();
  f.append("photo", new Blob([new Uint8Array(foto)], { type: "image/jpeg" }), "uji.jpg");
  for (const [k, v] of Object.entries(kolom)) f.append(k, v);
  return { method: "POST", body: f } as RequestInit;
};

async function run() {
  console.log("=== Menjalankan Smoke Test P14 (AI Photo Studio) ===");

  // ---------- Bagian 1: mesin perbaikan ----------
  const w = 640, h = 480;
  const asli = await fotoBawahAir(w, h);
  const statAsli = await rataKanal(asli);
  const mode = tebakMode({ rata: statAsli, rataTerang: 0.2126 * statAsli[0] + 0.7152 * statAsli[1] + 0.0722 * statAsli[2] });
  check("Foto sintetis miskin merah dikenali sebagai bawah air", mode === "bawah-air");

  const penuh = await perbaikiFoto(asli, { kekuatan: 100 });
  const meta = await sharp(penuh.jpeg).metadata();
  check("Ukuran hasil sama dengan foto asli", meta.width === w && meta.height === h && meta.format === "jpeg");

  const ea = tepi(await abuAbu(asli, 320, 240), 320, 240);
  const eb = tepi(await abuAbu(penuh.jpeg, 320, 240), 320, 240);
  const kor = korelasi(ea, eb);
  check("Bentuk tidak berubah: tepi objek tetap di tempatnya (korelasi tepi >= 0.9)", kor >= 0.9, `korelasi ${kor.toFixed(3)}`);

  const statHasil = await rataKanal(penuh.jpeg);
  check("Merah yang hilang di bawah air dipulihkan", statHasil[0] > statAsli[0] + 5, `merah ${statAsli[0].toFixed(0)} -> ${statHasil[0].toFixed(0)}`);

  // Proporsi pada foto besar (diperkecil, bukan dipotong)
  const besar = await sharp({ create: { width: 3200, height: 1600, channels: 3, background: { r: 30, g: 110, b: 140 } } }).jpeg().toBuffer();
  const kecil = await perbaikiFoto(besar, { kekuatan: 60 });
  check(`Foto besar diperkecil proporsional (maks ${MAKS_SISI}px)`, kecil.laporan.lebar === MAKS_SISI && kecil.laporan.tinggi === MAKS_SISI / 2);

  // Kekuatan: 0 = asli, makin besar makin berubah
  const k0 = await perbaikiFoto(asli, { kekuatan: 0 });
  const k50 = await perbaikiFoto(asli, { kekuatan: 50 });
  const d0 = await selisihRata(asli, k0.jpeg), d50 = await selisihRata(asli, k50.jpeg), d100 = await selisihRata(asli, penuh.jpeg);
  check("Kekuatan 0 hampir sama dengan foto asli", d0 < 3, `selisih ${d0.toFixed(2)}`);
  check("Makin besar kekuatan makin besar perubahan", d0 < d50 && d50 < d100, `${d0.toFixed(1)} < ${d50.toFixed(1)} < ${d100.toFixed(1)}`);

  // Saran ngawur dijepit: tidak melempar galat dan parameter tetap di rentang aman
  const ngawur = await perbaikiFoto(asli, { kekuatan: 100, saran: { kabut: 99, eksposur: -50, kontras: 99, warna: 99 } });
  check("Saran ngawur tetap menghasilkan JPEG valid", (await sharp(ngawur.jpeg).metadata()).width === w);
  check("Parameter dijepit ke rentang aman", ngawur.laporan.vibrance <= 0.35 && ngawur.laporan.kontrasLokal <= 0.7 && ngawur.laporan.gamma >= 0.7 && ngawur.laporan.gamma <= 1.25 && ngawur.laporan.gain.every((g) => g >= 0.8 && g <= 2.4));

  // Ada kulit: kepekatan warna dikurangi
  const stat = { rata: statAsli, rendah: [0, 40, 60] as [number, number, number], tinggi: [200, 220, 230] as [number, number, number], sorot: [180, 210, 220] as [number, number, number], rataTerang: 90 };
  const sampel = new Uint8Array(30).fill(100);
  const tanpa = hitungParameter(stat, sampel, 10, { mode: "bawah-air" });
  const dengan = hitungParameter(stat, sampel, 10, { mode: "bawah-air", adaKulit: true });
  check("Ada kulit: kompensasi merah dan vibrance dikurangi", dengan.alfaMerah < tanpa.alfaMerah && dengan.vibrance < tanpa.vibrance);

  // Foto rusak ditolak dengan galat, tidak membuat proses macet
  let galat = false;
  try { await perbaikiFoto(Buffer.from("bukan gambar sama sekali")); } catch { galat = true; }
  check("Berkas bukan gambar menghasilkan galat", galat);

  // ---------- Bagian 2: endpoint ----------
  const { baseUrl, close } = await startTestServer();
  const publikAwal = config.PUBLIC_BASE_URL;
  config.PUBLIC_BASE_URL = baseUrl; // supaya URL foto asli bisa diambil lagi oleh endpoint strength
  const kunci: string[] = [];
  const driver = getStorageDriver();
  try {
    const foto = await fotoBawahAir(480, 360);
    setAiClientForTests(null);
    const r1 = await request(baseUrl, "/ai-photo", form(foto, { strength: "30" }));
    check("POST /ai-photo 201 dengan kolom strength", r1.status === 201 && r1.body.strength === 30 && r1.body.status === "done");
    if (!config.ANTHROPIC_API_KEY) check("Tanpa kunci AI: mesin otomatis dipakai", r1.body.engine === "otomatis");
    const job1 = await db.aiPhotoJob.findUnique({ where: { id: r1.body.id } });
    if (job1?.originalKey) kunci.push(job1.originalKey);
    if (job1?.resultKey) kunci.push(job1.resultKey);

    const r2 = await request(baseUrl, "/ai-photo", form(foto));
    check("Tanpa strength memakai bawaan 60", r2.status === 201 && r2.body.strength === 60);
    const job2 = await db.aiPhotoJob.findUnique({ where: { id: r2.body.id } });
    if (job2?.originalKey) kunci.push(job2.originalKey);
    if (job2?.resultKey) kunci.push(job2.resultKey);

    const atur = await request(baseUrl, `/ai-photo/${r1.body.id}/strength`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ strength: 90 }) });
    check("Atur ulang kekuatan 200 dengan hasil baru", atur.status === 200 && atur.body.strength === 90 && atur.body.resultUrl !== r1.body.resultUrl);
    const job1b = await db.aiPhotoJob.findUnique({ where: { id: r1.body.id } });
    if (job1b?.resultKey) kunci.push(job1b.resultKey);
    const hasilBaru = await fetch(atur.body.resultUrl);
    check("Hasil baru bisa diunduh sebagai JPEG", hasilBaru.status === 200 && (hasilBaru.headers.get("content-type") ?? "").includes("image"));
    check("Kekuatan di luar 0-100 ditolak 400", (await request(baseUrl, `/ai-photo/${r1.body.id}/strength`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ strength: 150 }) })).status === 400);
    check("Job tidak ada 404", (await request(baseUrl, "/ai-photo/tidak-ada/strength", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ strength: 50 }) })).status === 404);
    check("Bukan gambar ditolak 415", (await request(baseUrl, "/ai-photo", form(Buffer.from("bukan gambar tetapi cukup panjang untuk lolos")))).status === 415);

    // Penilaian AI (klien tiruan): gambar dikirim sebagai blok image, hasil dijepit
    const panggilan: any[] = [];
    const tiruan = { messages: { parse: async (p: any) => { panggilan.push(p); return { stop_reason: "end_turn", parsed_output: { jenis: "bawah-air", kabut: 7, eksposur: -9, kontras: 0.5, warna: 0.5, ada_kulit: true } }; } } } as unknown as AiClient;
    setAiClientForTests(tiruan);
    const r3 = await request(baseUrl, "/ai-photo", form(foto, { strength: "70" }));
    check("Dengan AI: engine ai dan 201", r3.status === 201 && r3.body.engine === "ai");
    check("Claude menerima foto sebagai gambar dan instruksi tidak mengubah isi", panggilan.length === 1 && panggilan[0].messages[0].content[0].type === "image" && String(panggilan[0].system).includes("harus tetap sama"));
    const job3 = await db.aiPhotoJob.findUnique({ where: { id: r3.body.id } });
    if (job3?.originalKey) kunci.push(job3.originalKey);
    if (job3?.resultKey) kunci.push(job3.resultKey);

    // AI galat: foto tetap diperbaiki dengan statistik
    setAiClientForTests({ messages: { parse: async () => { throw new Error("putus"); } } } as unknown as AiClient);
    const r4 = await request(baseUrl, "/ai-photo", form(foto));
    check("AI galat: foto tetap diproses dengan mesin otomatis", r4.status === 201 && r4.body.engine === "otomatis");
    const job4 = await db.aiPhotoJob.findUnique({ where: { id: r4.body.id } });
    if (job4?.originalKey) kunci.push(job4.originalKey);
    if (job4?.resultKey) kunci.push(job4.resultKey);

    console.log("=== Seluruh Pemeriksaan P14 LULUS ===");
  } finally {
    setAiClientForTests(null);
    config.PUBLIC_BASE_URL = publikAwal;
    await db.aiPhotoJob.deleteMany({ where: { OR: [{ originalKey: { in: kunci } }, { resultKey: { in: kunci } }] } }).catch(() => {});
    for (const k of new Set(kunci)) await driver.remove(k).catch(() => {});
    await close();
  }
}

run().catch((err) => {
  console.error("Smoke test P14 gagal:", err);
  process.exit(1);
});
