# planning.md: Menyelesaikan Backend SumberSira

Dokumen ini adalah instruksi kerja untuk agen AI di repo **SumberSira-backend**.
Tujuan: menyelesaikan seluruh backend aplikasi Sumber Sira secara bertahap, per fase, tanpa merusak yang sudah berjalan.

---

## 0. Cara memakai dokumen ini

1. Baca **seluruh** dokumen ini sebelum menulis satu baris kode.
2. Kerjakan **satu fase dalam satu waktu**, berurutan dari P0. Jangan melompat atau menggabungkan fase.
3. Di akhir setiap fase, jalankan **Gerbang Mutu** (bagian 9), tulis **Laporan Fase** (bagian 9), lalu **BERHENTI** dan tunggu perintah "lanjut" dari manusia.
4. Kalau ada yang tidak jelas, bertentangan dengan kode yang ada, atau berisiko merusak data, **berhenti dan tanyakan**. Jangan menebak. Daftar kondisi wajib bertanya ada di bagian 3.
5. Setelah fase selesai dan lolos, centang kotaknya di bagian 10 (satu-satunya bagian dokumen ini yang boleh kamu ubah).

---

## 1. Konteks proyek

**Sumber Sira**: aplikasi wisata mata air di Desa Putukrejo, Malang. Fitur: informasi wisata, Live Crowd, beli tiket masuk, sewa alat dan wahana, galeri foto kiriman pengunjung (divalidasi admin), AI Photo (memperjernih foto), ulasan dan rating, chatbot "Tanya Sira", dan panel admin.

| Komponen | Lokasi | Catatan |
|---|---|---|
| Backend (**repo ini**) | `SumberSira-backend` | Express + TypeScript + Prisma 7 + PostgreSQL (Neon) |
| Web admin | repo `SumberSira` (folder `src/`) | Next.js. Memanggil backend **dari server Next.js**, bukan dari browser |
| Aplikasi pengunjung | repo `SumberSira` (folder `mobile/`) | Flutter. Memanggil backend langsung. **Tanpa login** |

Pengunjung tidak punya akun. Riwayat tiket dan booking dikelompokkan berdasarkan **nomor WhatsApp**.

**Ruang lingkup dokumen ini hanya repo backend.** Jangan menyentuh repo frontend. Kontrak API di sini dipakai tim frontend untuk menyambungkan layar mereka nanti.

---

## 2. Kondisi kode saat ini (fakta; jangan ditebak ulang)

Sudah selesai dan berjalan:

- Server Express, `GET /health`, `GET /health/db`.
- Autentikasi admin dan petugas: `POST /auth/login`, `POST /auth/logout`, `GET /auth/me` (memuat `sessionId`), `GET /auth/sessions`, `POST /auth/sessions/revoke-others`, `DELETE /auth/sessions/:id`.
- Sesi disimpan di database. Cookie `ss_admin_session` (HttpOnly, SameSite=Lax, Secure hanya di produksi). Token disimpan sebagai hash SHA-256.
- Wahana: `GET /rides` (publik, hanya aktif), `GET /time-slots` (publik), `GET/POST/PATCH/DELETE /admin/rides`.
- Model Prisma: `AdminUser`, `AdminSession`, `Ride`, `TimeSlot`, enum `Role { admin petugas }`.
- Seed: `npm run seed` (akun demo, 8 wahana, 4 slot jam).

Struktur file yang ada (verifikasi di P0):

```
prisma/schema.prisma, prisma/migrations/, prisma/seed.ts, prisma.config.ts
src/index.ts                  Menyalakan server; memuat CORS, JSON, cookie-parser, rute
src/lib/db.ts                 export const db (PrismaClient + adapter pg)
src/lib/password.ts           hashPassword, verifyPassword (scrypt)
src/lib/session.ts            COOKIE, sha256, newToken
src/middleware/auth.ts        requireAuth, requireRole("admin" | "petugas")
src/routes/auth.ts            authRouter
src/routes/rides.ts           ridesRouter, slotsRouter, adminRidesRouter
generated/prisma/             Prisma Client hasil generate (tidak di-commit)
```

Fakta teknis penting:

- **ESM** (`"type": "module"`). Import relatif memakai akhiran `.js`, contoh `import { db } from "../lib/db.js"`.
- Dijalankan dengan `tsx` (`npm run dev`). `tsconfig` minimal: target ES2023, module ESNext, moduleResolution bundler, strict.
- Import Prisma Client: `../../generated/prisma/client.js` (dari `src/lib/`). **Lihat isi folder `generated/prisma/` untuk path ekspor enum dan tipe. Jangan menebaknya.**
- `res.locals.user` (tanpa passwordHash) dan `res.locals.sessionId` diisi oleh `requireAuth`.
- Bentuk galat yang sudah dipakai: `{ "error": "KODE_HURUF_BESAR" }`, untuk validasi ditambah `issues`.
- Bentuk data wahana (jangan diubah): `{ id, name, category, price, unit, icon, status: "Aktif" | "Nonaktif" }`.
- Lingkungan pengembang: **Windows 10 + Windows PowerShell 5.1**. Path proyek mengandung spasi.

---

## 3. Aturan wajib

### Larangan mutlak

1. **Jangan membaca, mencetak, mengubah, atau meng-commit `.env`.** Jangan menaruh rahasia di kode, log, laporan, atau dokumen. Di `.env.example` hanya tulis **nama** variabel dengan nilai kosong atau contoh palsu.
2. **Jangan menjalankan perintah destruktif ke database:** `prisma migrate reset`, `prisma db push --force-reset`, `DROP`, `TRUNCATE`, atau `DELETE` tanpa `WHERE`. **Database ini dipakai bersama tim dan berisi data nyata.** Jangan pernah mengedit atau menghapus file migrasi yang sudah ada.
3. **Jangan menjalankan `npm run seed` yang lama** (menimpa harga wahana dan password akun demo). Data awal baru dibuat lewat `npm run seed:extra` (lihat P1) yang hanya menambah data dan tidak menimpa.
4. **Jangan menjalankan `git commit`, `git push`, `git merge`, atau `git checkout` ke branch lain.** Manusia yang melakukannya. Kamu hanya boleh `git status` dan `git diff`.
5. **Jangan memasang atau menaikkan versi paket di luar yang disebut fase.** Khususnya:
   - **Jangan memasang `prisma` tanpa nomor versi.** Prisma 8 (rilis kandidat) tidak punya perintah `generate` dan `migrate dev`, sehingga proyek rusak. Tetap di **Prisma 7.x** (`prisma@7`, `@prisma/client@7`, `@prisma/adapter-pg@7`).
   - **Jangan menjalankan `npm audit fix --force`.**
   - Jangan menjalankan `npx prisma init`.
6. **Jangan mengubah file di luar cakupan fase.** Kode yang sudah berjalan (auth, rides) hanya boleh diubah jika fase secara eksplisit menyebutnya.
7. **Jangan menyentuh repo frontend** (`SumberSira`, folder `mobile/`, Next.js).
8. **Jangan menjalankan server pengembangan dan meninggalkannya menyala.** Verifikasi memakai skrip smoke (bagian 6), yang menyalakan dan mematikan server sendiri.

### Wajib bertanya ke manusia (lalu berhenti) jika

- Variabel `.env` yang dibutuhkan fase belum ada (contoh: `BLOB_READ_WRITE_TOKEN`). Sebutkan **nama** variabelnya saja.
- `prisma migrate dev` meminta **reset database** atau melaporkan *drift*. Jangan setuju. Berhenti dan laporkan.
- Pemasangan paket gagal (terutama `sharp` di Windows).
- Kode yang ada berbeda dengan yang dijelaskan dokumen ini.
- Ada keputusan bisnis yang tidak tercakup dokumen ini.

