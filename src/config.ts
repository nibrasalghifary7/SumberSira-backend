import "dotenv/config";
import { z } from "zod";

/**
 * ADMIN_ORIGIN boleh berisi satu atau beberapa origin dipisah koma.
 * Contoh: "https://admin.sumbersira.id,https://app.sumbersira.id"
 * Hasil: daftar origin tanpa garis miring di akhir, tanpa entri kosong,
 * dan tanpa duplikat (perbandingan case-insensitive).
 */
function parseAdminOrigins(raw: string): string[] {
  const seen = new Set<string>();
  const origins: string[] = [];

  for (const part of raw.split(",")) {
    const origin = part.trim().replace(/\/+$/, "");
    if (!origin) continue;

    const key = origin.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    origins.push(origin);
  }

  return origins;
}

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL wajib diisi"),
  PORT: z.coerce.number().default(4000),
  ADMIN_ORIGIN: z
    .string()
    .default("http://localhost:3000")
    .transform(parseAdminOrigins),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  TRUST_PROXY: z.coerce.number().default(0),
  PUBLIC_BASE_URL: z.string().default(""),
  PAYMENT_MODE: z.enum(["simulation", "midtrans"]).default("simulation"),
  MIDTRANS_ENV: z.enum(["sandbox", "production"]).default("sandbox"),
  MIDTRANS_SERVER_KEY: z.string().default(""),
  MIDTRANS_CLIENT_KEY: z.string().default(""),
  STORAGE_DRIVER: z.enum(["local", "vercel-blob"]).default("local"),
  BLOB_READ_WRITE_TOKEN: z.string().default(""),
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
