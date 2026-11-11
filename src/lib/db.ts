import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client.js";

// DB_SCHEMA (opsional) memakai schema Postgres terpisah, mis. "dean_dev", supaya uji coba tidak menyentuh data asli di "public".
// Kosongkan untuk pemakaian normal.
const schema = process.env.DB_SCHEMA;
// Koneksi ke Neon (jauh) mahal: sambung ulang bisa makan beberapa detik. Bawaan pg menutup koneksi yang menganggur 10 detik,
// sehingga halaman admin yang dibuka setelah jeda sebentar terasa macet. Koneksi dibiarkan hidup 4 menit (di bawah batas
// 5 menit sebelum Neon tidur sendiri), jadi pindah halaman tetap cepat selama admin masih memakai panel.
const adapter = new PrismaPg(
  { connectionString: process.env.DATABASE_URL, max: 5, idleTimeoutMillis: 240_000, connectionTimeoutMillis: 30_000, keepAlive: true },
  schema ? { schema } : undefined,
);

export const db = new PrismaClient({ adapter });