### Perintah shell (Windows PowerShell 5.1)

- **Jangan memakai `&&` atau `||`.** Pakai `;` atau jalankan perintah terpisah.
- Beri tanda kutip pada path yang mengandung spasi.
- Tidak ada `rm -rf`, `cp`, `touch` ala Linux. Pakai `Remove-Item`, `Copy-Item`, `New-Item`.
- Nama skrip dijalankan seperti `npx tsx scripts/smoke/p2.ts`.

---

## 4. Keputusan yang sudah final

| Topik | Keputusan |
|---|---|
| Pembayaran | **Midtrans Core API (QRIS)**, mode sandbox. Status berubah otomatis lewat notifikasi, tanpa validasi manual admin. Ada **mode simulasi** untuk pengembangan dan sebagai cadangan. Pembayaran **tunai** (tiket masuk saja) dikonfirmasi petugas di loket. |
| Harga tiket dan tarif parkir | Disimpan di **database** (tabel `Setting`), admin bisa mengubahnya lewat API. |
| Kuota sewa per jam | **Tidak ada batas kuota.** Tidak ada logika cek ketersediaan. |
| Jam booking | Slot **1 jam**: `08-09`, `09-10`, `10-11`, `11-12`, `12-13`, `13-14`, `14-15`, `15-16`. Terpisah dari "jam datang" tiket (`/time-slots`, selang 2 jam). |
| Riwayat pengunjung | Dicari lewat **nomor WhatsApp**. |
| Ulasan | Langsung tampil, **tanpa moderasi**. Admin boleh menghapus. |
| Galeri | **Perlu persetujuan admin** sebelum tampil. |
| AI Photo | Perbaikan gambar **lokal dengan `sharp`** (tanpa layanan AI berbayar), lewat antarmuka yang bisa diganti layanan AI sungguhan nanti. |
| Chatbot | Pencocokan **kata kunci** dari tabel FAQ (tanpa LLM). Pertanyaan tak terjawab dicatat untuk admin. |
| Zona waktu | Semua perhitungan "hari ini" memakai **WIB (Asia/Jakarta)**. Waktu disimpan UTC di database. |

---

## 5. Asumsi yang perlu dikonfirmasi manusia

Kerjakan sesuai asumsi ini. Laporkan di Laporan Fase terkait agar manusia bisa memverifikasi dengan kode Flutter.

| # | Asumsi | Dipakai di |
|---|---|---|
| A1 | `people` pada tiket = `adults + kids` (dipakai untuk Live Crowd) | P5 |
| A2 | Normalisasi nomor WhatsApp: hapus semua non-digit; jika diawali `62`, ganti jadi `0`; hasil harus cocok `/^0\d{9,13}$/` | P2 |
| A3 | Tiket dan booking berlaku untuk **hari ini** (`visitDate`), kecuali booking mengirim `visitDate` opsional (maks. 30 hari ke depan) | P2, P3 |
| A4 | Mengambil satu tiket atau booking lewat kode **wajib menyertakan** `whatsapp` yang cocok (kode berurutan mudah ditebak). Tidak cocok = `404` | P2, P3 |
| A5 | Rating dan jumlah ulasan dihitung **nyata** dari database (tanpa angka dasar 4,8/132 milik Flutter) | P6 |
| A6 | Petugas boleh: dashboard, tiket (lihat, check-in/out, konfirmasi tunai), booking (lihat), pembayaran (lihat), wahana dan harga (lihat). Semua selain itu khusus admin | semua |
| A7 | Prediksi keramaian per jam berupa konstanta (bagian 7), bukan dihitung dari riwayat | P5 |

---

## 6. Konvensi teknis

**Struktur kode baru:**

```
src/app.ts                 Membuat dan mengekspor app Express (index.ts hanya menyalakan)
src/config.ts              Membaca dan memvalidasi environment (zod)
src/lib/time.ts            Helper WIB
src/lib/errors.ts          Kelas HttpError + handler galat global
src/lib/limiters.ts        Pembatas laju (express-rate-limit)
src/lib/seq.ts             Penomoran atomik (tabel Counter)
src/lib/phone.ts           Normalisasi WhatsApp
src/lib/storage/           Penyimpanan file (local dan vercel-blob)
src/payments/              Penyedia pembayaran dan layanannya
src/routes/*.ts            Satu file per modul
scripts/smoke/             Skrip uji per fase
docs/api.md                Dokumentasi endpoint (ditambah tiap fase)
```

**Aturan kode:**

- TypeScript `strict`. Hindari `any`. Validasi **semua** input dengan zod (`safeParse`). Gagal = `400 { error: "VALIDATION", issues }`.
- Uang selalu **`Int` rupiah** (tanpa desimal, tanpa float). **Total dihitung server**, tidak pernah dipercaya dari klien.
- Komentar singkat berbahasa Indonesia, gaya sama dengan kode yang ada.
- Kode galat huruf besar: `VALIDATION`, `UNAUTHENTICATED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `DUPLICATE` (409), `NOT_PAID` (409), `INVALID_STATE` (409), `RIDE_UNAVAILABLE` (409), `RATE_LIMITED` (429), `FILE_TOO_LARGE` (413), `UNSUPPORTED_MEDIA` (415), `PAYMENT_PROVIDER_ERROR` (502), `INTERNAL` (500).
- Jangan membocorkan `passwordHash`, token, atau rincian internal ke respons.
- Respons waktu memakai ISO-8601 UTC. Tanggal kunjungan (`visitDate`) berupa string `YYYY-MM-DD` dalam WIB.
- Jangan memakai fitur yang tidak ada di Express versi terpasang. **Cek versi Express di `package.json` (P0).** Jika Express 5.x, galat dari handler async otomatis diteruskan ke penanganan galat. Jika 4.x, bungkus handler async.
- Import relatif memakai akhiran `.js`.
- Tiap migrasi: **aditif** (tambah tabel/kolom dengan default). Satu migrasi per fase: `npx prisma migrate dev --name <nama>` lalu `npx prisma generate`.

**Skrip smoke (`scripts/smoke/pN.ts`):**

- Dijalankan dengan `npx tsx scripts/smoke/pN.ts`. Tanpa paket uji tambahan, memakai `fetch` bawaan Node.
- Impor `app` dari `src/app.ts`, `listen(0)` (port acak), jalankan uji, **matikan server**, keluar dengan kode non-nol jika ada yang gagal.
- Paksa `PAYMENT_MODE=simulation` di dalam skrip. **Skrip smoke tidak boleh memanggil Midtrans.**
- Untuk endpoint admin, login dengan akun seed (`admin@sumbersira.id`, `petugas@sumbersira.id`; password ada di `prisma/seed.ts`), ambil cookie dari header `set-cookie`.
- Semua data yang dibuat uji memakai awalan nama `[SMOKE]` dan **dihapus di akhir** (juga saat uji gagal, lewat `finally`).
- Cetak ringkasan LULUS/GAGAL per pemeriksaan.

---

## 7. Skema database target

Tambahkan bertahap sesuai fase (jangan sekaligus). Nilai enum sengaja huruf kecil, sama seperti enum `Role` dan nilai di aplikasi Flutter.

```prisma
enum Parking         { none motor mobil bus }
enum PaymentMethod   { qris cash }
enum PaymentStatus   { pending paid failed expired cancelled }
enum PaymentProvider { simulation midtrans manual }
enum TicketStatus    { waiting inside out }
enum PhotoStatus     { pending approved rejected }
enum JobStatus       { processing done failed }

// P11: tambahkan ke model AdminUser yang sudah ada
//   active Boolean @default(true)

// P1
model Counter { key String @id  value Int }
model Setting { key String @id  value Json  updatedAt DateTime @updatedAt }

