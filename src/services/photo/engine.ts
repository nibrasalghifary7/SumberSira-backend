import sharp from "sharp";

/**
 * Mesin perbaikan foto Sumber Sira: "retouch otomatis" ala Auto Color/Levels/Dehaze Photoshop.
 *
 * JAMINAN: mesin ini TIDAK generatif. Setiap piksel hanya diubah warna dan terangnya oleh kurva per kanal, kontras lokal
 * pada kecerahan, dan penajaman halus. Tidak ada pergeseran, pembengkokan, penghapusan, atau penambahan objek, wajah,
 * latar, atau tepi; ukuran dan proporsi foto tetap (hanya diperkecil bila sisi terpanjangnya melebihi MAKS_SISI).
 * Karena pengolahan terjadi di server, ponsel pengunjung yang lemah pun tetap mendapat hasil yang sama.
 */

export const MAKS_SISI = 2560;

export type Mode = "bawah-air" | "luar-ruang" | "redup";

// Penyesuaian yang boleh diusulkan AI (atau dihitung dari statistik). Semua nilai dijepit di sini, jadi usulan
// yang ngawur tidak mungkin merusak foto.
export interface Saran {
  mode?: Mode;
  /** 0..1 seberapa besar kabut/lapisan warna dibuang dari bayangan */
  kabut?: number;
  /** -1..1: negatif = foto terlalu gelap (dicerahkan), positif = terlalu terang */
  eksposur?: number;
  /** 0..1 tambahan kontras lokal */
  kontras?: number;
  /** 0..1 tambahan kepekatan warna (vibrance) */
  warna?: number;
  /** ada kulit/wajah: kepekatan warna dan koreksi merah dikurangi supaya kulit tetap natural */
  adaKulit?: boolean;
}

export interface Laporan {
  mode: Mode;
  gain: [number, number, number];
  hitam: [number, number, number];
  putih: [number, number, number];
  gamma: number;
  kontrasLokal: number;
  vibrance: number;
  lebar: number;
  tinggi: number;
  kekuatan: number;
}

const jepit = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

// Persentil dari histogram 256 kotak.
function persentil(hist: Uint32Array, total: number, p: number): number {
  const target = total * p;
  let acc = 0;
  for (let i = 0; i < 256; i++) {
    acc += hist[i];
    if (acc >= target) return i;
  }
  return 255;
}

interface Statistik {
  rata: [number, number, number];
  rendah: [number, number, number];
  tinggi: [number, number, number];
  /** rata-rata warna 2% piksel paling terang (untuk membaca warna cahaya) */
  sorot: [number, number, number];
  rataTerang: number;
}

function hitungStatistik(px: Uint8Array, n: number): Statistik {
  const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  const jumlah = [0, 0, 0];
  const luma = new Uint32Array(256);
  for (let i = 0; i < n; i++) {
    const r = px[i * 3], g = px[i * 3 + 1], b = px[i * 3 + 2];
    hist[0][r]++; hist[1][g]++; hist[2][b]++;
    jumlah[0] += r; jumlah[1] += g; jumlah[2] += b;
    luma[(0.2126 * r + 0.7152 * g + 0.0722 * b) | 0]++;
  }
  const rata = jumlah.map((j) => j / n) as [number, number, number];
  const rendah = [0, 1, 2].map((c) => persentil(hist[c], n, 0.005)) as [number, number, number];
  const tinggi = [0, 1, 2].map((c) => persentil(hist[c], n, 0.997)) as [number, number, number];
  // Warna sorotan: piksel dengan kecerahan di 2% teratas
  const batas = persentil(luma, n, 0.98);
  let sr = 0, sg = 0, sb = 0, sn = 0;
  for (let i = 0; i < n; i++) {
    const r = px[i * 3], g = px[i * 3 + 1], b = px[i * 3 + 2];
    if (0.2126 * r + 0.7152 * g + 0.0722 * b >= batas) { sr += r; sg += g; sb += b; sn++; }
  }
  const sorot: [number, number, number] = sn ? [sr / sn, sg / sn, sb / sn] : rata;
  return { rata, rendah, tinggi, sorot, rataTerang: 0.2126 * rata[0] + 0.7152 * rata[1] + 0.0722 * rata[2] };
}

