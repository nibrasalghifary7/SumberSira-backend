import { db } from "../src/lib/db.js";
import { hashPassword } from "../src/lib/password.js";

const WAHANA = [
  { id: "ban-kecil", name: "Ban Kecil/Sedang", category: "Sewa Alat", price: 5000, unit: "", icon: "ring" },
  { id: "ban-besar", name: "Ban Besar", category: "Sewa Alat", price: 10000, unit: "", icon: "ring-big" },
  { id: "loker", name: "Loker", category: "Sewa Alat", price: 5000, unit: "", icon: "locker" },
  { id: "kereta-sawah", name: "Kereta Sawah", category: "Wahana", price: 10000, unit: "kepala", icon: "train" },
  { id: "bebek-gayung", name: "Bebek Gayung", category: "Wahana", price: 20000, unit: "perahu", icon: "duck" },
  { id: "atv", name: "ATV", category: "Wahana", price: 25000, unit: "15 menit", icon: "atv" },
  { id: "flying-fox", name: "Flying Fox", category: "Wahana", price: 15000, unit: "", icon: "flyingfox" },
  { id: "komedi-putar", name: "Komedi Putar Anak", category: "Wahana", price: 10000, unit: "", icon: "carousel" },
];

const SLOTS = [
  { id: "08-10", label: "08-10", timeRange: "08.00 - 10.00", busy: false },
  { id: "10-12", label: "10-12", timeRange: "10.00 - 12.00", busy: true },
  { id: "12-14", label: "12-14", timeRange: "12.00 - 14.00", busy: true },
  { id: "14-16", label: "14-16", timeRange: "14.00 - 16.00", busy: true },
];

async function main() {
  // Akun demo: samakan email dan password dengan yang tertulis di README frontend
  const accounts = [
  { email: "admin@sumbersira.id", name: "Pengelola", role: "admin" as const, password: "sumbersira" },
  { email: "petugas@sumbersira.id", name: "Petugas Loket", role: "petugas" as const, password: "petugas123" },
];

  for (const a of accounts) {
    const passwordHash = await hashPassword(a.password);
    await db.adminUser.upsert({
      where: { email: a.email },
      update: { name: a.name, role: a.role, passwordHash },
      create: { email: a.email, name: a.name, role: a.role, passwordHash },
    });
  }

  for (const r of WAHANA) {
    await db.ride.upsert({ where: { id: r.id }, update: r, create: r });
  }

  for (const s of SLOTS) {
    await db.timeSlot.upsert({ where: { id: s.id }, update: s, create: s });
  }

  console.log("Seed selesai.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());