// P2
model Ticket {
  id            String        @id @default(cuid())
  code          String        @unique            // TK-1001, TK-1002, ...
  name          String
  whatsapp      String                           // sudah dinormalisasi
  adults        Int
  kids          Int           @default(0)
  parking       Parking       @default(none)
  arrival       String                           // mis. "08.00 - 10.00"
  visitDate     String                           // "YYYY-MM-DD" WIB
  amount        Int
  paymentMethod PaymentMethod
  paymentStatus PaymentStatus @default(pending)
  status        TicketStatus  @default(waiting)
  checkInAt     DateTime?
  checkOutAt    DateTime?
  isDemo        Boolean       @default(false)
  createdAt     DateTime      @default(now())
  payments      Payment[]
  @@index([whatsapp])
  @@index([visitDate, status])
}

model Payment {
  id                    String          @id @default(cuid())
  ticketId              String?
  ticket                Ticket?         @relation(fields: [ticketId], references: [id], onDelete: Cascade)
  bookingId             String?
  booking               Booking?        @relation(fields: [bookingId], references: [id], onDelete: Cascade)
  method                PaymentMethod
  provider              PaymentProvider
  status                PaymentStatus   @default(pending)
  amount                Int
  providerOrderId       String?         @unique
  providerTransactionId String?
  qrString              String?
  qrUrl                 String?
  expiresAt             DateTime?
  paidAt                DateTime?
  lastPayload           Json?
  createdAt             DateTime        @default(now())
  updatedAt             DateTime        @updatedAt
  @@index([status])
}
// Tepat satu dari ticketId / bookingId terisi (dijaga di kode).

// P3
model Booking {
  id            String        @id @default(cuid())
  code          String        @unique            // SS-20261112-001
  name          String
  whatsapp      String
  slot          String                           // "08-09"
  visitDate     String
  amount        Int
  paymentStatus PaymentStatus @default(pending)
  createdAt     DateTime      @default(now())
  lines         BookingLine[]
  payments      Payment[]
  @@index([whatsapp])
  @@index([visitDate])
}

model BookingLine {
  id        String  @id @default(cuid())
  bookingId String
  booking   Booking @relation(fields: [bookingId], references: [id], onDelete: Cascade)
  rideId    String                                // sengaja TANPA relasi ke Ride (riwayat tetap utuh jika wahana dihapus)
  name      String                                // label saat dipesan, mis. "ATV (15 menit)"
  qty       Int
  unitPrice Int                                   // harga saat dipesan
}

// P6
model Review { id String @id @default(cuid())  name String  stars Int  text String  createdAt DateTime @default(now()) }

// P7
model Faq { id String @id @default(cuid())  keys String[]  answer String  sortOrder Int @default(0)  active Boolean @default(true) }
model UnansweredQuestion { id String @id @default(cuid())  question String  createdAt DateTime @default(now()) }

// P8
model GalleryPhoto {
  id         String      @id @default(cuid())
  url        String
  storageKey String
  title      String
  owner      String
  ai         Boolean     @default(false)
  status     PhotoStatus @default(pending)
  createdAt  DateTime    @default(now())
  reviewedAt DateTime?
}

// P9
model AiPhotoJob {
  id          String    @id @default(cuid())
  originalUrl String
  originalKey String
  resultUrl   String?
  resultKey   String?
  status      JobStatus @default(processing)
  error       String?
  createdAt   DateTime  @default(now())
}
```

**Isi `Setting`:**

- key `pricing`: `{ "ticketPricePerPerson": 5000, "capacity": 300, "parking": { "none": 0, "motor": 3000, "mobil": 10000, "bus": 20000 } }`
- key `quickQuestions`: `["Jam buka?", "Cara sewa ATV?", "Harga tiket?", "Parkir bus?"]`

**Konstanta kode** (`src/constants.ts`):

- `BOOKING_SLOTS = ["08-09","09-10","10-11","11-12","12-13","13-14","14-15","15-16"]`
- `HOURLY_FORECAST` = `[{hour:"08",count:30},{hour:"09",count:60},{hour:"10",count:135},{hour:"11",count:225},{hour:"12",count:285},{hour:"13",count:270},{hour:"14",count:240},{hour:"15",count:120},{hour:"16",count:45}]`
- Label keramaian dari persen: `< 40` = "Sepi", `<= 75` = "Sedang", selebihnya "Ramai". `percent = Math.round(inside / capacity * 100)`.

---

## 8. Fase kerja

### P0. Fondasi teknis (tanpa fitur baru)

**Langkah 0a (baca saja, jangan ubah apa pun):** baca semua file di bagian 2. Cek versi Express, Zod, TypeScript di `package.json`. Cek isi `generated/prisma/` untuk path ekspor enum. Laporkan perbedaan dengan dokumen ini sebelum lanjut.

**Langkah 0b:**

1. Pasang: `helmet`, `express-rate-limit`.
2. Pindahkan pembuatan app dari `src/index.ts` ke `src/app.ts` (`export const app`). `index.ts` hanya mengimpor `app` dan memanggil `listen`. **Perilaku harus identik** (CORS yang sudah ada, `express.json`, `cookie-parser`, semua rute lama).
3. `src/config.ts`: baca dan validasi env dengan zod. Variabel dan bawaannya:

| Variabel | Bawaan | Keterangan |
|---|---|---|
| `DATABASE_URL` | wajib | |
| `PORT` | 4000 | |
| `ADMIN_ORIGIN` | `http://localhost:3000` | |
| `NODE_ENV` | `development` | |
| `TRUST_PROXY` | `0` | jumlah proxy; untuk hosting nanti |
| `PUBLIC_BASE_URL` | kosong | alamat publik backend |
| `PAYMENT_MODE` | `simulation` | `simulation` atau `midtrans` |
| `MIDTRANS_ENV` | `sandbox` | `sandbox` atau `production` |
| `MIDTRANS_SERVER_KEY` | kosong | wajib bila `PAYMENT_MODE=midtrans` |
| `MIDTRANS_CLIENT_KEY` | kosong | tidak dipakai backend, disimpan saja |
| `STORAGE_DRIVER` | `local` | `local` atau `vercel-blob` |
| `BLOB_READ_WRITE_TOKEN` | kosong | wajib bila `STORAGE_DRIVER=vercel-blob` |

   Gagal cepat dengan pesan jelas jika `PAYMENT_MODE=midtrans` tetapi kunci kosong. **Jangan pernah mencetak nilai rahasia.**
