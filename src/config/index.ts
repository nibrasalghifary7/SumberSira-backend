import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL wajib diisi"),
  PORT: z.coerce.number().default(4000),
  ADMIN_ORIGIN: z.string().default("http://localhost:3000"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  TRUST_PROXY: z.coerce.number().default(0),
  PUBLIC_BASE_URL: z.string().default(""),
  // Izinkan tombol "Saya Sudah Bayar" (simulate-pay) di produksi. Hanya untuk demo/tugas;
  // biarkan false bila pembayaran sungguhan (Midtrans) dipakai.
  ALLOW_SIMULATE_PAY: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  // Alamat tambahan yang boleh memanggil API (dipisah koma), mis. web Flutter yang dideploy.
  EXTRA_ORIGINS: z.string().default(""),
  PAYMENT_MODE: z.enum(["simulation", "midtrans"]).default("simulation"),
  MIDTRANS_ENV: z.enum(["sandbox", "production"]).default("sandbox"),
  MIDTRANS_SERVER_KEY: z.string().default(""),
  MIDTRANS_CLIENT_KEY: z.string().default(""),
  STORAGE_DRIVER: z.enum(["local", "vercel-blob"]).default("local"),
  BLOB_READ_WRITE_TOKEN: z.string().default(""),
  // Fitur AI (hanya dua: chatbot Tanya Sira dan perbaikan foto), memakai tier GRATIS Google Gemini lewat antarmuka
  // yang kompatibel dengan OpenAI. Tanpa kunci, keduanya tetap jalan memakai cadangan tanpa AI: chatbot menjawab dari
  // FAQ kata kunci, foto diperbaiki dengan pengolahan gambar otomatis. Jangan hubungkan akun penagihan ke kuncinya.
  AI_API_KEY: z.string().default(""),
  // Alamat API. Bawaan Gemini; penyedia gratis lain yang kompatibel (mis. Groq, OpenRouter) cukup ganti alamat, kunci, dan model.
  AI_BASE_URL: z.string().url().default("https://generativelanguage.googleapis.com/v1beta/openai"),
  // Model untuk chatbot dan untuk membaca foto (gemini-3.5-flash-lite gratis dan paling longgar kuotanya).
  CHAT_MODEL: z.string().default("gemini-3.5-flash-lite"),
  PHOTO_AI_MODEL: z.string().default("gemini-3.5-flash-lite"),
  // Opsional: tingkat berpikir model (minimal, low, medium, high). Kosong = bawaan model; kosongkan bila penyedia menolaknya.
  AI_REASONING_EFFORT: z.string().default(""),
  // Batas panggilan AI per hari (WIB) supaya kuota gratis tidak habis oleh sedikit pengguna; lewat batas, fitur beralih
  // ke cadangan tanpa AI. 0 = matikan AI.
  CHAT_AI_DAILY_LIMIT: z.coerce.number().int().min(0).default(150),
  PHOTO_AI_DAILY_LIMIT: z.coerce.number().int().min(0).default(100),
}).superRefine((data, ctx) => {
  if (data.PAYMENT_MODE === "midtrans" && !data.MIDTRANS_SERVER_KEY) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "MIDTRANS_SERVER_KEY wajib diisi bila PAYMENT_MODE=midtrans",
      path: ["MIDTRANS_SERVER_KEY"],
    });
  }
  if (data.STORAGE_DRIVER === "vercel-blob" && !data.BLOB_READ_WRITE_TOKEN) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "BLOB_READ_WRITE_TOKEN wajib diisi bila STORAGE_DRIVER=vercel-blob",
      path: ["BLOB_READ_WRITE_TOKEN"],
    });
  }
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Konfigurasi environment tidak valid:", parsed.error.format());
  process.exit(1);
}

export const config = parsed.data;
