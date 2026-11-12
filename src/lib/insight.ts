/**
 * AI Insight berbasis aturan (bukan LLM), melalui antarmuka InsightGenerator
 * supaya bisa diganti layanan LLM sungguhan nanti.
 */

export interface InsightCrowd {
  inside: number;
  percent: number;
  label: string;
}

export interface InsightInput {
  /** Rata-rata bintang 1 desimal (0 jika belum ada ulasan) */
  rating: number;
  reviewCount: number;
  /** Jumlah ulasan berbintang 1-2 dalam 7 hari terakhir */
  lowStarsLast7Days: number;
  crowd: InsightCrowd;
}

export interface InsightGenerator {
  suggest(input: InsightInput): string[];
}

export const ruleBasedInsightGenerator: InsightGenerator = {
  suggest(input) {
    const out: string[] = [];

    if (input.crowd.percent > 75) {
      out.push(
        "Keramaian di atas 75%. Tambah petugas di loket dan sarankan pengunjung datang di jam sepi, misalnya pukul 08.00-09.00 atau setelah 15.00."
      );
    }

    if (input.rating < 4.0) {
      out.push(
        `Rata-rata rating ${input.rating.toFixed(1)} masih di bawah 4,0. Periksa ulasan terbaru dan tindak lanjuti keluhan pengunjung.`
      );
    }

    if (input.lowStarsLast7Days > 0) {
      out.push(
        `Ada ${input.lowStarsLast7Days} ulasan berbintang 1-2 dalam 7 hari terakhir. Segera cari penyebabnya sebelum menurunkan rating.`
      );
    }

    // Jika tidak ada pemicu, satu kalimat netral
    if (out.length === 0) {
      out.push("Semua indikator dalam batas wajar. Pertahankan kualitas layanan.");
    }

    // Maksimal 5 saran
    return out.slice(0, 5);
  },
};