4. `src/lib/time.ts`: `jakartaDate(d = new Date())` mengembalikan `"YYYY-MM-DD"` WIB (pakai `Intl.DateTimeFormat` dengan `timeZone: "Asia/Jakarta"`); `startOfDayJakarta(dateStr)` = `new Date(dateStr + "T00:00:00+07:00")`; `compactDate(dateStr)` mengembalikan `"YYYYMMDD"`.
5. `src/lib/errors.ts`: kelas `HttpError(status, code, extra?)` dan handler galat global (`{ error: code }`; `500` menjadi `{ error: "INTERNAL" }` tanpa stack di produksi; log galat di server). Tambah handler `404` JSON `{ error: "NOT_FOUND" }` untuk rute tak dikenal (di akhir rantai rute).
6. `helmet` dengan `crossOriginResourcePolicy: { policy: "cross-origin" }` (gambar upload harus bisa dimuat dari asal lain).
7. `app.set("trust proxy", config.TRUST_PROXY)`. Tambah `GET /` yang mengembalikan `{ "name": "SumberSira API", "status": "ok" }`.
8. `src/lib/limiters.ts`: `publicLimiter` (60 permintaan/menit/IP) dan `writeLimiter` (20 permintaan/menit/IP) memakai `express-rate-limit`, galat `429 { error: "RATE_LIMITED" }`. Belum dipasang ke rute mana pun.
9. Pembatas login: pasang pada `POST /auth/login` pembatas **5 percobaan gagal per menit** (`skipSuccessfulRequests: true`) dengan kunci = **email yang dinormalisasi** (huruf kecil, trim). Alasannya, panggilan login berasal dari server Next.js sehingga IP selalu sama. Jika body tidak valid, kunci memakai IP. Ini satu-satunya perubahan yang diizinkan pada `routes/auth.ts` di fase ini (pasang middleware saja, logika login tidak diubah).
10. Susun harness smoke di `scripts/smoke/_helpers.ts`: `startTestServer()`, `request()`, `loginAs()`, `check(nama, kondisi)`, dan pembersihan data `[SMOKE]`.
11. `scripts/smoke/p0.ts`: periksa `GET /`, `/health`, `/health/db`, `/rides` (8 item atau lebih), `/time-slots` (4), rute tak dikenal mengembalikan `404 JSON`, login admin berhasil, `GET /auth/me` berhasil, login 6 kali dengan password salah menghasilkan `429`, `GET /admin/rides` tanpa cookie `401`.
12. Perbarui `.env.example` (hanya nama variabel, nilai kosong atau contoh palsu). Buat `docs/api.md` dengan kerangka awal dan endpoint yang sudah ada. Tambahkan folder `uploads/` ke `.gitignore`.

**Catatan P0:** pembatas login memakai memori proses, jadi hitungan hilang saat server restart. Itu diterima.

---

### P1. Pengaturan harga dan slot booking

**Migrasi:** `Counter`, `Setting`.

1. `src/lib/seq.ts`: `nextSeq(key: string, initial: number): Promise<number>` secara **atomik** dengan SQL mentah (hindari balapan):
   ```sql
   INSERT INTO "Counter"("key","value") VALUES ($1, $2)
   ON CONFLICT ("key") DO UPDATE SET "value" = "Counter"."value" + 1
   RETURNING "value"
   ```
   Panggilan pertama mengembalikan `initial`, berikutnya naik 1.
2. `src/lib/pricing.ts`: `getPricing()` membaca `Setting` key `pricing` (jika belum ada, kembalikan nilai bawaan bagian 7). `setPricing()` memvalidasi dengan zod: `ticketPricePerPerson` int 500..1.000.000; `capacity` int 1..100.000; tiap tarif parkir int 0..1.000.000, dan `none` selalu 0.
3. `prisma/seed-extra.ts` dan skrip `"seed:extra": "tsx prisma/seed-extra.ts"` di `package.json`. **Hanya membuat data yang belum ada, tidak menimpa** (`create` bila tidak ada; jangan `update`). Di P1 isinya: `Setting` `pricing` dan `quickQuestions`. Fase lain menambah isinya (FAQ di P7, ulasan di P6).
4. Endpoint:

| Method | Path | Akses | Fungsi |
|---|---|---|---|
| GET | `/pricing` | Publik | `{ ticketPricePerPerson, capacity, parking: [{ key, label, price }] }` (label: "Jalan kaki", "Motor", "Mobil", "Bus") |
| GET | `/booking-slots` | Publik | `[{ id: "08-09", label: "08.00 - 09.00" }, ...]` |
| GET | `/admin/pricing` | Admin, petugas | Sama seperti `/pricing` (bentuk mentah, termasuk `parking` sebagai objek) |
| PUT | `/admin/pricing` | Admin | Ganti harga. Validasi di atas |

5. Terapkan `publicLimiter` pada rute publik. Smoke `p1.ts`: harga bawaan, ubah harga lalu baca ulang lalu **kembalikan ke nilai semula**, petugas `PUT` menghasilkan `403`, input tak valid `400`, `nextSeq` dipanggil 20 kali paralel menghasilkan nomor unik berurutan (pakai kunci `smoke-seq` dan hapus barisnya di akhir).

---

### P2. Tiket masuk dan pembayaran (mode simulasi)

**Migrasi:** enum `Parking`, `PaymentMethod`, `PaymentStatus`, `PaymentProvider`, `TicketStatus`; model `Ticket`, `Payment`. Tambahkan `Booking` di P3, jadi untuk sementara hapus relasi `booking` dari `Payment` dan tambahkan di migrasi P3 (jaga migrasi tetap aditif).

**Penyedia pembayaran (`src/payments/`):**

```ts
interface PaymentProvider {
  name: "simulation" | "midtrans";
  createQris(input: {
    orderId: string; amount: number; customerName: string; customerPhone: string;
    items: { id: string; name: string; price: number; quantity: number }[];
  }): Promise<{ providerTransactionId?: string; qrString?: string; qrUrl?: string; expiresAt: Date }>;
  getStatus(orderId: string): Promise<{ status: "pending"|"paid"|"failed"|"expired"|"cancelled"; raw?: unknown }>;
}
```

- `simulationProvider`: `createQris` mengembalikan `qrString = "QRIS-SIM:" + orderId + ":" + amount`, `expiresAt = sekarang + 15 menit`. `getStatus` selalu `pending` (status dibayar diubah lewat `simulate-pay` atau `mark-paid`).
- `providerFor(mode)` memilih penyedia dari `config.PAYMENT_MODE`.
- `src/payments/service.ts` berisi logika bersama: `applyPaymentStatus(paymentId, newStatus, payload?)` dalam **satu transaksi**: hanya transisi maju dari `pending` (`paid` bersifat final). Saat `paid`: isi `paidAt`, dan ubah `paymentStatus` pada Ticket atau Booking terkait. Saat `failed|expired|cancelled`: ubah `paymentStatus` yang sama. **Idempoten**: mengulang status yang sama tidak mengubah apa pun. `syncPayment(paymentId)`: jika `pending` dan metode `qris`, panggil `provider.getStatus` lalu `applyPaymentStatus`.

**`src/lib/phone.ts`:** `normalizeWa(input)` sesuai asumsi A2.

**Endpoint:**

| Method | Path | Akses | Fungsi |
|---|---|---|---|
| POST | `/tickets` | Publik (`writeLimiter`) | Beli tiket |
| GET | `/tickets/:code?whatsapp=` | Publik | Satu tiket (A4) |
| GET | `/tickets?whatsapp=` | Publik | Riwayat nomor itu, terbaru di atas |
| GET | `/payments/:id` | Publik | Status pembayaran; jika masih `pending` dan QRIS, panggil `syncPayment` dulu |
| POST | `/payments/:id/simulate-pay` | Publik, **hanya saat `PAYMENT_MODE=simulation` dan bukan produksi** (selain itu `404`) | Setara tombol "Saya Sudah Bayar" |
| GET | `/admin/tickets?date=&status=&q=&page=&limit=` | Admin, petugas | Daftar tiket. `date` bawaan hari ini (WIB); `q` mencari kode, nama, WhatsApp; `limit` bawaan 50, maks 100; kembalikan `{ items, total }` |
| POST | `/admin/tickets/:code/confirm-cash` | Admin, petugas | Hanya tiket `cash` dengan pembayaran `pending` |
| POST | `/admin/payments/:id/mark-paid` | **Admin** | Menandai lunas secara manual (untuk demo dan darurat). Hanya jika `pending` |
| POST | `/admin/payments/:id/cancel` | **Admin** | Batalkan pembayaran `pending` |

**`POST /tickets` body (zod):**

```
name: string trim 1..60
whatsapp: string (dinormalisasi; harus valid)
adults: int 1..30
kids: int 0..10
parking: "none" | "motor" | "mobil" | "bus"
arrival: string, harus salah satu TimeSlot.timeRange di database
paymentMethod: "qris" | "cash"
```

**Alur:**

