// Mencocokkan pertanyaan pengunjung dengan FAQ buatan pengelola, tanpa AI (jawaban cepat).
// Cara kerja: pertanyaan dan FAQ dipecah jadi kata penting (tanpa kata sambung), lalu dicari yang paling banyak kata samanya.

// Kata yang tidak membedakan arti pertanyaan, termasuk nama tempat yang ada di hampir semua pertanyaan.
const STOP = new Set([
  "apa", "apakah", "bagaimana", "gimana", "berapa", "kapan", "dimana", "mana", "yang", "di", "ke", "dari", "dan", "atau", "ada", "adalah",
  "itu", "ini", "bisa", "boleh", "kah", "dong", "deh", "sih", "ya", "kak", "min", "admin", "mau", "ingin", "tanya", "tolong", "saya", "aku",
  "kami", "kita", "untuk", "dengan", "pada", "sumber", "sira", "nya", "lah", "gak", "nggak", "tidak", "apa", "saja", "aja", "dong",
]);

// Huruf kecil, tanpa tanda baca, tanpa akhiran -nya/-kah/-lah.
export function tokens(text: string): string[] {
  const words = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .map((w) => w.replace(/(nya|kah|lah)$/, ""))
    .filter((w) => w.length >= 2 && !STOP.has(w));
  return [...new Set(words)];
}

export type FaqLike = { question: string; answer: string; keywords?: string };

// Cocok bila minimal 2 kata penting sama dan sedikitnya 75% kata dari sisi yang lebih pendek ada di sisi lainnya.
// Pertanyaan yang cuma satu kata penting boleh cocok bila FAQ-nya juga satu kata penting.
export function matchFaq<T extends FaqLike>(question: string, faqs: T[]): { faq: T; score: number } | null {
  const a = new Set(tokens(question));
  if (a.size === 0) return null;
  let best: { faq: T; score: number; overlap: number } | null = null;
  for (const faq of faqs) {
    const f = new Set(tokens(`${faq.question} ${faq.keywords ?? ""}`));
    if (f.size === 0) continue;
    let overlap = 0;
    for (const w of a) if (f.has(w)) overlap++;
    const small = Math.min(a.size, f.size);
    const score = overlap / small;
    const enough = overlap >= 2 || (overlap === 1 && small === 1);
    if (!enough || score < 0.75) continue;
    if (!best || score > best.score || (score === best.score && overlap > best.overlap)) best = { faq, score, overlap };
  }
  return best && { faq: best.faq, score: best.score };
}
