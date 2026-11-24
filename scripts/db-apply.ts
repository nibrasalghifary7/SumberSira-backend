/**
 * Menerapkan migrasi Prisma lewat driver `pg` (pengganti `prisma migrate deploy`).
 *
 * Berguna di jaringan yang IPv6-nya macet ke Neon (Prisma CLI menjawab P1001 padahal driver pg jalan lewat IPv4),
 * dan untuk menyiapkan schema uji yang terpisah dari data asli.
 *
 * Pemakaian:
 *   npm run db:apply                          # schema bawaan (public), sama seperti migrate deploy
 *   DB_SCHEMA=dean_dev npm run db:apply       # schema uji; hapus lagi dengan: DROP SCHEMA dean_dev CASCADE
 *
 * Catatan: format tabel _prisma_migrations sama dengan milik Prisma, jadi migrate deploy tetap bisa dipakai sesudahnya.
 */
import "dotenv/config";
import { createHash, randomUUID } from "node:crypto";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL wajib diisi");
  const schema = process.env.DB_SCHEMA?.trim() || "public";
  if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) throw new Error(`Nama schema tidak valid: ${schema}`);

  const dir = path.resolve(__dirname, "../prisma/migrations");
  const names = readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(path.join(dir, d.name, "migration.sql")))
    .map((d) => d.name)
    .sort();

  const client = new Client({ connectionString: url, connectionTimeoutMillis: 30_000 });
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
        "id" VARCHAR(36) PRIMARY KEY NOT NULL,
        "checksum" VARCHAR(64) NOT NULL,
        "finished_at" TIMESTAMPTZ,
        "migration_name" VARCHAR(255) NOT NULL,
        "logs" TEXT,
        "rolled_back_at" TIMESTAMPTZ,
        "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "applied_steps_count" INTEGER NOT NULL DEFAULT 0
      )`);
    const done = new Set((await client.query(`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`)).rows.map((r) => r.migration_name));

    let applied = 0;
    for (const name of names) {
      if (done.has(name)) continue;
      const sql = readFileSync(path.join(dir, name, "migration.sql"), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          `INSERT INTO "_prisma_migrations" (id, checksum, migration_name, finished_at, applied_steps_count) VALUES ($1, $2, $3, now(), 1)`,
          [randomUUID(), checksum, name],
        );
        await client.query("COMMIT");
        applied++;
        console.log(`  diterapkan: ${name}`);
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`Migrasi ${name} gagal: ${(err as Error).message}`);
      }
    }
    console.log(`Schema "${schema}": ${applied} migrasi baru diterapkan, ${names.length - applied} sudah ada.`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