// Tebak jenis foto dari statistik: bawah air = merah jauh lebih lemah daripada hijau-biru.
export function tebakMode(s: Pick<Statistik, "rata" | "rataTerang">): Mode {
  const [r, g, b] = s.rata;
  if (r / Math.max(1, (g + b) / 2) < 0.62) return "bawah-air";
  if (s.rataTerang < 70) return "redup";
  return "luar-ruang";
}

interface Parameter {
  mode: Mode;
  /** kekuatan kompensasi merah bawah air (0 = mati) */
  alfaMerah: number;
  /** selisih rata-rata hijau dan merah (0..1) yang dipulihkan pada merah */
  selisihMerah: number;
  gain: [number, number, number];
  hitam: [number, number, number];
  putih: [number, number, number];
  gamma: number;
  kontras: number; // 0..1 kelengkungan S
  kontrasLokal: number;
  vibrance: number;
}

// Hitung parameter dari statistik contoh (256 px) dan saran opsional. Semuanya dijepit ke rentang aman.
export function hitungParameter(stat: Statistik, sampel: Uint8Array, nSampel: number, saran?: Saran | null): Parameter {
  const mode = saran?.mode ?? tebakMode(stat);
  const kulit = saran?.adaKulit === true;

  // 1) Keseimbangan warna (gain per kanal). Di bawah air, merah yang hilang dikembalikan lewat kompensasi per piksel
  //    (lihat kompensasiMerah): memakai kanal hijau sebagai sumber dan hanya di bagian yang merahnya lemah, jadi
  //    bayangan dan benda gelap tidak berubah merah. Di sini hanya biru yang disamakan sedikit dengan hijau.
  let gain: [number, number, number] = [1, 1, 1];
  if (mode === "bawah-air") {
    const gBiru = jepit(stat.rata[1] / Math.max(stat.rata[2], 1), 0.85, 1.05);
    gain = [1, 1, gBiru];
  } else {
    // Cahaya berwarna (mis. lampu kuning): sorotan harusnya mendekati netral. Hanya dikoreksi bila bias jelas, dan dibatasi ±12%.
    const rataSorot = (stat.sorot[0] + stat.sorot[1] + stat.sorot[2]) / 3;
    const miring = Math.max(...stat.sorot) / Math.max(1, Math.min(...stat.sorot));
    if (miring > 1.14) gain = stat.sorot.map((v) => jepit(rataSorot / Math.max(v, 1), 0.88, 1.12)) as [number, number, number];
  }

  // 2) Titik hitam dan putih per kanal setelah gain (membuang kabut dan lapisan warna di bayangan)
  const kabut = jepit(saran?.kabut ?? (mode === "bawah-air" ? 0.85 : 0.5), 0, 1);
  const batasHitam = (mode === "bawah-air" ? 0.24 : 0.12) * 255;
  const hitam = [0, 1, 2].map((c) => jepit(stat.rendah[c] * gain[c] * kabut, 0, batasHitam)) as [number, number, number];
  const putih = [0, 1, 2].map((c) => jepit(stat.tinggi[c] * gain[c], 0.8 * 255, 255)) as [number, number, number];

  // 3) Gamma agar kecerahan menengah mendekati target (bayangan terangkat, sorotan aman)
  let rataSetelah = 0;
  for (let i = 0; i < nSampel; i++) {
    let l = 0;
    for (let c = 0; c < 3; c++) {
      const x = jepit((sampel[i * 3 + c] * gain[c] - hitam[c]) / Math.max(1, putih[c] - hitam[c]), 0, 1);
      l += x * [0.2126, 0.7152, 0.0722][c];
    }
    rataSetelah += l;
  }
  rataSetelah = jepit(rataSetelah / nSampel, 0.02, 0.98);
  const target = jepit((mode === "redup" ? 0.42 : 0.46) - 0.08 * (saran?.eksposur ?? 0), 0.3, 0.6);
  const gamma = jepit(Math.log(target) / Math.log(rataSetelah), 0.7, 1.25);

  // 4) Kontras, kontras lokal, kepekatan warna
  const kontras = mode === "bawah-air" ? 0.18 : 0.15;
  const kontrasLokal = jepit(saran?.kontras != null ? 0.2 + 0.5 * saran.kontras : mode === "bawah-air" ? 0.45 : 0.3, 0, 0.7);
  const vibrance = jepit((saran?.warna != null ? 0.12 + 0.3 * saran.warna : mode === "bawah-air" ? 0.28 : 0.2) * (kulit ? 0.5 : 1), 0, 0.35);

  const alfaMerah = mode === "bawah-air" ? (kulit ? 0.6 : 1) : 0;
  const selisihMerah = Math.max(0, (stat.rata[1] - stat.rata[0]) / 255);
  return { mode, alfaMerah, selisihMerah, gain, hitam, putih, gamma, kontras, kontrasLokal, vibrance };
}

