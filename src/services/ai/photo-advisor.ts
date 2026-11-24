import sharp from "sharp";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { config } from "../../config/index.js";
import type { Saran } from "../photo/engine.js";
import { buatBatasHarian, getAiClient } from "./client.js";

// AI foto (fitur AI nomor 2). Claude MELIHAT foto dan menilai kondisinya seperti seorang retoucher yang memilih slider:
// jenis foto, seberapa berkabut, terang atau gelap, perlu kontras dan warna berapa, dan apakah ada kulit/wajah.
// Claude TIDAK menghasilkan atau mengubah piksel. Hanya angka penilaian, yang dijepit ke rentang aman, dipakai oleh mesin
// pengolahan gambar biasa (src/services/photo/engine.ts). Jadi bentuk, wajah, dan latar tidak mungkin berubah.

export const batasFoto = buatBatasHarian(() => config.PHOTO_AI_DAILY_LIMIT);

const Penilaian = z.object({
  jenis: z.enum(["bawah-air", "luar-ruang", "redup"]).describe("bawah-air bila foto diambil di dalam air; redup bila gelap atau dalam ruangan; selain itu luar-ruang"),
  kabut: z.number().describe("0 sampai 1: seberapa berkabut atau pucat karena lapisan warna di bayangan"),
  eksposur: z.number().describe("-1 sampai 1: negatif bila terlalu gelap, positif bila terlalu terang, 0 bila pas"),
  kontras: z.number().describe("0 sampai 1: seberapa perlu tambahan kontras lokal"),
  warna: z.number().describe("0 sampai 1: seberapa perlu tambahan kepekatan warna"),
  ada_kulit: z.boolean().describe("true bila ada orang (kulit atau wajah) di foto"),
});

const PETUNJUK = `Kamu menilai kondisi teknis sebuah foto wisata untuk retouch otomatis (seperti memilih slider Auto Color, Dehaze, dan Vibrance).
Jawab hanya dengan penilaian angka sesuai skema. Jangan menyarankan mengubah, menghapus, menambah, atau menggeser isi foto: wajah, orang, objek, dan latar harus tetap sama. Nilailah apa adanya dan jangan berlebihan: foto yang sudah bagus diberi nilai kecil.`;

const jepit = (v: number, a: number, b: number) => (Number.isFinite(v) ? Math.min(b, Math.max(a, v)) : a);

// Minta Claude menilai foto. null bila AI tidak tersedia (tanpa kunci, jatah habis, galat): mesin lalu memakai statistik foto saja.
export async function nilaiFoto(foto: Buffer): Promise<Saran | null> {
  const client = getAiClient();
  if (!client) return null;
  if (!batasFoto.ambil()) return null;

  try {
    // Kirim versi kecil saja (hemat token dan waktu); penilaian tidak butuh detail penuh.
    const kecil = await sharp(foto).rotate().resize({ width: 768, height: 768, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
    const res = await client.messages.parse({
      model: config.PHOTO_AI_MODEL,
      max_tokens: 512,
      system: PETUNJUK,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: kecil.toString("base64") } },
            { type: "text", text: "Nilai foto ini." },
          ],
        },
      ],
      output_config: { effort: "low", format: zodOutputFormat(Penilaian) },
    });
    if (res.stop_reason === "refusal" || !res.parsed_output) return null;
    const p = res.parsed_output;
    return {
      mode: p.jenis,
      kabut: jepit(p.kabut, 0, 1),
      eksposur: jepit(p.eksposur, -1, 1),
      kontras: jepit(p.kontras, 0, 1),
      warna: jepit(p.warna, 0, 1),
      adaKulit: p.ada_kulit === true,
    };
  } catch (err) {
    batasFoto.kembalikan();
    console.error("Penilaian foto oleh AI gagal, memakai statistik foto:", err instanceof Error ? err.message : err);
    return null;
  }
}
