import { z } from "zod";
import { config } from "../../config/index.js";
import { jakartaDate } from "../../utils/time.js";

// Klien AI bersama untuk dua fitur AI (chatbot dan penilaian foto). Berbicara ke penyedia GRATIS lewat antarmuka
// "chat completions" yang kompatibel dengan OpenAI (bawaan: Google Gemini tier gratis), memakai fetch biasa tanpa SDK.
// Kunci hanya dibaca di server dari AI_API_KEY dan tidak pernah dikirim ke aplikasi. Tanpa kunci, getAiClient()
// mengembalikan null dan pemanggil memakai cadangan tanpa AI.

export type AiBagian = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
export interface AiPesan {
  role: "system" | "user" | "assistant";
  content: string | AiBagian[];
}
export interface AiPermintaan {
  model: string;
  messages: AiPesan[];
}
export interface AiClient {
  // Mengembalikan teks balasan model; melempar AiGalat bila gagal.
  chat(req: AiPermintaan): Promise<string>;
}

export class AiGalat extends Error {
  constructor(message: string, readonly status?: number, readonly dijeda = false) {
    super(message);
    this.name = "AiGalat";
  }
}

const BATAS_WAKTU_MS = 30_000;

// Jeda otomatis: saat penyedia membalas "kuota habis" (429) atau kunci ditolak (401/403), panggilan berikutnya langsung
// dialihkan ke cadangan tanpa menembak penyedia lagi sampai jeda selesai. Melindungi kuota gratis dan mempercepat jawaban.
let jedaSampai = 0;
const jedakan = (detik: number) => {
  jedaSampai = Math.max(jedaSampai, Date.now() + detik * 1000);
};
export const sisaJedaDetik = () => Math.max(0, Math.ceil((jedaSampai - Date.now()) / 1000));
export function resetJedaUntukUji() {
  jedaSampai = 0;
}

// Pesan galat singkat untuk log, plus penanda apakah yang habis adalah kuota HARIAN. Penanda dicari di seluruh isi balasan
// karena Google menaruh nama kuota (mis. GenerateRequestsPerDayPerProjectPerModel) di bagian detail, bukan di pesan utamanya.
async function bacaGalat(res: Response): Promise<{ pesan: string; harian: boolean }> {
  const teks = (await res.text().catch(() => "")).slice(0, 8000);
  const harian = /per[\s_-]?day|daily|harian/i.test(teks);
  try {
    const j = JSON.parse(teks);
    const pesan = (Array.isArray(j) ? j[0] : j)?.error?.message ?? j?.message;
    if (typeof pesan === "string") return { pesan: pesan.slice(0, 300), harian };
  } catch {
    /* bukan JSON */
  }
  return { pesan: teks.slice(0, 300), harian };
}

function buatKlienHttp(): AiClient {
  return {
    async chat(req) {
      const sisa = sisaJedaDetik();
      if (sisa > 0) throw new AiGalat(`AI sedang dijeda ${sisa} detik lagi (kuota atau kunci bermasalah)`, 429, true);

      const alamat = `${config.AI_BASE_URL.replace(/\/+$/, "")}/chat/completions`;
      // Isi permintaan sengaja minimal supaya jalan di penyedia mana pun: tanpa temperature dan max_tokens
      // (model berpikir bisa menghabiskan batas token sebelum menjawab).
      const badan: Record<string, unknown> = { model: req.model, messages: req.messages };
      if (config.AI_REASONING_EFFORT) badan.reasoning_effort = config.AI_REASONING_EFFORT;

      let res: Response;
      try {
        res = await fetch(alamat, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.AI_API_KEY}` },
          body: JSON.stringify(badan),
          signal: AbortSignal.timeout(BATAS_WAKTU_MS),
        });
      } catch (err) {
        const habisWaktu = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
        throw new AiGalat(habisWaktu ? "AI tidak menjawab dalam 30 detik" : "AI tidak terjangkau");
      }

      if (!res.ok) {
        const { pesan, harian } = await bacaGalat(res);
        if (res.status === 429) {
          // Kuota harian: jeda lama. Kuota per menit: ikuti Retry-After bila ada, kalau tidak 60 detik.
          const retry = Number(res.headers.get("retry-after"));
          jedakan(harian ? 3600 : Number.isFinite(retry) && retry > 0 ? Math.min(retry, 900) : 60);
        } else if (res.status === 401 || res.status === 403 || (res.status === 400 && /api[\s_-]?key/i.test(pesan))) {
          // Kunci ditolak. Google membalas kunci salah dengan 400 ("Please pass a valid API key"), bukan 401.
          jedakan(600);
        }
        throw new AiGalat(`AI membalas ${res.status}${pesan ? `: ${pesan}` : ""}`, res.status);
      }

      const data: any = await res.json().catch(() => null);
      const teks = data?.choices?.[0]?.message?.content;
      if (typeof teks !== "string" || !teks.trim()) throw new AiGalat("AI mengembalikan balasan kosong");
      return teks;
    },
  };
}

let sungguhan: AiClient | null = null;
let pengganti: AiClient | null = null;

export function getAiClient(): AiClient | null {
  if (pengganti) return pengganti;
  if (!config.AI_API_KEY) return null;
  sungguhan ??= buatKlienHttp();
  return sungguhan;
}

export const aiAktif = () => getAiClient() !== null;

// Hanya untuk pengujian: ganti klien dengan tiruan supaya jalur AI bisa diuji tanpa kunci dan tanpa memakai kuota.
export function setAiClientForTests(client: AiClient | null) {
  pengganti = client;
}

// Ambil objek JSON dari balasan model (boleh dibungkus pagar kode atau diawali kalimat) lalu periksa dengan skema.
// null bila tidak ada JSON atau bentuknya salah: pemanggil lalu memakai cadangan, tidak pernah menebak.
export function uraiJson<T>(teks: string, skema: z.ZodType<T>): T | null {
  const bersih = teks.replace(/```(?:json)?/gi, "");
  const awal = bersih.indexOf("{");
  const akhir = bersih.lastIndexOf("}");
  if (awal === -1 || akhir <= awal) return null;
  try {
    const hasil = skema.safeParse(JSON.parse(bersih.slice(awal, akhir + 1)));
    return hasil.success ? hasil.data : null;
  } catch {
    return null;
  }
}

// Penghitung panggilan per hari (WIB). Tersimpan di memori server: reset saat server mulai ulang, cukup sebagai
// pengaman kuota gratis, bukan sebagai data penagihan.
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
    // Kembalikan jatah bila panggilan gagal sebelum sampai ke penyedia AI.
    kembalikan() {
      if (terpakai > 0) terpakai--;
    },
  };
}
