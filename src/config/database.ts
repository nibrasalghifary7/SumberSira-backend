import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client.js";

// Koneksi ke Neon (jauh) mahal: sambung ulang bisa makan beberapa detik. Bawaan pg menutup koneksi yang menganggur 10 detik,
// sehingga halaman yang dibuka setelah jeda sebentar terasa macet. Koneksi dibiarkan hidup 4 menit (di bawah batas
// 5 menit sebelum Neon tidur sendiri), jadi pindah halaman tetap cepat selama panel masih dipakai.
const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 240_000,
  connectionTimeoutMillis: 30_000,
  keepAlive: true,
});

export const db = new PrismaClient({ adapter });