// Kompensasi kanal merah di bawah air: r' = r + alfa * selisih * (1 - r) * g (semua dalam 0..1).
// Merah yang lemah dipulihkan sebanding dengan hijau di piksel yang sama; di tempat gelap (hijau kecil) hampir tidak berubah.
export function kompensasiMerah(px: Uint8Array, n: number, alfa: number, selisih: number): void {
  if (alfa <= 0 || selisih <= 0) return;
  const k = alfa * selisih;
  for (let i = 0, j = 0; i < n; i++, j += 3) {
    const r = px[j] / 255, g = px[j + 1] / 255;
    px[j] = jepit(Math.round((r + k * (1 - r) * g) * 255), 0, 255);
  }
}

// Tabel penukar nilai 0..255 per kanal: gain, titik hitam/putih, gamma, lalu kelengkungan S halus.
export function buatLut(p: Parameter): Uint8Array[] {
  const luts: Uint8Array[] = [];
  for (let c = 0; c < 3; c++) {
    const lut = new Uint8Array(256);
    for (let v = 0; v < 256; v++) {
      let x = jepit((v * p.gain[c] - p.hitam[c]) / Math.max(1, p.putih[c] - p.hitam[c]), 0, 1);
      x = Math.pow(x, p.gamma);
      const s = x * x * (3 - 2 * x); // smoothstep: bayangan lebih dalam, sorotan lebih cerah
      x = x * (1 - p.kontras) + s * p.kontras;
      lut[v] = Math.round(jepit(x, 0, 1) * 255);
    }
    luts.push(lut);
  }
  return luts;
}

export interface OpsiPerbaikan {
  /** 0..100: 0 = foto asli, 100 = perbaikan penuh. Bawaan 60. */
  kekuatan?: number;
  saran?: Saran | null;
}

