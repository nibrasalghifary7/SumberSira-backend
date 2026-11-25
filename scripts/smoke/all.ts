/**
 * Menjalankan seluruh smoke test P0-P18 secara berurutan.
 * Berhenti pada kegagalan pertama dan mengembalikan exit code sesuai.
 *
 * Pemakaian: npx tsx scripts/smoke/all.ts  (atau: npm run smoke)
 */
import { spawnSync } from "node:child_process";
import path from "node:path";

const PHASES = [
  "p0",
  "p1",
  "p2",
  "p3",
  "p4",
  "p5",
  "p6",
  "p7",
  "p8",
  "p9",
  "p10",
  "p11",
  "p12",
  "p13",
  "p14",
  "p15",
  "p16",
  "p17",
  "p18",
];

function main() {
  const tsxCli = require.resolve("tsx/cli");

  const results: Array<{ phase: string; status: string }> = [];

  for (const phase of PHASES) {
    const script = path.resolve(__dirname, `${phase}.ts`);
    console.log("\n" + "=".repeat(60));
    console.log(`>>> Menjalankan smoke ${phase}`);
    console.log("=".repeat(60));

    const res = spawnSync(process.execPath, [tsxCli, script], {
      stdio: "inherit",
      // Smoke test tidak boleh memakai kunci AI asli (menghabiskan kuota gratis dan jawabannya tidak pasti), jadi AI
      // dimatikan untuk semua fase. Uji AI (p16-p18) memakai klien tiruan atau server tiruan sendiri.
      env: { ...process.env, AI_API_KEY: "" },
    });

    if (res.status === 0) {
      results.push({ phase, status: "LULUS" });
    } else {
      results.push({ phase, status: `GAGAL (exit ${res.status})` });
      console.log("\n=== Ringkasan (berhenti di kegagalan pertama) ===");
      for (const r of results) console.log(`  ${r.phase}: ${r.status}`);
      process.exit(res.status ?? 1);
    }
  }

  console.log("\n=== Ringkasan ===");
  for (const r of results) console.log(`  ${r.phase}: ${r.status}`);
  console.log(`\nSemua ${results.length} fase smoke test LULUS.`);
}

main();
