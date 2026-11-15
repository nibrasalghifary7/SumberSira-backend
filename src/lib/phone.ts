/**
 * Normalisasi nomor WhatsApp sesuai asumsi A2:
 * - Hapus semua non-digit
 * - Jika diawali "62", ganti jadi "0"
 * - Hasil harus cocok dengan regex /^0\d{9,13}$/
 */
export function normalizeWa(input: string): string | null {
  if (typeof input !== "string") return null;
  let digits = input.replace(/\D/g, "");

  if (digits.startsWith("62")) {
    digits = "0" + digits.slice(2);
  }

  if (/^0\d{9,13}$/.test(digits)) {
    return digits;
  }

  return null;
}
