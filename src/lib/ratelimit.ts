// Pembatas permintaan sederhana di memori (jendela geser): maksimal `max` kali dalam `windowMs` untuk satu kunci.
// Dipakai pada endpoint publik chatbot supaya satu perangkat tidak bisa menghabiskan kuota AI.
const hits = new Map<string, number[]>();

export function allow(key: string, max: number, windowMs: number, now = Date.now()): boolean {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  // Bersihkan kunci lama sesekali supaya map tidak membesar.
  if (hits.size > 5000) for (const [k, v] of hits) if (v.every((t) => now - t >= windowMs)) hits.delete(k);
  return true;
}
