import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client.js";

// Koneksi ke Neon (jauh) mahal: sambung ulang bisa makan beberapa detik. Bawaan pg menutup koneksi yang menganggur 10 detik,
// sehingga halaman yang dibuka setelah jeda sebentar terasa macet. Koneksi dibiarkan hidup 4 menit (di bawah batas
// 5 menit sebelum Neon tidur sendiri), jadi pindah halaman tetap cepat selama panel masih dipakai.
// DB_SCHEMA (opsional) mengarahkan semua query ke schema lain, mis. dean_dev untuk uji tanpa menyentuh data asli di public.
// Opsi schema milik Prisma hanya berlaku untuk query buatan Prisma; query mentah (nextSeq memakai INSERT ... "Counter")
// mengikuti search_path koneksi. Karena itu search_path juga diset di koneksi, kalau tidak, nomor urut uji akan
// tertulis ke tabel asli di schema public.
const SCHEMA_UJI = process.env.DB_SCHEMA?.trim() || "";
if (SCHEMA_UJI && !/^[a-z_][a-z0-9_]*$/i.test(SCHEMA_UJI)) throw new Error(`DB_SCHEMA tidak valid: ${SCHEMA_UJI}`);
const adapter = new PrismaPg(
  {
    connectionString: process.env.DATABASE_URL,
    max: 5,
    idleTimeoutMillis: 240_000,
    connectionTimeoutMillis: 30_000,
    keepAlive: true,
    ...(SCHEMA_UJI ? { options: `-c search_path=${SCHEMA_UJI}` } : {}),
  },
  SCHEMA_UJI ? { schema: SCHEMA_UJI } : undefined,
);

// Neon bisa memutus koneksi yang diam (compute tidur atau restart) sementara kolam koneksi masih menyimpannya.
// Permintaan berikutnya lalu gagal "Server has closed the connection" (P1017) dan pengunjung melihat galat 500 sekali,
// padahal percobaan kedua langsung berhasil. Galat koneksi sementara diulang otomatis:
//  - P1001 (server tak terjangkau): permintaan belum sampai ke server, aman diulang untuk semua operasi.
//  - P1002 (waktu habis), P1017 (koneksi ditutup server), dan P2024 (kolam penuh): hanya operasi baca Prisma yang diulang,
//    karena tulis mungkin sudah berjalan di server dan bisa berlipat ganda bila diulang.
//    Query mentah ($queryRaw) tidak termasuk: nextSeq memakainya untuk INSERT ... RETURNING, jadi mengulangnya bisa melompatkan nomor.
const SELALU_ULANG = new Set(["P1001"]);
const ULANG_BACA = new Set(["P1002", "P1017", "P2024"]);
const OPERASI_BACA = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
]);
const MAKS_ULANG = 2;
const tunggu = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const db = new PrismaClient({ adapter }).$extends({
  query: {
    $allOperations: async ({ operation, args, query }) => {
      for (let percobaan = 0; ; percobaan++) {
        try {
          return await query(args);
        } catch (err) {
          const kode = (err as { code?: string } | null)?.code ?? "";
          const bolehUlang = SELALU_ULANG.has(kode) || (ULANG_BACA.has(kode) && OPERASI_BACA.has(operation));
          if (!bolehUlang || percobaan >= MAKS_ULANG) throw err;
          await tunggu(300 * (percobaan + 1));
        }
      }
    },
  },
});
