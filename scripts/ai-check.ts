import sharp from "sharp";
import { config } from "../src/config/index.js";
import { db } from "../src/config/database.js";
import { AiGalat, getAiClient } from "../src/services/ai/client.js";
import { tanyaAsisten } from "../src/services/ai/chatbot.js";
import { nilaiFoto } from "../src/services/ai/photo-advisor.js";

// Cek apakah dua fitur AI (chatbot dan penilaian foto) benar-benar hidup. Pemakaian: npm run ai:cek
// Memakai 3 panggilan dari kuota gratis. Kunci tidak pernah ditampilkan. Hanya membaca database, tidak menulis apa pun.

const ok = (t: string) => console.log(`  [OK]     ${t}`);
const gagal = (t: string) => console.log(`  [GAGAL]  ${t}`);

function jelaskan(err: unknown): string {
  if (err instanceof AiGalat) {
    const pesan = err.message;
    if (err.status === 401 || err.status === 403 || (err.status === 400 && /api[\s_-]?key/i.test(pesan)))
      return "Kunci ditolak Google. Kemungkinan salah salin (ada spasi atau terpotong) atau kunci sudah dihapus. Buat kunci baru di aistudio.google.com lalu salin utuh ke AI_API_KEY.";
    if (err.status === 404 || (err.status === 400 && /model/i.test(pesan)))
      return `Nama model tidak dikenal (CHAT_MODEL="${config.CHAT_MODEL}"). Pakai gemini-3.5-flash-lite atau hapus baris CHAT_MODEL dan PHOTO_AI_MODEL dari .env.`;
    if (err.status === 429)
      return "Kuota gratis sedang habis atau terlalu cepat. Tunggu beberapa menit lalu jalankan lagi. Kalau terus begini, lihat batas proyekmu di aistudio.google.com/rate-limit.";
    if (err.status === undefined)
      return `Tidak bisa menghubungi ${new URL(config.AI_BASE_URL).host}. Cek koneksi internet dan firewall. (${pesan})`;
    return `Penyedia AI membalas galat: ${pesan}`;
  }
  return err instanceof Error ? err.message : String(err);
}

// Foto sintetis sederhana (gradasi biru kehijauan ala foto bawah air) hanya untuk menguji penilaian foto.
async function fotoUji(): Promise<Buffer> {
  const w = 320, h = 240;
  const px = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      const t = y / h;
      px[i] = 20 + 20 * t;
      px[i + 1] = 110 + 40 * t;
      px[i + 2] = 150 - 20 * t;
    }
  return sharp(px, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 85 }).toBuffer();
}

async function main(): Promise<number> {
  console.log("\n=== Cek AI Sumber Sira ===\n");
  const client = getAiClient();
  if (!client) {
    console.log("AI belum hidup karena AI_API_KEY belum diisi. Langkahnya:\n");
    console.log("  1. Buka https://aistudio.google.com lalu masuk dengan akun Google.");
    console.log('  2. Klik "Get API key", lalu buat kunci. Gratis, tidak perlu kartu kredit.');
    console.log("     Jangan menghubungkan akun penagihan (billing) supaya tetap gratis.");
    console.log('  3. Buka file .env di folder backend ini, lalu tambahkan satu baris:  AI_API_KEY="kunci-yang-disalin"');
    console.log("  4. Simpan, lalu jalankan lagi:  npm run ai:cek\n");
    return 1;
  }

  console.log(`Penyedia : ${new URL(config.AI_BASE_URL).host}`);
  console.log(`Model    : chat ${config.CHAT_MODEL}, foto ${config.PHOTO_AI_MODEL}`);
  console.log(`Kunci    : terbaca (${config.AI_API_KEY.length} karakter)\n`);

  let semuaOk = true;

  // 1. Hubungan dan kunci
  try {
    const balasan = await client.chat({ model: config.CHAT_MODEL, messages: [{ role: "user", content: "Balas hanya dengan satu kata: OK" }] });
    ok(`Kunci diterima dan model menjawab ("${balasan.trim().slice(0, 40)}")`);
  } catch (err) {
    gagal(jelaskan(err));
    console.log("\nAI belum hidup. Perbaiki hal di atas lalu jalankan lagi: npm run ai:cek\n");
    return 1;
  }

  // 2. Chatbot: pertanyaan bebas yang dijawab dari data resmi di database
  try {
    const hasil = await tanyaAsisten("Berapa harga tiket masuk?");
    if (hasil) {
      ok(`Chatbot menjawab dari data resmi: "${hasil.answer.slice(0, 140)}"`);
      if (!hasil.answered) console.log("          (AI menandai belum terjawab; cek apakah harga tiket sudah diisi di admin)");
    } else {
      gagal("Chatbot tidak memberi jawaban yang terbaca (lihat pesan galat di atas). Aplikasi tetap aman karena otomatis memakai FAQ.");
      semuaOk = false;
    }
  } catch (err) {
    gagal(`Chatbot: ${jelaskan(err)}. Bila menyebut database, pastikan DATABASE_URL di .env benar.`);
    semuaOk = false;
  }

  // 3. Penilaian foto
  try {
    const saran = await nilaiFoto(await fotoUji());
    if (saran) {
      ok(`AI Photo menilai foto uji (jenis ${saran.mode}, kabut ${saran.kabut.toFixed(2)}, eksposur ${saran.eksposur.toFixed(2)}, kontras ${saran.kontras.toFixed(2)}, warna ${saran.warna.toFixed(2)})`);
    } else {
      gagal("Penilaian foto tidak terbaca (lihat pesan galat di atas). Foto tetap diperbaiki otomatis tanpa AI.");
      semuaOk = false;
    }
  } catch (err) {
    gagal(`AI Photo: ${jelaskan(err)}`);
    semuaOk = false;
  }

  if (semuaOk) {
    console.log("\nAI HIDUP di komputer ini. Langkah terakhir, supaya hidup juga di internet:");
    console.log("  Render, buka service sumbersira-api, tab Environment, Add Environment Variable:");
    console.log("  Key = AI_API_KEY, Value = kunci yang sama, lalu Save (Render deploy ulang otomatis).");
    console.log('  Setelah itu halaman admin Chatbot & FAQ menampilkan "Chatbot AI aktif".\n');
    return 0;
  }
  console.log("\nSebagian AI belum jalan. Lihat baris [GAGAL] di atas.\n");
  return 1;
}

// Biarkan proses berhenti sendiri setelah koneksi database ditutup: memanggil process.exit saat koneksi masih menutup
// membuat Windows menampilkan galat internal "Assertion failed ... UV_HANDLE_CLOSING". Pengaman di bawah hanya menyala
// bila ada koneksi yang menggantung.
const selesai = async (kode: number) => {
  await db.$disconnect().catch(() => {});
  process.exitCode = kode;
  setTimeout(() => process.exit(kode), 5000).unref();
};

main()
  .then(selesai)
  .catch(async (err) => {
    console.error("Cek AI berhenti karena galat tak terduga:", err instanceof Error ? err.message : err);
    await selesai(1);
  });
