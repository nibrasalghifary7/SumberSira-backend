import Anthropic from "@anthropic-ai/sdk";
import { config } from "../../config/index.js";
import { jakartaDate } from "../../utils/time.js";

// Klien Claude bersama untuk dua fitur AI (chatbot dan analisis foto). Kunci hanya dibaca di server dari ANTHROPIC_API_KEY,
// tidak pernah dikirim ke aplikasi. Tanpa kunci, getAiClient() mengembalikan null dan pemanggil memakai cadangan tanpa AI.
export type AiClient = Pick<Anthropic, "messages">;

let sungguhan: Anthropic | null = null;
let pengganti: AiClient | null = null;

export function getAiClient(): AiClient | null {
  if (pengganti) return pengganti;
  if (!config.ANTHROPIC_API_KEY) return null;
  sungguhan ??= new Anthropic({ apiKey: config.ANTHROPIC_API_KEY, timeout: 30_000, maxRetries: 1 });
  return sungguhan;
}

export const aiAktif = () => getAiClient() !== null;

// Hanya untuk pengujian: ganti klien dengan tiruan supaya jalur AI bisa diuji tanpa kunci dan tanpa biaya.
export function setAiClientForTests(client: AiClient | null) {
  pengganti = client;
}

// Penghitung panggilan per hari (WIB). Tersimpan di memori server: reset saat server mulai ulang, cukup sebagai
// pengaman biaya, bukan sebagai data penagihan.
export function buatBatasHarian(maks: () => number) {
  let tanggal = "";
  let terpakai = 0;
  const segarkan = () => {
    const hariIni = jakartaDate();
    if (hariIni !== tanggal) {
      tanggal = hariIni;
      terpakai = 0;
    }
  };
  return {
    // Ambil satu jatah; false bila jatah hari ini habis.
    ambil(): boolean {
      segarkan();
      if (terpakai >= maks()) return false;
      terpakai++;
      return true;
    },
    terpakai(): number {
      segarkan();
      return terpakai;
    },
    maks,
    // Kembalikan jatah bila panggilan gagal sebelum sampai ke Claude.
    kembalikan() {
      if (terpakai > 0) terpakai--;
    },
  };
}
