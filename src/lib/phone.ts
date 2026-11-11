// Nomor WhatsApp Indonesia dirapikan ke bentuk 08xxxxxxxxxx: "+62 812-3456-7890" dan "6281234567890" jadi "081234567890".
// Dipakai untuk mencari riwayat tiket per nomor, jadi semua format harus menghasilkan nomor yang sama.
export function normalizeWhatsapp(raw: string): string {
  let n = String(raw).replace(/[^\d+]/g, "").replace(/\+/g, "");
  if (n.startsWith("62")) n = "0" + n.slice(2);
  else if (n.startsWith("8")) n = "0" + n;
  return n;
}

// Nomor Indonesia: diawali 08, total 10 sampai 14 angka (sama dengan validasi di aplikasi).
export const isValidWhatsapp = (normalized: string): boolean => /^08\d{8,12}$/.test(normalized);
