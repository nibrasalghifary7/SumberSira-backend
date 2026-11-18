# Instruksi Kerja Lanjutan: Konfigurasi Produksi & Kesiapan Midtrans

> **Cara pakai (untuk manusia):** buka repo `SumberSira-backend` di opencode, lalu kirim prompt:
> "Baca `planning/lanjutan-config-midtrans.md` dan kerjakan Task 1 sampai Task 5 berurutan.
> Satu task satu commit. Berhenti dan laporkan setelah setiap task, jangan lanjut tanpa perintah 'lanjut'."
>
> Dokumen ini melengkapi `planning/planning.md`. Aturan di bagian 0 dokumen itu tetap berlaku
> (satu fase satu waktu, gerbang mutu, berhenti dan tanya bila ragu).

---

## Konteks dan batasan

Repo ini adalah backend Express + TypeScript + Prisma + PostgreSQL (Neon) untuk aplikasi Sumber Sira.
Dua klien sudah berjalan dan **kontrak API tidak boleh berubah**:

- Aplikasi pengunjung Flutter (`mobile/` di repo `SumberSira`) memanggil backend langsung.
- Web admin Next.js (repo `SumberSira`) memanggil backend dari server Next.js.

Semua perubahan di bawah ini bersifat **konfigurasi, keamanan, dan pesan galat** — bukan perubahan fitur.
Jangan mengubah bentuk JSON balasan, nama field, atau path endpoint yang sudah dipakai klien.

**Bukti masalah yang sudah ditemukan (jangan diragukan lagi):**

1. `POST` tanpa body dari klien mengirim teks `"null"` dengan header `content-type: application/json`.
   `body-parser` menolaknya (`entity.parse.failed`), lalu `src/lib/errors.ts` membalas **500 INTERNAL**
   padahal itu galat pemanggil (400). Ini membuat aksi "tandai sudah bayar" (mode simulasi) gagal
   di aplikasi pengunjung sebelum diperbaiki di sisi klien.
2. URL foto dibentuk di `src/lib/storage/index.ts` sebagai
   `config.PUBLIC_BASE_URL || http://localhost:${config.PORT}`. Bila `PUBLIC_BASE_URL` kosong,
   foto galeri dan hasil AI Photo menunjuk `localhost` sehingga tidak muncul di HP/emulator.
3. `ADMIN_ORIGIN` hanya menerima **satu** origin, padahal produksi bisa punya web admin + app web
   pengunjung di dua domain berbeda.

---

## Task 1 — CORS menerima daftar origin

**Tujuan:** `ADMIN_ORIGIN` boleh berisi lebih dari satu origin, dipisah koma.

Kebutuhan:

1. `src/config.ts`: tetap `z.string()`, tetapi tambahkan transformasi/parse menjadi daftar:
   - pisah dengan koma, `trim()`, buang garis miring di akhir (`https://a.com/` → `https://a.com`),
   - buang entri kosong, deduplikasi (case-insensitive pada skema + host).
2. `src/app.ts`: callback `cors` mengizinkan origin bila:
   - tidak ada header `Origin` (Postman, klien mobile, server-ke-server) → izinkan,
   - `NODE_ENV !== "production"` dan origin cocok `^http://localhost:\d+$` → izinkan,
   - origin ada di daftar `ADMIN_ORIGIN`.
   Selain itu `cb(null, false)` (jangan melempar error).
3. Jangan mengaktifkan `credentials` untuk origin di luar daftar.

**Selesai bila:**

- `ADMIN_ORIGIN="https://admin.contoh.com,https://app.contoh.com"` mengizinkan kedua origin
  (cek header `Access-Control-Allow-Origin` pada respons preflight dan respons biasa).
- Origin lain tetap ditolak tanpa error 500.
- Ada smoke test baru (atau tambahan di `scripts/smoke/`) yang membuktikan ketiga kasus di atas.
- `npx tsc --noEmit` bersih.

---

## Task 2 — `PUBLIC_BASE_URL` wajib dan valid

**Tujuan:** mencegah server produksi menyajikan URL foto yang menunjuk `localhost`.

Kebutuhan:

1. `src/config.ts` (`superRefine`):
   - Bila `NODE_ENV === "production"` **dan** `STORAGE_DRIVER === "local"` **dan** `PUBLIC_BASE_URL`
     kosong → gagal start dengan pesan jelas, mis.
     "PUBLIC_BASE_URL wajib diisi di produksi agar URL foto dapat diakses pengunjung."
   - Bila `PUBLIC_BASE_URL` diisi, harus URL `http://` atau `https://` yang valid dan **tanpa**
     garis miring di akhir (normalisasi, bukan tolak).
   - `development` tetap boleh kosong (memakai `http://localhost:PORT`).
2. Pastikan semua pemakaian `PUBLIC_BASE_URL` memakai nilai yang sudah dinormalisasi
   (URL foto di `src/lib/storage/index.ts` dan header `X-Override-Notification` di
   `src/payments/index.ts`).
3. Tambahkan komentar singkat di `src/config.ts` bahwa variabel ini dipakai untuk dua hal tersebut.

**Selesai bila:**

- Menjalankan server dengan `NODE_ENV=production STORAGE_DRIVER=local PUBLIC_BASE_URL=` berhenti
  dengan pesan yang menyebut variabelnya.
- `PUBLIC_BASE_URL="https://api.contoh.com/"` bekerja dan menghasilkan URL foto tanpa `//` ganda.
- `npx tsc --noEmit` bersih.

---

## Task 3 — JSON rusak dibalas 400, bukan 500

**Tujuan:** `src/lib/errors.ts` tidak menyamakan galat pemanggil dengan galat internal.

Kebutuhan:

