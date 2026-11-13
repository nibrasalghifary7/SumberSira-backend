/**
 * Menjalankan seluruh smoke test P0-P11 secara berurutan.
 * Berhenti pada kegagalan pertama dan mengembalikan exit code sesuai.
 *
 * Pemakaian: npx tsx scripts/smoke/all.ts  (atau: npm run smoke)
 */
import { spawnSync } from "node:child_process";
import path from "node:path";

const PHASES = ["p0", "p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8", "p9", "p10", "p11", "p12"];

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
      env: process.env,
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