1. `amount = adults * ticketPricePerPerson + parkingPrice(parking)` (anak di bawah 3 tahun gratis), dari `getPricing()`.
2. Dalam transaksi: `n = nextSeq("ticket", 1001)`, `code = "TK-" + n`; buat `Ticket` (`visitDate` = hari ini WIB) dan `Payment` (provider `simulation|midtrans` untuk QRIS, `manual` untuk tunai).
3. Jika QRIS: `providerOrderId = code + "-" + 6 karakter acak huruf besar/angka` (maks. 50 karakter), panggil `provider.createQris`, simpan `qrString`, `qrUrl`, `expiresAt`, `providerTransactionId`. Jika penyedia gagal: **hapus** `Payment` dan `Ticket` yang baru dibuat, balas `502 PAYMENT_PROVIDER_ERROR`.
4. Item untuk penyedia: baris "Tiket Masuk" (`adults` x harga) dan, bila tarif parkir > 0, baris "Parkir <label>". **Jumlah item harus sama persis dengan `amount`.**

**Respons tiket (`TicketDto`):**

```json
{
  "code": "TK-1001", "name": "...", "whatsapp": "08...",
  "adults": 2, "kids": 0, "people": 2, "parking": "motor",
  "arrival": "08.00 - 10.00", "visitDate": "2026-11-12", "amount": 13000,
  "status": "waiting", "paymentStatus": "pending",
  "checkInAt": null, "checkOutAt": null, "createdAt": "ISO",
  "payment": { "id": "...", "method": "qris", "status": "pending", "amount": 13000,
               "qrString": "...", "qrUrl": null, "expiresAt": "ISO" }
}
```

`payment` adalah percobaan pembayaran terbaru. Untuk tunai, bidang QR bernilai `null`.

**Smoke `p2.ts`:** harga dihitung benar (2 dewasa + motor = 13.000; anak tidak menambah harga); harga dari klien diabaikan; QRIS simulasi mengembalikan `qrString`; `simulate-pay` mengubah tiket menjadi `paid`; mengulang `simulate-pay` tidak berubah (idempoten); tunai: `confirm-cash` oleh petugas berhasil, oleh pengunjung tanpa cookie `401`; `mark-paid` oleh petugas `403`; ambil tiket dengan WhatsApp salah `404`; nomor WhatsApp `+62 812-3456-7890` dinormalisasi; kode tiket 10 pembelian paralel unik; validasi menolak `adults: 0`, `arrival` ngawur, dan WhatsApp tak valid.

---

### P3. Booking sewa dan wahana

**Migrasi:** `Booking`, `BookingLine`; tambahkan relasi `booking` pada `Payment`.

| Method | Path | Akses | Fungsi |
|---|---|---|---|
| POST | `/bookings` | Publik (`writeLimiter`) | Buat booking (pembayaran **hanya QRIS**) |
| GET | `/bookings/:code?whatsapp=` | Publik | Satu booking (A4) |
| GET | `/bookings?whatsapp=` | Publik | Riwayat nomor itu |
| GET | `/admin/bookings?date=&q=&page=&limit=` | Admin, petugas | Daftar booking |
| GET | `/admin/bookings/:code` | Admin, petugas | Detail |

**Body `POST /bookings`:**

```
name: string trim 1..60
whatsapp: string (dinormalisasi)
slot: salah satu BOOKING_SLOTS
visitDate: "YYYY-MM-DD" opsional (>= hari ini WIB, <= 30 hari ke depan); bawaan hari ini
items: [{ rideId: string, qty: int 1..20 }]   // 1..8 item, rideId tidak boleh ganda
```

**Alur:**

1. Untuk tiap item, baca `Ride` dari database. Tidak ada atau `active=false` menghasilkan `409 RIDE_UNAVAILABLE` (sertakan `rideId`).
2. Label baris = aturan yang sama dengan `bookingLabel` di frontend: `unit` kosong menjadi `name`; `unit` mengandung "menit" menjadi `name (unit)`; selain itu `name (per unit)`. Simpan label dan `unitPrice` **saat itu** pada `BookingLine`.
3. `amount = jumlah(qty * unitPrice)`, dihitung server.
4. Kode: `"SS-" + compactDate(visitDate hari pembuatan) + "-" + nomor 3 digit`, dengan nomor dari `nextSeq("booking:" + yyyymmdd, 1)` **berdasarkan tanggal pembuatan (WIB)**, diisi nol di depan sampai 3 digit.
5. Buat `Payment` QRIS dengan alur dan penanganan galat yang sama seperti tiket (P2 langkah 3 dan 4). Item untuk penyedia: satu per baris booking (`name` dipotong maks. 50 karakter).

**`BookingDto`:** `{ code, name, whatsapp, slot, slotLabel, visitDate, amount, paymentStatus, createdAt, lines: [{ rideId, name, qty, unitPrice, subtotal }], payment }`.

**Smoke `p3.ts`:** total dihitung server dari harga database; harga klien diabaikan; wahana nonaktif ditolak `409`; item ganda dan `qty: 0` ditolak; kode booking berurutan dan unik pada pembuatan paralel; mengubah harga wahana **setelah** booking tidak mengubah `unitPrice` booking lama; `simulate-pay` mengubah booking menjadi `paid`; riwayat lewat WhatsApp.

---

### P4. Midtrans (Core API, QRIS, sandbox)

**Prasyarat manusia:** `MIDTRANS_SERVER_KEY` sudah ada di `.env`. Agar fase ini bisa diuji penuh, backend harus punya alamat publik (deploy atau tunnel seperti ngrok) yang diisi di `PUBLIC_BASE_URL`. **Fase ini bisa dibangun tanpa itu; pengujian penuh menunggu manusia.**

**Jangan mengandalkan ingatan untuk detail API Midtrans.** Jika kamu punya akses web, baca dokumentasi resmi Midtrans (Core API: QRIS, HTTP Notification, Get Transaction Status). Jika tidak, ikuti spesifikasi di bawah dan tandai di Laporan Fase bagian mana yang **belum terverifikasi**.

**Penyedia `midtransProvider` (tanpa SDK, pakai `fetch`):**

- Basis URL: `https://api.sandbox.midtrans.com` jika `MIDTRANS_ENV=sandbox`, selain itu `https://api.midtrans.com`.
- Header: `Accept: application/json`, `Content-Type: application/json`, `Authorization: Basic ` + base64(`SERVER_KEY` + `":"`). Jika `PUBLIC_BASE_URL` terisi, tambahkan `X-Override-Notification: <PUBLIC_BASE_URL>/payments/midtrans/notification` (menentukan tujuan notifikasi per transaksi tanpa menyentuh pengaturan dashboard).
- `createQris`: `POST /v2/charge` dengan body:
  ```json
  {
    "payment_type": "qris",
    "transaction_details": { "order_id": "...", "gross_amount": 13000 },
    "item_details": [{ "id": "...", "price": 5000, "quantity": 2, "name": "Tiket Masuk" }],
    "customer_details": { "first_name": "...", "phone": "..." },
    "qris": { "acquirer": "gopay" }
  }
  ```
  `gross_amount` harus sama dengan jumlah `price * quantity` item. Respons sukses memiliki `status_code` `"201"`; selain itu lempar `PAYMENT_PROVIDER_ERROR`. Ambil `transaction_id`, `qr_string` (jika ada), URL gambar QR dari elemen `actions` yang namanya diawali `generate-qr-code`, dan `expiry_time` jika ada (jika tidak, `sekarang + 15 menit`). Parse **longgar**: abaikan bidang baru yang tidak dikenal, dan jangan gagal jika salah satu opsional tidak ada.