// Perbaiki satu foto. Hasil: JPEG dan laporan parameter.
export async function perbaikiFoto(input: Buffer, opsi: OpsiPerbaikan = {}): Promise<{ jpeg: Buffer; laporan: Laporan }> {
  const kekuatan = jepit(opsi.kekuatan ?? 60, 0, 100) / 100;

  // Dasar: ikuti orientasi EXIF, batasi sisi terpanjang, buang alfa, sRGB. Proporsi tidak berubah.
  const dasar = await sharp(input, { failOn: "error" })
    .rotate()
    .resize({ width: MAKS_SISI, height: MAKS_SISI, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .toColourspace("srgb")
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = dasar.info;
  const asli = new Uint8Array(dasar.data.buffer, dasar.data.byteOffset, dasar.data.length);
  const n = w * h;

  // Contoh kecil untuk statistik (tidak perlu semua piksel)
  const contoh = await sharp(dasar.data, { raw: { width: w, height: h, channels: 3 } })
    .resize({ width: 256, height: 256, fit: "inside" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const nContoh = contoh.info.width * contoh.info.height;
  const px = new Uint8Array(contoh.data.buffer, contoh.data.byteOffset, contoh.data.length);
  let stat = hitungStatistik(px, nContoh);
  let prm = hitungParameter(stat, px, nContoh, opsi.saran);
  if (prm.alfaMerah > 0) {
    // Terapkan kompensasi merah ke contoh, lalu hitung ulang statistik dan parameter dari contoh yang sudah dikompensasi
    kompensasiMerah(px, nContoh, prm.alfaMerah, prm.selisihMerah);
    const mode = prm.mode, alfa = prm.alfaMerah, selisih = prm.selisihMerah;
    stat = hitungStatistik(px, nContoh);
    prm = { ...hitungParameter(stat, px, nContoh, { ...(opsi.saran ?? {}), mode }), mode, alfaMerah: alfa, selisihMerah: selisih };
  }
  const lut = buatLut(prm);
  // Kompensasi merah pada foto penuh (per piksel), sebelum kurva per kanal
  const sumber = prm.alfaMerah > 0 ? asli.slice() : asli;
  if (prm.alfaMerah > 0) kompensasiMerah(sumber, n, prm.alfaMerah, prm.selisihMerah);

  // Kecerahan sebelum dan sesudah kurva, untuk kontras lokal berbasis luma (warna ikut menyesuaikan, bukan diratakan per kanal)
  const hasil = new Uint8Array(n * 3);
  const lumaAsli = new Uint8Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 3) {
    const r = lut[0][sumber[j]], g = lut[1][sumber[j + 1]], b = lut[2][sumber[j + 2]];
    hasil[j] = r; hasil[j + 1] = g; hasil[j + 2] = b;
    lumaAsli[i] = (0.2126 * r + 0.7152 * g + 0.0722 * b) | 0;
  }

  // Kontras lokal (CLAHE) hanya pada kecerahan, lalu skala RGB dengan rasio yang dibatasi.
  if (prm.kontrasLokal > 0.01) {
    const lumaBaru = await sharp(Buffer.from(lumaAsli.buffer, lumaAsli.byteOffset, lumaAsli.length), { raw: { width: w, height: h, channels: 1 } })
      .clahe({ width: Math.max(16, Math.floor(w / 8)), height: Math.max(16, Math.floor(h / 8)), maxSlope: 2 })
      .raw()
      .toBuffer({ resolveWithObject: true });
    // sharp bisa mengembalikan 1 kanal atau 3 kanal; ambil kanal pertama dengan langkah sesuai jumlah kanal.
    const kanal = lumaBaru.info.channels;
    if (lumaBaru.data.length !== n * kanal) throw new Error("Keluaran CLAHE tidak sesuai ukuran foto");
    const a = prm.kontrasLokal;
    for (let i = 0, j = 0; i < n; i++, j += 3) {
      const rasio = jepit((lumaBaru.data[i * kanal] + 1) / (lumaAsli[i] + 1), 0.7, 1.6);
      const f = 1 + (rasio - 1) * a;
      hasil[j] = jepit(hasil[j] * f, 0, 255);
      hasil[j + 1] = jepit(hasil[j + 1] * f, 0, 255);
      hasil[j + 2] = jepit(hasil[j + 2] * f, 0, 255);
    }
  }

  // Vibrance: warna yang masih pucat ditambah lebih banyak daripada yang sudah pekat (kulit dan sorotan aman).
  if (prm.vibrance > 0.005) {
    for (let j = 0; j < n * 3; j += 3) {
      const r = hasil[j], g = hasil[j + 1], b = hasil[j + 2];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      const sat = mx === 0 ? 0 : (mx - mn) / mx;
      const f = 1 + prm.vibrance * (1 - sat);
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      hasil[j] = jepit(l + (r - l) * f, 0, 255);
      hasil[j + 1] = jepit(l + (g - l) * f, 0, 255);
      hasil[j + 2] = jepit(l + (b - l) * f, 0, 255);
    }
  }

  // Penajaman halus (unsharp) setelah warna selesai
  const tajam = await sharp(Buffer.from(hasil.buffer, hasil.byteOffset, hasil.length), { raw: { width: w, height: h, channels: 3 } })
    .sharpen({ sigma: 0.9, m1: 0.6, m2: 1.4 })
    .raw()
    .toBuffer();

  // Campur dengan foto asli sesuai kekuatan: 0 = asli, 100 = perbaikan penuh.
  const akhir = Buffer.allocUnsafe(n * 3);
  if (kekuatan >= 0.999) {
    tajam.copy(akhir);
  } else {
    for (let j = 0; j < n * 3; j++) akhir[j] = (asli[j] + (tajam[j] - asli[j]) * kekuatan + 0.5) | 0;
  }

  const jpeg = await sharp(akhir, { raw: { width: w, height: h, channels: 3 } })
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();

  return {
    jpeg,
    laporan: {
      mode: prm.mode,
      gain: prm.gain.map((v) => +v.toFixed(2)) as [number, number, number],
      hitam: prm.hitam.map((v) => Math.round(v)) as [number, number, number],
      putih: prm.putih.map((v) => Math.round(v)) as [number, number, number],
      gamma: +prm.gamma.toFixed(2),
      kontrasLokal: +prm.kontrasLokal.toFixed(2),
      vibrance: +prm.vibrance.toFixed(2),
      lebar: w,
      tinggi: h,
      kekuatan: +kekuatan.toFixed(2),
    },
  };
}
