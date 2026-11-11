// Cadangan untuk `npx prisma migrate deploy`: menerapkan file di prisma/migrations lewat driver `pg`.
// Dipakai bila Prisma CLI menjawab P1001 (tidak bisa menjangkau database) padahal internet jalan. Penyebab yang umum:
// jaringan punya IPv6 yang tidak bisa dipakai, Prisma mencoba IPv6 dulu dan menunggu sampai habis waktu, sedangkan `pg` jatuh ke IPv4.
//
// Hasilnya sama dengan migrate deploy: hanya migrasi yang belum tercatat yang dijalankan, tiap migrasi dalam satu transaksi,
// lalu dicatat di tabel _prisma_migrations (checksum sha256 isi file), jadi `prisma migrate status` tetap konsisten.
// DB_SCHEMA (opsional) menerapkan ke schema Postgres tertentu, mis. untuk uji coba.
import "dotenv/config";
import { createHash, randomUUID } from "node:crypto";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

const dir = join(process.cwd(), "prisma", "migrations");
const schema = process.env.DB_SCHEMA || "public";
if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) throw new Error("DB_SCHEMA tidak valid");

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL belum diisi di .env");
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 30_000 });
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    await client.query(`CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
      "id" VARCHAR(36) PRIMARY KEY NOT NULL,
      "checksum" VARCHAR(64) NOT NULL,
      "finished_at" TIMESTAMPTZ,
      "migration_name" VARCHAR(255) NOT NULL,
      "logs" TEXT,
      "rolled_back_at" TIMESTAMPTZ,
      "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "applied_steps_count" INTEGER NOT NULL DEFAULT 0
    )`);
    const done = new Set<string>(
      (await client.query(`SELECT "migration_name" FROM "_prisma_migrations" WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL`)).rows.map(
        (r) => r.migration_name as string,
      ),
    );

    const names = readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(join(dir, d.name, "migration.sql")))
      .map((d) => d.name)
      .sort();

    let applied = 0;
    for (const name of names) {
      if (done.has(name)) continue;
      const sql = readFileSync(join(dir, name, "migration.sql"), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      console.log(`Menerapkan ${name} ...`);
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          `INSERT INTO "_prisma_migrations" ("id","checksum","migration_name","finished_at","applied_steps_count") VALUES ($1,$2,$3,now(),1)`,
          [randomUUID(), checksum, name],
        );
        await client.query("COMMIT");
        applied++;
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      }
    }
    console.log(applied === 0 ? `Sudah terbaru (${names.length} migrasi).` : `Selesai: ${applied} migrasi baru diterapkan.`);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error("Gagal menerapkan migrasi:", e instanceof Error ? e.message : e);
  process.exit(1);
});