- `getStatus`: `GET /v2/{order_id}/status`. Petakan `transaction_status`: `settlement` menjadi `paid`; `capture` menjadi `paid` hanya jika `fraud_status` adalah `accept`; `pending` menjadi `pending`; `expire` menjadi `expired`; `cancel` menjadi `cancelled`; `deny` dan `failure` menjadi `failed`; `refund` dan `partial_refund` jangan mengubah status.
- Batas waktu setiap panggilan 10 detik. Jangan mencatat header Authorization atau Server Key ke log.

**Endpoint notifikasi (webhook): `POST /payments/midtrans/notification` (publik, tanpa cookie, tanpa pembatas laju yang ketat):**

1. Validasi keberadaan `order_id`, `status_code`, `gross_amount`, `signature_key`, `transaction_status` (string).
2. Hitung `expected = sha512_hex(order_id + status_code + gross_amount + SERVER_KEY)`. **Pakai `gross_amount` persis seperti string yang diterima** (contoh `"13000.00"`, jangan dikonversi angka). Bandingkan dengan `signature_key` memakai `timingSafeEqual`. Tidak cocok: `403` tanpa mengubah apa pun.
3. Cari `Payment` berdasarkan `providerOrderId`. Tidak ketemu: balas `200 { ok: true, ignored: true }` (hentikan percobaan ulang Midtrans) dan catat peringatan.
4. **Konfirmasi ulang** dengan `provider.getStatus(order_id)` dan jadikan hasilnya sumber kebenaran, bukan isi notifikasi. Pastikan `Number(gross_amount) === payment.amount`; jika tidak, jangan ubah status dan catat peringatan.
5. `applyPaymentStatus` (idempoten). Simpan notifikasi ke `lastPayload`. Balas `200 { ok: true }` cepat.

**Cadangan dan pembersihan:**

- `GET /payments/:id` (dari P2) sudah memanggil `syncPayment`, sehingga status tetap bisa naik walau notifikasi tidak sampai (misalnya saat pengujian di laptop tanpa alamat publik).
- Penyapu berkala di `index.ts` (bukan `app.ts`; **tidak berjalan saat smoke**): setiap 5 menit, ambil pembayaran QRIS `pending` yang `expiresAt`-nya sudah lewat lebih dari 2 menit, panggil `syncPayment`; jika masih `pending` setelahnya, tandai `expired`. Tangkap semua galat agar server tidak mati. Hentikan interval saat proses berhenti.
- `POST /payments/:id/simulate-pay` tetap `404` saat `PAYMENT_MODE=midtrans`.
- Pilihan penyedia dibaca dari `config.PAYMENT_MODE` saat pembuatan pembayaran; pembayaran lama tetap memakai penyedia yang tercatat di kolom `provider`.

**Smoke `p4.ts` (tanpa Midtrans sungguhan):** uji fungsi murni dan handler dengan `fetch` global dipalsukan atau penyedia disuntik palsu:
- tanda tangan benar diterima, salah ditolak `403`, `gross_amount` yang dikonversi angka menghasilkan penolakan;
- notifikasi `settlement` mengubah pembayaran dan tiket menjadi `paid`; mengirim dua kali tidak mengubah apa pun;
- `order_id` tak dikenal menghasilkan `200 ignored`;
- `amount` tidak cocok tidak mengubah status;
- pemetaan seluruh `transaction_status`.

**Langkah verifikasi manual untuk manusia (tulis di Laporan Fase):** set `PAYMENT_MODE=midtrans`, buat tiket QRIS, bayar lewat simulator sandbox Midtrans, panggil `GET /payments/:id` dan pastikan status menjadi `paid`; lalu dengan alamat publik, pastikan notifikasi masuk.

---

### P5. Check-in, Live Crowd, dan dashboard

| Method | Path | Akses | Fungsi |
|---|---|---|---|
| POST | `/admin/tickets/:code/check-in` | Admin, petugas | Syarat: `paymentStatus=paid`, `status=waiting`, `visitDate` = hari ini WIB. Hasil: `status=inside`, isi `checkInAt` |
| POST | `/admin/tickets/:code/check-out` | Admin, petugas | Syarat: `status=inside`. Hasil: `status=out`, isi `checkOutAt` |
| GET | `/crowd` | Publik (`publicLimiter`) | `{ inside, capacity, percent, label, updatedAt, forecast: HOURLY_FORECAST }` |
| GET | `/admin/dashboard` | Admin, petugas | Ringkasan hari ini |

- Tiket belum lunas: `409 NOT_PAID`. Status atau tanggal salah: `409 INVALID_STATE`. Tidak ditemukan: `404`.
- `inside` = jumlah `adults + kids` (A1) semua tiket dengan `status=inside` **dan `visitDate` = hari ini**. `percent` dibatasi maksimal 100? **Tidak**: tampilkan apa adanya (bisa lebih dari 100 jika kapasitas terlampaui). `capacity` dari `getPricing()`.
- Dashboard (semua per hari ini WIB): `ticketsToday` (tiket lunas), `visitorsToday` (jumlah `adults + kids` tiket lunas), `bookingsToday` (booking lunas), `revenueToday` (jumlah `Payment.amount` berstatus `paid` dengan `paidAt` dalam hari ini), `pendingCash` (tiket tunai menunggu konfirmasi), `pendingQris` (pembayaran QRIS `pending` yang belum kedaluwarsa), dan objek `crowd` (`inside`, `capacity`, `percent`, `label`).

**Smoke `p5.ts`:** check-in tiket belum lunas `409 NOT_PAID`; setelah lunas berhasil; check-in dua kali `409`; `crowd.inside` naik lalu turun setelah check-out; label sesuai ambang (uji fungsi labelnya langsung: 39 Sepi, 40 Sedang, 75 Sedang, 76 Ramai); dashboard menghitung hanya data hari ini; tiket dengan `visitDate` kemarin (dibuat lewat `db` langsung) tidak masuk hitungan `crowd`.

---

### P6. Ulasan dan rating

**Migrasi:** `Review`. Tambahkan 3 ulasan awal ke `seed-extra.ts` (hanya jika tabel kosong): Bu Rani S. 5 bintang "Airnya jernih banget, anak-anak senang main di kolam!"; Dimas P. 4 bintang "Spot foto oke, tapi pas siang rame banget."; Kel. Ahmad 5 bintang "Sewa ATV gampang lewat app, ga perlu antre."

| Method | Path | Akses | Fungsi |
|---|---|---|---|
| GET | `/reviews?limit=` | Publik | `{ items: [{ id, name, stars, text, createdAt }], rating, count }`, terbaru di atas. `rating` rata-rata 1 desimal (0 jika belum ada), `count` total |
| POST | `/reviews` | Publik (`writeLimiter`) | Body: `name` 1..40, `stars` int 1..5, `text` 1..500 |
| GET | `/admin/reviews` | Admin | Semua ulasan |
| DELETE | `/admin/reviews/:id` | Admin | Hapus |

Bersihkan teks (trim). Jangan menerapkan HTML apa pun, simpan sebagai teks biasa. **Smoke `p6.ts`:** rata-rata dan jumlah benar setelah menambah ulasan (hapus lagi), validasi bintang 0 dan 6 ditolak, petugas `DELETE` `403`.

---

### P7. Chatbot dan FAQ

**Migrasi:** `Faq`, `UnansweredQuestion`. Tambahkan ke `seed-extra.ts` (hanya jika tabel `Faq` kosong), **berurutan** (urutan menentukan prioritas pencocokan), 8 entri berikut (`keys` | `answer`):

