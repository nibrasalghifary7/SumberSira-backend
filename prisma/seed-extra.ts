import { db } from "../src/lib/db.js";
import { DEFAULT_PRICING } from "../src/lib/pricing.js";

const DEFAULT_QUICK_QUESTIONS = [
  "Jam buka?",
  "Cara sewa ATV?",
  "Harga tiket?",
  "Parkir bus?",
];

async function main() {
  console.log("Menjalankan seed:extra...");

  // 1. Setting pricing
  const existingPricing = await db.setting.findUnique({
    where: { key: "pricing" },
  });
  if (!existingPricing) {
    await db.setting.create({
      data: {
        key: "pricing",
        value: DEFAULT_PRICING,
      },
    });
    console.log("- Setting pricing ditambahkan.");
  } else {
    console.log("- Setting pricing sudah ada (dilewati).");
  }

  // 2. Setting quickQuestions
  const existingQuickQuestions = await db.setting.findUnique({
    where: { key: "quickQuestions" },
  });
  if (!existingQuickQuestions) {
    await db.setting.create({
      data: {
        key: "quickQuestions",
        value: DEFAULT_QUICK_QUESTIONS,
      },
    });
    console.log("- Setting quickQuestions ditambahkan.");
  } else {
    console.log("- Setting quickQuestions sudah ada (dilewati).");
  }

  // 3. Review awal (P6)
  const reviewCount = await db.review.count();
  if (reviewCount === 0) {
    await db.review.createMany({
      data: [
        {
          name: "Bu Rani S.",
          stars: 5,
          text: "Airnya jernih banget, anak-anak senang main di kolam!",
        },
        {
          name: "Dimas P.",
          stars: 4,
          text: "Spot foto oke, tapi pas siang rame banget.",
        },
        {
          name: "Kel. Ahmad",
          stars: 5,
          text: "Sewa ATV gampang lewat app, ga perlu antre.",
        },
      ],
    });
    console.log("- 3 Ulasan awal ditambahkan.");
  } else {
    console.log("- Ulasan sudah ada (dilewati).");
  }

  // 4. FAQ awal (P7)
  const faqCount = await db.faq.count();
  if (faqCount === 0) {
    const defaultFaqs = [
      {
        keys: ["riwayat", "whatsapp", "tiket saya", "hilang"],
        answer: "Buka Tiket & Booking lalu cari dengan nomor WhatsApp yang dipakai saat beli. Tidak perlu login.",
        sortOrder: 1,
      },
      {
        keys: ["jam", "buka", "tutup", "weekend", "weekday"],
        answer: "Weekday buka 08.00-16.00, weekend 08.00-17.00 ya!",
        sortOrder: 2,
      },
      {
        keys: ["harga", "tiket", "htm", "bayar masuk", "balita"],
        answer: "Tiket masuk Rp5.000 per orang untuk usia 3 tahun ke atas. Balita gratis.",
        sortOrder: 3,
      },
      {
        keys: ["qris", "tunai", "cash", "pembayaran"],
        answer: "Tiket masuk bisa QRIS atau tunai di loket. Sewa dan wahana dibayar lewat QRIS.",
        sortOrder: 4,
      },
      {
        keys: ["fasilitas", "gazebo", "musholla", "kolam anak"],
        answer: "Ada kolam mata air, kolam anak, gazebo, dan musholla.",
        sortOrder: 5,
      },
      {
        keys: ["atv", "sewa", "ban", "wahana", "booking"],
        answer: "Buka Tiket & Booking, pilih jam, tambah item, lalu tekan Lanjut Booking.",
        sortOrder: 6,
      },
      {
        keys: ["parkir", "bus", "mobil", "motor"],
        answer: "Parkir motor 3rb, mobil 10rb, bus 20rb.",
        sortOrder: 7,
      },
      {
        keys: ["ramai", "sepi", "crowd", "penuh"],
        answer: "Lihat grafik keramaian di Beranda. Biasanya paling sepi pukul 08.00-09.00 atau setelah 15.00.",
        sortOrder: 8,
      },
    ];

    await db.faq.createMany({
      data: defaultFaqs,
    });
    console.log("- 8 FAQ awal ditambahkan.");
  } else {
    console.log("- FAQ sudah ada (dilewati).");
  }

  console.log("seed:extra selesai.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
