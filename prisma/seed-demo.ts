// Data contoh untuk mencoba grafik keramaian: tiket hari ini dengan jam masuk dan keluar yang tersebar.
// Aman diulang: tiket contoh dikenali dari nomor WhatsApp 0899000xxxx dan dihapus dulu sebelum dibuat ulang.
// Jangan dijalankan di database yang sudah dipakai pengunjung sungguhan kalau grafiknya tidak ingin tercampur.
import { db } from "../src/lib/db.js";
import { ticketTotal } from "../src/lib/pricing.js";
import { wibAt, wibDate } from "../src/lib/time.js";

const NAMES = ["Rina", "Budi", "Sari", "Agus", "Dewi", "Fajar", "Lina", "Rudi", "Maya", "Hendra", "Putri", "Eko", "Nia", "Joko", "Wulan", "Dimas", "Tika", "Bayu", "Ayu", "Rizki"];

async function main() {
  const now = new Date();
  const today = wibDate(now);
  await db.ticket.deleteMany({ where: { whatsapp: { startsWith: "0899000" } } });

  let n = 0;
  for (const [i, name] of NAMES.entries()) {
    const adults = 1 + (i % 4);
    const kids = i % 3 === 0 ? 1 : 0;
    const parking = (["motor", "mobil", "none", "bus"] as const)[i % 4];
    // Datang tiap ~25 menit mulai 08.10; tinggal 60 sampai 150 menit.
    const inAt = wibAt(today, 8, 10 + i * 25);
    const outAt = new Date(inAt.getTime() + (60 + (i % 4) * 30) * 60_000);
    const entered = inAt <= now;
    const left = entered && outAt <= now;
    await db.ticket.create({
      data: {
        name,
        whatsapp: `0899000${String(1000 + i)}`,
        adults,
        kids,
        parking,
        payment: i % 2 ? "cash" : "qris",
        total: ticketTotal(adults, parking),
        arrival: "08.00 - 10.00",
        visitDate: today,
        status: left ? "out" : entered ? "inside" : "waiting",
        boughtAt: new Date(Math.min(inAt.getTime(), now.getTime()) - 3600_000),
        checkInAt: entered ? inAt : null,
        checkOutAt: left ? outAt : null,
      },
    });
    n++;
  }
  console.log(`Data contoh: ${n} tiket untuk ${today}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