1. `riwayat, whatsapp, tiket saya, hilang` | "Buka Tiket & Booking lalu cari dengan nomor WhatsApp yang dipakai saat beli. Tidak perlu login."
2. `jam, buka, tutup, weekend, weekday` | "Weekday buka 08.00-16.00, weekend 08.00-17.00 ya!"
3. `harga, tiket, htm, bayar masuk, balita` | "Tiket masuk Rp5.000 per orang untuk usia 3 tahun ke atas. Balita gratis."
4. `qris, tunai, cash, pembayaran` | "Tiket masuk bisa QRIS atau tunai di loket. Sewa dan wahana dibayar lewat QRIS."
5. `fasilitas, gazebo, musholla, kolam anak` | "Ada kolam mata air, kolam anak, gazebo, dan musholla."
6. `atv, sewa, ban, wahana, booking` | "Buka Tiket & Booking, pilih jam, tambah item, lalu tekan Lanjut Booking."
7. `parkir, bus, mobil, motor` | "Parkir motor 3rb, mobil 10rb, bus 20rb."
8. `ramai, sepi, crowd, penuh` | "Lihat grafik keramaian di Beranda. Biasanya paling sepi pukul 08.00-09.00 atau setelah 15.00."

| Method | Path | Akses | Fungsi |
|---|---|---|---|
| POST | `/chat` | Publik (`writeLimiter`) | Body `{ message }` (1..300). Huruf kecil, trim. Cocokkan dengan FAQ aktif **berurutan menurut `sortOrder`**; jawaban dari entri pertama yang salah satu `keys`-nya terkandung dalam pesan. Hasil: `{ answer, matched: true }`. Tidak cocok: simpan ke `UnansweredQuestion` dan balas `{ answer: "Maaf, aku belum punya jawabannya. Pertanyaanmu sudah dicatat untuk admin ya.", matched: false }` |
| GET | `/chat/quick-questions` | Publik | Daftar dari `Setting` `quickQuestions` |
| GET | `/admin/faq` | Admin | Semua entri (urut `sortOrder`) |
| POST | `/admin/faq` | Admin | `{ keys: string[] (1..10, tiap 1..30), answer: 1..500, sortOrder?, active? }` |
| PATCH | `/admin/faq/:id` | Admin | Ubah sebagian |
| DELETE | `/admin/faq/:id` | Admin | Hapus |
| GET | `/admin/faq/unanswered` | Admin | Daftar pertanyaan belum terjawab, terbaru di atas |
| DELETE | `/admin/faq/unanswered/:id` | Admin | Tandai selesai (hapus) |

Simpan `keys` dalam huruf kecil. **Smoke `p7.ts`:** setiap contoh pertanyaan ("jam buka?", "cara sewa atv?", "harga tiket?", "parkir bus?") mendapat jawaban yang benar sesuai urutan prioritas; pesan tak dikenal tercatat di `UnansweredQuestion` (hapus lagi); petugas mengakses `/admin/faq` mendapat `403`.

---

### P8. Penyimpanan file dan galeri

**Prasyarat manusia untuk produksi:** `STORAGE_DRIVER=vercel-blob` dan `BLOB_READ_WRITE_TOKEN` di `.env` (Blob store dibuat manusia di dashboard Vercel). **Fase ini harus selesai dan lolos uji dengan `STORAGE_DRIVER=local` tanpa token.**

1. Pasang: `multer` (versi 2.x) dan `@types/multer`, `@vercel/blob`.
2. `src/lib/storage/`: antarmuka `Storage { put(key, buffer, contentType): Promise<{ url, key }>; remove(key): Promise<void> }`. Implementasi `localStorageDriver` (tulis ke `uploads/<key>`, buat folder bila perlu, URL = `<PUBLIC_BASE_URL atau http://localhost:PORT>/uploads/<key>`; sajikan `express.static("uploads")` **hanya** saat driver `local`) dan `vercelBlobDriver` (`put` dengan `access: "public"` dan `del`; **baca dokumentasi `@vercel/blob` terbaru untuk bentuk API saat ini**). Pemilih driver membaca `config.STORAGE_DRIVER`.
3. Validasi unggahan (helper bersama dipakai juga oleh P9): batas **4 MB** (multer `limits.fileSize`; melebihi = `413 FILE_TOO_LARGE`), tipe diperiksa dari **byte awal (magic bytes)**: JPEG `FF D8 FF`, PNG `89 50 4E 47`, WebP `RIFF....WEBP`. Selain itu `415 UNSUPPORTED_MEDIA`. Jangan mempercayai `mimetype` atau nama file dari klien. Kunci penyimpanan dibuat server (`gallery/<cuid>.<ext>`), bukan dari nama file pengguna.

| Method | Path | Akses | Fungsi |
|---|---|---|---|
| POST | `/gallery` | Publik (`writeLimiter`) | `multipart/form-data`: `photo` (file), `title` 1..60, `owner` 1..40. Simpan, status `pending`. Balas `201` dengan data foto |
| GET | `/gallery?limit=` | Publik | Hanya `approved`: `[{ id, url, title, owner, ai }]`, terbaru di atas |
| GET | `/admin/gallery?status=` | Admin | Semua foto, bisa disaring status |
| PATCH | `/admin/gallery/:id` | Admin | `{ status: "approved" | "rejected" }`, isi `reviewedAt` |
| DELETE | `/admin/gallery/:id` | Admin | Hapus baris **dan** filenya (`remove`) |

**Smoke `p8.ts`** (driver `local`): unggah PNG kecil buatan sendiri (byte literal) sukses dan berstatus `pending`; tidak muncul di `GET /gallery`; setelah `PATCH approved` muncul; berkas teks yang diberi nama `.png` ditolak `415`; berkas lebih dari 4 MB ditolak `413`; `DELETE` menghapus baris dan file; hapus semua berkas `[SMOKE]` di akhir.

---

### P9. AI Photo

**Migrasi:** `AiPhotoJob`. Pasang `sharp` (versi stabil terbaru). **Jika gagal terpasang di Windows, berhenti dan tanyakan.**

- Antarmuka `ImageEnhancer { enhance(input: Buffer): Promise<Buffer> }` dan implementasi `sharpEnhancer`: `rotate()` (orientasi EXIF), `resize` maksimal 2048 px sisi terpanjang tanpa memperbesar, `normalise()`, `modulate({ brightness: 1.05, saturation: 1.2 })`, `sharpen()`, keluaran JPEG kualitas 88. (Placeholder lokal yang bisa diganti layanan AI sungguhan lewat antarmuka yang sama.)
- Memakai helper validasi dan penyimpanan dari P8 (kunci `ai/<cuid>-original.<ext>` dan `ai/<cuid>-result.jpg`).

| Method | Path | Akses | Fungsi |
|---|---|---|---|
| POST | `/ai-photo` | Publik (`writeLimiter`, 10/menit) | `multipart`: `photo`. Proses sinkron: simpan asli, enhance, simpan hasil. Balas `{ id, status: "done", originalUrl, resultUrl }`. Gagal memproses: simpan `status=failed` dengan `error` ringkas, balas `422` |
| GET | `/ai-photo/:id` | Publik | Data job |
| POST | `/ai-photo/:id/share-to-gallery` | Publik (`writeLimiter`) | Body `{ title, owner }`. Buat `GalleryPhoto` (`ai: true`, `status: pending`, `url` = `resultUrl`). Hanya job `done`, dan satu job hanya boleh dibagikan sekali (`409 DUPLICATE`) |

Catatan: `GalleryPhoto.storageKey` untuk foto dari AI Photo mengacu pada kunci hasil. Menghapus foto galeri tersebut tidak boleh menghapus job-nya; cukup hapus barisnya dan file hasil jika tidak dipakai lagi. Jelaskan pilihanmu di Laporan Fase.

**Smoke `p9.ts`:** unggah PNG buatan sendiri menghasilkan job `done` dengan `resultUrl` berbeda dari `originalUrl`; file hasil benar-benar ada dan bisa dibaca sebagai gambar; berkas bukan gambar `415`; bagikan ke galeri sukses sekali dan ditolak untuk kedua kalinya.

---

### P10. AI Insight (admin)

