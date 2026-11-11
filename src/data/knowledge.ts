// Data pengetahuan Tanya Sira: fakta tentang Sumber Sira yang boleh dijawab chatbot.
// Disusun dari informasi yang sudah ada di aplikasi pengunjung dan README. Kalau info di loket berubah, ubah di sini.
// Dipakai dua cara: (1) jadi bahan jawaban AI, (2) jadi jawaban cadangan berdasarkan kata kunci bila AI belum dipasang.
// Hal yang tidak ada di sini (mis. hujan, makanan dari luar, sewa payung) sengaja tidak dijawab chatbot dan diteruskan ke pengelola.
import { tokens } from "../lib/faq-match.js";
import { CAPACITY } from "../lib/pricing.js";

export type Fact = { keys: string[]; text: string };

export const FACTS: Fact[] = [
  { keys: ["jam buka", "buka jam", "kapan buka", "buka", "tutup", "weekend", "weekday", "operasional"], text: "Jam buka: weekday 08.00-16.00, weekend 08.00-17.00." },
  { keys: ["harga", "htm", "tarif", "balita", "biaya masuk"], text: "Tiket masuk Rp5.000 per orang untuk usia 3 tahun ke atas. Anak di bawah 3 tahun (balita) gratis." },
  { keys: ["parkir"], text: "Biaya parkir: motor Rp3.000, mobil Rp10.000, bus Rp20.000. Pilihan parkir diisi saat membeli tiket masuk." },
  { keys: ["qris", "tunai", "cash", "pembayaran", "bayar"], text: "Tiket masuk bisa dibayar QRIS atau tunai di loket (pilih Pesan, Bayar di Loket). Sewa alat dan wahana dibayar lewat QRIS." },
  { keys: ["fasilitas", "gazebo", "musholla", "mushola", "kolam anak"], text: "Fasilitas: kolam mata air, kolam anak, gazebo, dan musholla." },
  { keys: ["aturan", "sabun", "sampo", "shampoo", "larangan", "dilarang"], text: "Aturan kunjungan: tidak memakai sabun dan sampo di kolam." },
  { keys: ["beli tiket", "pesan tiket", "tiket online", "e-tiket", "etiket", "kode qr", "barcode", "scan"], text: "Beli tiket di aplikasi: menu Tiket & Booking, segmen Tiket Masuk, lalu Beli Tiket Masuk. E-tiket berisi kode QR yang discan petugas di pintu masuk, dan setelah discan pengunjung ikut terhitung di Live Crowd." },
  { keys: ["booking", "sewa", "atv", "ban kecil", "ban besar", "loker", "wahana", "flying fox", "bebek", "kereta sawah"], text: "Sewa alat dan wahana: buka Tiket & Booking, segmen Sewa & Wahana, pilih jam kunjungan, tambah item, tekan Lanjut Booking, lalu bayar QRIS. Invoice dan QR dikirim ke nomor WhatsApp yang dipakai." },
  { keys: ["riwayat", "whatsapp", "tiket saya", "tiket hilang", "invoice"], text: "Riwayat tiket dan invoice dicari lewat nomor WhatsApp yang dipakai saat membeli (Tiket & Booking, segmen Riwayat). Tidak perlu login." },
  { keys: ["ramai", "sepi", "crowd", "penuh", "keramaian", "antre", "antri"], text: `Live Crowd di Beranda dihitung dari tiket yang sudah discan masuk dan belum keluar, dibagi kapasitas ${CAPACITY} orang: di bawah 40% Sepi, sampai 75% Sedang, di atasnya Ramai. Biasanya paling sepi pukul 08.00-09.00 atau setelah 15.00.` },
  { keys: ["lokasi", "alamat", "maps", "petunjuk arah", "putukrejo", "malang"], text: "Sumber Sira adalah wisata kolam mata air di Desa Putukrejo, Malang, dikelola BUMDes Putukrejo. Petunjuk arah ada di menu Profil (Lokasi & Arah) lewat tombol Google Maps." },
  { keys: ["ai photo", "photo studio", "enhance", "edit foto", "perbagus foto", "jernihkan foto", "filter foto"], text: "AI Photo Studio di Beranda memperbagus warna foto dari galeri HP secara otomatis, ada slider kekuatan dan perbandingan dengan foto asli." },
];

// Kata-kata penting tiap fakta (isi + kata kunci), untuk memeriksa apakah pertanyaan benar-benar dibahas fakta itu.
const FACT_TOKENS = FACTS.map((f) => new Set(tokens(`${f.text} ${f.keys.join(" ")}`)));

// Jawaban cadangan dari data (dipakai bila AI belum dipasang atau sedang gangguan). Dua syarat supaya tidak menyesatkan:
// (1) ada kata kunci spesifik di pertanyaan, (2) minimal 60% kata penting pertanyaan memang dibahas fakta itu.
// Contoh: "boleh bawa drone ke kolam?" tidak boleh dijawab dengan daftar fasilitas hanya karena ada kata "kolam".
export function answerFromFacts(question: string): string | null {
  const q = question.toLowerCase();
  const qt = tokens(question);
  if (qt.length === 0) return null;
  let best: { text: string; cover: number; hits: number } | null = null;
  FACTS.forEach((f, i) => {
    const hits = f.keys.filter((k) => q.includes(k)).length;
    if (hits === 0) return;
    const cover = qt.filter((w) => FACT_TOKENS[i].has(w)).length / qt.length;
    if (cover < 0.6) return;
    if (!best || cover > best.cover || (cover === best.cover && hits > best.hits)) best = { text: f.text, cover, hits };
  });
  return best ? (best as { text: string }).text : null;
}

type RideLike = { name: string; category: string; price: number; unit: string; active: boolean };
const rp = (n: number) => `Rp${n.toLocaleString("id-ID")}`;

// Bahan lengkap untuk AI: fakta tetap, harga wahana terbaru dari database, dan keramaian saat ini.
export function buildContext(rides: RideLike[], crowd: { inside: number; percent: number; label: string }): string {
  const lines = FACTS.map((f) => `- ${f.text}`);
  const active = rides.filter((r) => r.active);
  if (active.length) {
    lines.push("- Daftar sewa alat dan wahana yang tersedia sekarang:");
    for (const r of active) lines.push(`  * ${r.name} (${r.category}): ${rp(r.price)}${r.unit ? ` per ${r.unit}` : ""}`);
  }
  lines.push(`- Keramaian saat ini: ${crowd.inside} orang di dalam (${crowd.percent}% dari kapasitas ${CAPACITY}), status ${crowd.label}.`);
  return lines.join("\n");
}