1. Di `errorHandler`, kenali galat dari `body-parser`:
   - `err.type === "entity.parse.failed"` (body bukan JSON valid, termasuk `"null"` karena parser
     memakai mode strict),
   - `err.type === "entity.too.large"` → 413 `{ error: "VALIDATION" }`,
   - galat lain yang membawa `status`/`statusCode` 4xx → balas kode itu dengan `{ error: "VALIDATION" }`.
2. Hanya galat 5xx / tak dikenal yang di-log `Internal Server Error` dan dibalas 500 `INTERNAL`.
3. **Jangan** membocorkan isi body atau stack ke respons.

**Selesai bila:**

- `curl -X POST http://localhost:4000/chat -H "content-type: application/json" -d "null"`
  membalas **400** `{ "error": "VALIDATION" }`, dan log server tidak menulis "Internal Server Error".
- Body JSON valid tetapi isian salah tetap 400 seperti sekarang.
- Ada smoke test untuk kasus ini.
- `npx tsc --noEmit` bersih.

---

## Task 4 — `.env.example` dan README lengkap

**Tujuan:** orang baru bisa menyalakan backend hanya dari dokumentasi.

Kebutuhan:

1. ` .env.example`: semua variabel yang dibaca `src/config.ts`, dengan komentar singkat per variabel:
   `DATABASE_URL`, `PORT`, `ADMIN_ORIGIN` (boleh daftar dipisah koma), `NODE_ENV`, `TRUST_PROXY`,
   `PUBLIC_BASE_URL`, `PAYMENT_MODE`, `MIDTRANS_ENV`, `MIDTRANS_SERVER_KEY`, `MIDTRANS_CLIENT_KEY`,
   `STORAGE_DRIVER`, `BLOB_READ_WRITE_TOKEN`.
2. `README.md`: bagian **Konfigurasi** berisi tabel: nama variabel, wajib/tidak, contoh, penjelasan.
   Tekankan:
   - `PUBLIC_BASE_URL` dipakai untuk URL foto **dan** URL notifikasi Midtrans,
   - `PAYMENT_MODE=simulation` (default) vs `midtrans`,
   - jangan pernah commit `.env`, jangan taruh kunci asli di dokumen.
3. Contoh potongan untuk mode Midtrans sandbox (tanpa nilai kunci asli).

**Selesai bila:** README + `.env.example` memuat seluruh variabel dan tidak ada variabel yang
dibaca kode tetapi tidak terdokumentasi (`grep -o "config\.[A-Z_]*" -r src | sort -u`).

---

## Task 5 — Verifikasi kesiapan Midtrans (tanpa refactor besar)

**Tujuan:** memastikan mode Midtrans benar-benar jalan, bukan hanya "ada kode".

Periksa dan perbaiki **hanya bila ada yang salah**:

1. **Charge QRIS** (`src/payments/index.ts` → `midtransProvider.createQris`):
   - memakai `POST /v2/charge` dengan `payment_type: "qris"`, `transaction_details`, `item_details`;
   - mengambil `qr_string` **atau** URL QR dari `actions[]` (mis. `generate-qr-code`) dan
     menyimpannya ke `Payment.qrString` / `Payment.qrUrl`;
   - menghitung `expiresAt` (default 15 menit) dan menyimpannya;
   - menyimpan `providerOrderId` unik (dipakai webhook untuk mencari Payment);
   - galat provider dibalas `PAYMENT_PROVIDER_ERROR`, bukan 500 generik.
2. **Webhook** `POST /payments/midtrans/notification`:
   - signature `sha512(order_id + status_code + gross_amount + MIDTRANS_SERVER_KEY)` dibandingkan
     dengan `timingSafeEqual` (sudah ada),
   - `gross_amount` dicocokkan dengan `payment.amount` (sudah ada),
   - status dikonfirmasi ulang lewat `getStatus(order_id)` sebelum diterapkan (sudah ada),
   - pemetaan `transaction_status` Midtrans:
     `settlement`/`capture` → `paid`, `expire` → `expired`, `cancel` → `cancelled`,
     `deny`/`failure` → `failed`, selain itu diabaikan (balas 200 `{ ok: true, ignored: true }`),
   - idempoten lewat `applyPaymentStatus`.
3. **Polling** `GET /payments/:id`: pada `PAYMENT_MODE=midtrans`, `syncPayment` harus memakai
   `getStatus` sehingga status tetap benar walau webhook telat. Pada mode simulasi perilaku sekarang
   tidak berubah (status `pending` sampai `simulate-pay`).
4. **Mode simulasi tetap utuh**: `POST /payments/:id/simulate-pay` hanya hidup saat
   `PAYMENT_MODE=simulation` dan `NODE_ENV !== "production"`.

**Selesai bila:**

- Ada smoke test webhook: signature valid + status `settlement` → payment `paid`; signature salah → 403;
  amount tidak cocok → diabaikan (200 `ignored`).
- Dokumen singkat di `docs/api.md`: alur Midtrans (charge → QR → webhook → polling) dan status mapping.
- `npx tsc --noEmit` bersih, `npm run smoke` lulus.

---

## Laporan akhir (wajib)

Setelah semua task, tulis laporan dengan format:

1. **Ringkasan** per task: apa yang berubah, file yang disentuh.
2. **Perintah yang dijalankan** dan hasilnya (`npx tsc --noEmit`, `npm run smoke`, uji curl).
3. **Kontrak API**: tegaskan tidak ada perubahan bentuk JSON/path; sebutkan bila ada penambahan field.
4. **Risiko & hal yang belum dikerjakan** (jujur, jangan diklaim selesai bila belum).
5. **Langkah manual yang harus dilakukan manusia** (mis. mengisi kunci Midtrans, mendaftarkan URL webhook).

Jangan commit `.env` atau kunci apa pun. Jangan menyentuh repo frontend.