`GET /admin/insight` (admin). Berbasis aturan (bukan LLM), lewat antarmuka `InsightGenerator` supaya bisa diganti nanti. Kembalikan:

```json
{
  "rating": 4.7, "reviewCount": 12,
  "distribution": { "1": 0, "2": 0, "3": 1, "4": 3, "5": 8 },
  "crowd": { "inside": 120, "percent": 40, "label": "Sedang" },
  "peakHour": "12",
  "suggestions": ["..."]
}
```

`peakHour` = jam dengan `count` tertinggi pada `HOURLY_FORECAST`. `suggestions` (maks. 5 kalimat berbahasa Indonesia) dari aturan sederhana, misalnya: rating rata-rata di bawah 4,0 menghasilkan saran memeriksa ulasan terbaru; keramaian di atas 75% menghasilkan saran menambah petugas dan menyarankan pengunjung datang di jam sepi; ulasan berbintang 1-2 dalam 7 hari terakhir lebih dari 0 menghasilkan peringatan; jika tidak ada pemicu, satu kalimat netral. **Smoke `p10.ts`:** bentuk respons, distribusi sesuai data uji, petugas `403`.

---

### P11. Akun petugas dan ubah password

**Migrasi:** tambah `active Boolean @default(true)` pada `AdminUser`.

1. `requireAuth`: tolak (`401 UNAUTHENTICATED`) jika `user.active === false`. Ini satu-satunya perubahan pada `middleware/auth.ts`.
2. `POST /auth/login`: pengguna nonaktif diperlakukan sama seperti kredensial salah (`401 INVALID_CREDENTIALS`).
3. Endpoint:

| Method | Path | Akses | Fungsi |
|---|---|---|---|
| GET | `/admin/staff` | **Admin** | `[{ id, name, email, role, active, createdAt }]` (tanpa hash) |
| POST | `/admin/staff` | **Admin** | `{ name 1..60, email (huruf kecil), role: "petugas" | "admin", password 8..72 }`. Email ganda `409 DUPLICATE` |
| PATCH | `/admin/staff/:id` | **Admin** | `{ name?, role?, active? }`. Jangan menonaktifkan atau menurunkan peran diri sendiri; jangan menonaktifkan atau menurunkan admin aktif terakhir (`409 INVALID_STATE`). Menonaktifkan **mencabut semua sesi** pengguna itu |
| POST | `/admin/staff/:id/reset-password` | **Admin** | `{ password 8..72 }`. Mencabut semua sesi pengguna itu |
| POST | `/auth/change-password` | Login | `{ currentPassword, newPassword 8..72 }`. Password lama salah `401 INVALID_CREDENTIALS`. Baru tidak boleh sama dengan email atau password lama. Mencabut sesi **lain** (sesi saat ini tetap) |

Pakai `hashPassword` dan `verifyPassword` yang sudah ada. **Smoke `p11.ts`:** admin membuat petugas lalu petugas bisa login; petugas mengakses `/admin/staff` `403`; menonaktifkan petugas membuat sesinya langsung `401`; tidak bisa menonaktifkan diri sendiri; ganti password lalu login dengan password baru berhasil; semua akun `[SMOKE]` dihapus di akhir.

---

### P12. Penutup dan kesiapan deploy

1. `docs/api.md`: lengkapi seluruh endpoint (method, path, akses, body, contoh respons, kode galat). Buat koleksi cepat berupa daftar contoh `curl`/PowerShell di dokumen yang sama.
2. Perbarui `README.md`: fitur baru, variabel environment (tabel P0), cara menjalankan, `seed:extra`, mode pembayaran (simulasi atau Midtrans), cara menjalankan skrip smoke, dan daftar rencana yang sudah tercentang.
3. Skrip `scripts/smoke/all.ts` yang menjalankan P0 sampai P11 berurutan.
4. **Kesiapan deploy (tanpa men-deploy):**
   - Ubah `package.json`: pindahkan `tsx` ke `dependencies`; `"start": "tsx src/index.ts"`; `"postinstall": "prisma generate"`; hapus skrip `build` yang tidak dipakai atau jelaskan di README mengapa tidak diperlukan. Jangan mengubah `tsconfig` agar tidak merusak lingkungan yang sudah jalan.
   - Dokumentasikan perintah deploy: `npm install`, `npx prisma migrate deploy`, `npm start`; variabel yang wajib diisi di server (`NODE_ENV=production`, `DATABASE_URL`, `ADMIN_ORIGIN`, `PUBLIC_BASE_URL`, `TRUST_PROXY`, kunci Midtrans, `STORAGE_DRIVER`, `BLOB_READ_WRITE_TOKEN`).
   - Pastikan di `NODE_ENV=production`: aturan CORS longgar untuk `localhost` mati, cookie `Secure` aktif, `simulate-pay` mati, dan tidak ada stack trace di respons galat.
5. Skrip opsional `scripts/demo-crowd.ts` (jalankan manual `npx tsx scripts/demo-crowd.ts`, dengan argumen `add` atau `remove`): `add` membuat 15 tiket `isDemo=true` berstatus `inside` dan lunas untuk hari ini dengan jumlah orang yang totalnya 186; `remove` menghapus semua tiket `isDemo`. Untuk demo Live Crowd.
6. Jalankan regresi: `npx tsc --noEmit` dan `npx tsx scripts/smoke/all.ts`.

---

## 9. Gerbang Mutu dan Laporan Fase

**Gerbang Mutu (semua harus terpenuhi sebelum melapor):**

1. `npx tsc --noEmit` **tidak menambah galat baru.** Jika ada galat lama yang tidak terkait, laporkan, jangan diperbaiki massal.
2. Migrasi fase sudah diterapkan (`npx prisma migrate dev --name ...`) dan `npx prisma generate` sudah dijalankan. **Tidak ada reset.**
3. `npx tsx scripts/smoke/pN.ts` lulus **dan** smoke fase-fase sebelumnya masih lulus (regresi).
4. Tidak ada data `[SMOKE]` tersisa di database.
5. `.env.example` dan `docs/api.md` diperbarui. `.env` **tidak** disentuh.
6. `git status` hanya menampilkan file yang memang bagian fase ini.

**Laporan Fase (singkat, setelah gerbang lolos, lalu berhenti):**

```
FASE: P<n>  STATUS: selesai | selesai dengan catatan | terblokir
Berkas baru:        ...
Berkas diubah:      ...
Migrasi:            <nama>
Endpoint baru:      <method path (akses)> ...
Hasil uji:          <ringkasan smoke + tsc>
Asumsi yang dipakai (A1..A7): ...
Hal yang belum terverifikasi: ...
Yang perlu dilakukan manusia: ... (mis. isi variabel .env, commit, uji manual)
Pertanyaan: ...
```

---

## 10. Kemajuan

- [x] P0 Fondasi teknis
- [x] P1 Pengaturan harga dan slot booking
- [x] P2 Tiket masuk dan pembayaran (simulasi)
- [x] P3 Booking sewa dan wahana
- [x] P4 Midtrans (QRIS sandbox)
- [x] P5 Check-in, Live Crowd, dashboard
- [x] P6 Ulasan dan rating
- [x] P7 Chatbot dan FAQ
- [x] P8 Penyimpanan file dan galeri
- [x] P9 AI Photo
- [x] P10 AI Insight
- [x] P11 Akun petugas dan ubah password
- [x] P12 Penutup dan kesiapan deploy

---

## 11. Di luar cakupan (jangan dikerjakan)

Perubahan repo frontend (Next.js dan Flutter); deploy sungguhan; Midtrans mode production; refund; OTP untuk riwayat pengunjung; notifikasi push atau email; LLM sungguhan untuk chatbot dan insight; kuota atau ketersediaan wahana per jam.