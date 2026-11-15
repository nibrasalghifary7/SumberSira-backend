import { db } from "./db.js";

/**
 * Menghasilkan nomor urut berikutnya secara atomik menggunakan raw SQL (ON CONFLICT DO UPDATE).
 * Panggilan pertama mengembalikan initial, berikutnya naik 1.
 */
export async function nextSeq(key: string, initial: number): Promise<number> {
  const result = await db.$queryRaw<Array<{ value: number }>>`
    INSERT INTO "Counter" ("key", "value")
    VALUES (${key}, ${initial})
    ON CONFLICT ("key") DO UPDATE
    SET "value" = "Counter"."value" + 1
    RETURNING "value";
  `;

  return result[0].value;
}
