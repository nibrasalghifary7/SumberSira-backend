import { nilaiFoto } from "./ai/photo-advisor.js";
import { perbaikiFoto, type Laporan } from "./photo/engine.js";

/**
 * Perbaikan foto AI Photo Studio (fitur AI nomor 2).
 *
 * Alur: (1) AI Claude menilai foto bila kunci tersedia, (2) mesin pengolahan gambar menerapkan koreksi warna, kabut, kecerahan,
 * kontras lokal, dan vibrance dengan angka dari penilaian itu atau dari statistik foto. Tidak ada gambar yang dibuat atau
 * diubah oleh AI, jadi wajah, bentuk, dan latar tetap persis sama (lihat services/photo/engine.ts). Berjalan di server,
 * jadi tidak bergantung pada kemampuan ponsel pengunjung.
 */
export interface OpsiEnhance {
  /** 0..100, bawaan 60 */
  strength?: number;
}

export interface ImageEnhancer {
  enhance(input: Buffer, opsi?: OpsiEnhance): Promise<{ jpeg: Buffer; laporan: Laporan; olehAi: boolean }>;
}

export const autoEnhancer: ImageEnhancer = {
  async enhance(input, opsi = {}) {
    const saran = await nilaiFoto(input);
    const { jpeg, laporan } = await perbaikiFoto(input, { kekuatan: opsi.strength, saran });
    return { jpeg, laporan, olehAi: saran !== null };
  },
};
