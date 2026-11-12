/**
 * Data keramaian demo untuk menguji tampilan Live Crowd.
 *
 * Pemakaian:
 *   npx tsx scripts/demo-crowd.ts add      -> buat 15 tiket demo (isDemo=true),
 *                                             status inside + paid, kunjungan hari ini,
 *                                             total 186 orang.
 *   npx tsx scripts/demo-crowd.ts remove   -> hapus semua tiket demo (isDemo=true).
 */
import { db } from "../src/lib/db.js";
import { jakartaDate } from "../src/lib/time.js";
import { getPricing } from "../src/lib/pricing.js";

const TICKET_COUNT = 15;
const TOTAL_PEOPLE = 186;

// Sebaran yang tetap: 6 tiket 13 orang + 9 tiket 12 orang = 186 orang
const GROUPS: Array<{ adults: number; kids: number }> = [
  ...Array.from({ length: 6 }, () => ({ adults: 10, kids: 3 })),
  ...Array.from({ length: 9 }, () => ({ adults: 9, kids: 3 })),
];

const PARKINGS = ["none", "motor", "mobil"] as const;

async function add() {
  const pricing = await getPricing();
  const visitDate = jakartaDate();

  const slot = await db.timeSlot.findFirst({ orderBy: { id: "asc" } });
  const arrival = slot?.timeRange ?? "08.00 - 10.00";

  const stamp = Date.now().toString(36);
  const rows = GROUPS.slice(0, TICKET_COUNT).map((g, i) => {
    const parking = PARKINGS[i % PARKINGS.length];
    const amount =
      (g.adults + g.kids) * pricing.ticketPricePerPerson + pricing.parking[parking];
    return {
      code: `DEMO-${stamp}-${String(i + 1).padStart(2, "0")}`,
      name: `[DEMO] Pengunjung ${i + 1}`,
      whatsapp: `0810000000${String(i + 1).padStart(2, "0")}`,
      adults: g.adults,
      kids: g.kids,
      parking,
      arrival,
      visitDate,
      amount,
      paymentMethod: "qris" as const,
      paymentStatus: "paid" as const,
      status: "inside" as const,
      checkInAt: new Date(),
      isDemo: true,
    };
  });

  await db.ticket.createMany({ data: rows });

  const people = rows.reduce((sum, r) => sum + r.adults + r.kids, 0);
  console.log(`Ditambahkan ${rows.length} tiket demo (isDemo=true) untuk tanggal ${visitDate}.`);
  console.log(`Total orang di dalam (status inside): ${people}.`);
}

async function remove() {
  const { count } = await db.ticket.deleteMany({ where: { isDemo: true } });
  console.log(`Dihapus ${count} tiket demo (isDemo=true).`);
}

async function main() {
  const arg = process.argv[2];

  if (arg === "add") {
    await add();
  } else if (arg === "remove") {
    await remove();
  } else {
    console.log("Pemakaian: npx tsx scripts/demo-crowd.ts <add|remove>");
    process.exitCode = arg === undefined ? 0 : 1;
  }

  await db.$disconnect();
}

main().catch((err) => {
  console.error("demo-crowd gagal:", err);
  process.exit(1);
});
