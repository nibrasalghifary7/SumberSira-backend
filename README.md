# SumberSira Backend

REST API untuk aplikasi **Sumber Sira**, wisata kolam mata air di Desa Putukrejo, Malang. Backend ini dipakai bersama oleh dua antarmuka:

| Klien | Teknologi | Cara memakai API |
|---|---|---|
| Web admin (pengelola dan petugas) | Next.js + TypeScript | Dipanggil dari server Next.js (Server Action dan DAL), sesi lewat cookie |
| Aplikasi pengunjung | Flutter | Memanggil endpoint publik (tanpa login) |

```
Flutter (pengunjung) ──┐
                       ├──► SumberSira-backend (Express) ──► PostgreSQL (Neon)
Next.js (admin)  ──────┘
```

Dokumentasi lengkap endpoint (body, contoh respons, kode galat, contoh curl/PowerShell): **`docs/api.md`**.

## Fitur

- **Autentikasi & sesi** — login admin/petugas dengan cookie sesi tersimpan di database, daftar sesi, keluar dari perangkat lain, ubah password sendiri, manajemen akun staff (buat/nonaktifkan/reset password), proteksi admin aktif terakhir.
- **Wahana & harga** — katalog wahana publik, kelola wahana (khusus admin), harga tiket + tarif parkir yang bisa diubah dari admin.
- **Tiket masuk** — beli tiket (QRIS atau tunai), cek tiket dengan verifikasi nomor WhatsApp, kode tiket berurutan (`TK-1001`, ...).
- **Booking sewa & wahana** — sewa alat/wahana per slot jam dengan QRIS.
- **Pembayaran** — mode **simulasi** (QRIS palsu + tombol bayar) atau **Midtrans** sungguhan dengan webhook terverifikasi signature SHA-512 dan cek ulang status ke Core API.
- **Check-in & Live Crowd** — check-in/check-out tiket di loket, jumlah pengunjung di dalam, prediksi keramaian per jam.
- **Ulasan & rating** — ulasan publik, moderasi admin, statistik rating.
- **Galeri foto** — unggah dengan verifikasi magic bytes (JPEG/PNG/WebP, maks 4 MB), moderasi admin; driver penyimpanan `local` atau `vercel-blob`.
- **AI Photo** — perbaikan foto pengunjung (rotasi EXIF, resize, warna & ketajaman) dengan `sharp` melalui antarmuka `ImageEnhancer` (bisa diganti layanan AI sungguhan), dan bisa dibagikan ke galeri.
- **Chatbot & FAQ** — jawab pertanyaan dari daftar FAQ, pertanyaan yang belum terjawab dicatat untuk admin.
- **AI Insight** — saran operasional harian untuk admin berbasis aturan melalui antarmuka `InsightGenerator`.
- **Keamanan** — helmet, CORS ketat di produksi, rate limiting per endpoint, hash password scrypt, cookie `HttpOnly`/`SameSite`/`Secure` di produksi.

## Teknologi

- Node.js 20 atau lebih baru (dikembangkan di Node 24)
- Express 5 + TypeScript (dijalankan langsung dengan `tsx`, tanpa langkah build)
- Prisma ORM **versi 7** dengan driver adapter `@prisma/adapter-pg`
- PostgreSQL di Neon (cloud)
- Zod untuk validasi input, `sharp` untuk pengolahan gambar

> **Penting:** pasang Prisma dengan versi terkunci (`prisma@7` dan `@prisma/client@7`). Menjalankan `npm install prisma` tanpa nomor versi bisa memasang Prisma 8 (rilis kandidat), yang tidak punya perintah `generate` dan `migrate dev`, sehingga proyek ini tidak bisa dijalankan.

## Konfigurasi

Salin `.env.example` menjadi `.env`, lalu isi. Semua variabel punya nilai bawaan kecuali
`DATABASE_URL` (dan beberapa variabel menjadi wajib tergantung mode yang dipakai).

| Variabel | Wajib? | Contoh | Penjelasan |
|---|---|---|---|
| `DATABASE_URL` | **Wajib** | `postgresql://user:pass@host/neondb?sslmode=require` | Connection string PostgreSQL/Neon. Pakai versi **direct** (tanpa `-pooler` di host) untuk migrasi. |
| `PORT` | Tidak | `4000` | Port HTTP server. Bawaan `4000`. |
| `ADMIN_ORIGIN` | Tidak | `https://admin.sumbersira.id,https://app.sumbersira.id` | Origin yang diizinkan CORS. **Boleh daftar dipisah koma**; spasi dan garis miring di akhir dinormalisasi. Bawaan `http://localhost:3000`. Di luar daftar ini CORS ditolak (tanpa error 500). |
| `NODE_ENV` | Tidak | `production` | `development`, `test`, atau `production`. Bawaan `development`. Produksi mematikan CORS localhost, mengaktifkan cookie `Secure`, dan mematikan `simulate-pay`. |
| `TRUST_PROXY` | Tidak | `1` | Jumlah reverse proxy di depan server (Vercel/Railway/Render/NGINX biasanya `1`) agar rate limit membaca IP asli. Bawaan `0`. |
| `LOG_LEVEL` | Tidak | `info` | Tingkat detail log JSON: `fatal`, `error`, `warn`, `info`, `debug`, `trace`, atau `silent`. Bawaan `info`; test memakai `silent`. |
| `ALLOW_SIMULATE_PAY` | Tidak | `false` | `true` = tombol `simulate-pay` tetap boleh dipakai walau `NODE_ENV=production` (khusus demo). |
| `EXTRA_ORIGINS` | Tidak | `https://sumbersira.vercel.app` | Alamat lain yang boleh memanggil API, dipisah koma (mis. web Flutter yang dideploy). |
| `PUBLIC_BASE_URL` | **Wajib di produksi** bila `STORAGE_DRIVER=local` | `https://api.sumbersira.id` | URL publik backend ini, **dipakai untuk dua hal**: (1) membentuk URL foto galeri/AI Photo pada penyimpanan lokal, dan (2) URL webhook Midtrans (`X-Override-Notification`). Harus URL `http://`/`https://` valid; garis miring di akhir otomatis dibuang. Di `development` boleh kosong (memakai `http://localhost:PORT`). |
| `PAYMENT_MODE` | Tidak | `simulation` | `simulation` (bawaan; QRIS palsu + endpoint uji bayar) atau `midtrans` (QRIS sungguhan). |
| `MIDTRANS_ENV` | Tidak | `sandbox` | `sandbox` (default) atau `production`; menentukan URL API Midtrans. |
| `MIDTRANS_SERVER_KEY` | **Wajib** bila `PAYMENT_MODE=midtrans` | `SB-Mid-server-...` | Kunci server Midtrans untuk charge/status. **Rahasia.** |
| `MIDTRANS_CLIENT_KEY` | Tidak | `SB-Mid-client-...` | Kunci client Midtrans, dipakai web admin bila memakai Snap/QR. |
| `STORAGE_DRIVER` | Tidak | `local` | `local` (folder `uploads/`, cocok pengembangan) atau `vercel-blob` (produksi). |
| `BLOB_READ_WRITE_TOKEN` | **Wajib** bila `STORAGE_DRIVER=vercel-blob` | `vercel_blob_rw_...` | Token Vercel Blob. **Rahasia.** |

Catatan penting:

- **Jangan pernah commit `.env`** atau menyalin kunci asli ke README, dokumen, tiket, atau chat.
  File `.env` sudah masuk `.gitignore`; gunakan `.env.example` untuk berbagi contoh.
- `PUBLIC_BASE_URL` bukan sekadar alamat foto: nilai yang sama dipakai sebagai dasar URL
  notifikasi Midtrans. Bila kosong di produksi saat penyimpanan lokal, server menolak start.
- Dengan `ADMIN_ORIGIN` berisi daftar, cukup satu variabel untuk web admin dan web pengunjung.

### Contoh konfigurasi Midtrans sandbox

Isi kunci asli dari dashboard Midtrans (Sandbox → Settings → Access Keys). Contoh di bawah
sengaja hanya berisi placeholder:

```env
NODE_ENV=development
PUBLIC_BASE_URL="https://domain-publik-anda.example"
PAYMENT_MODE=midtrans
MIDTRANS_ENV=sandbox
MIDTRANS_SERVER_KEY="SB-Mid-server-xxxxxxxxxxxxxxxx"
MIDTRANS_CLIENT_KEY="SB-Mid-client-xxxxxxxxxxxxxxxx"
```

Daftarkan URL webhook berikut di dashboard Midtrans:
`https://domain-publik-anda.example/payments/midtrans/notification`
(lihat `docs/midtrans-setup.md` untuk langkah lengkap).

### Mode pembayaran

- **`simulation`** (bawaan): QRIS dibuat palsu (`QRIS-SIM:...`), dan ada endpoint uji `POST /payments/:id/simulate-pay` untuk menandai lunas. Endpoint ini otomatis **hilang (404)** saat `PAYMENT_MODE` bukan `simulation`, atau saat `NODE_ENV=production` tanpa `ALLOW_SIMULATE_PAY=true`.
- **`midtrans`**: QR sungguhan dibuat lewat Core API Midtrans. Isi `MIDTRANS_SERVER_KEY` + `PUBLIC_BASE_URL`, lalu daftarkan webhook `POST <PUBLIC_BASE_URL>/payments/midtrans/notification` di dashboard Midtrans. Setiap notifikasi diverifikasi signature dan dikonfirmasi ulang ke Core API sebelum database diubah.

### Mode penyimpanan foto

- **`local`**: berkas disimpan di folder `uploads/` dan disajikan lewat `/uploads/<key>`. Cocok untuk pengembangan; berkas hilang saat deploy ulang di platform tanpa disk persisten.
- **`vercel-blob`**: berkas disimpan di Vercel Blob (butuh `BLOB_READ_WRITE_TOKEN`). Dipakai di produksi.

## Menjalankan di komputer sendiri

1. **Clone dan pasang paket**

   ```
   git clone https://github.com/nibrasalghifary7/SumberSira-backend.git
   cd SumberSira-backend
   npm install
   ```

   `npm install` otomatis menjalankan `prisma generate` (ada di script `postinstall`), jadi Prisma Client langsung tersedia di folder `generated/`.

2. **Siapkan environment.** Salin `.env.example` menjadi `.env` dan isi minimal `DATABASE_URL` (tabel lengkap di atas).

3. **Siapkan database.**
   - Memakai database Neon bersama milik tim: tabel sudah ada, cukup lanjut ke langkah 4.
   - Memakai database kosong milik sendiri: jalankan `npx prisma migrate dev`, lalu isi data awal.

4. **Isi data awal (opsional tapi disarankan)**

   ```
   npm run seed
   npm run seed:extra
   ```

   - `npm run seed` — akun demo (admin + petugas), 8 wahana, 4 slot jam. Aman diulang (`upsert`), sekaligus mengembalikan data awal.
   - `npm run seed:extra` — contoh pengaturan harga, ulasan, dan FAQ awal (hanya diisi kalau tabel masih kosong).

5. **Jalankan server**

   ```
   npm run dev
   ```

   Cek `http://localhost:4000/health/live` (server hidup), `http://localhost:4000/health`
   (server + database siap), dan `http://localhost:4000/health/db` (menampilkan jumlah wahana).

## Perintah npm

| Perintah | Fungsi |
|---|---|
| `npm run dev` | Menjalankan server dengan reload otomatis (`tsx watch`) |
| `npm start` | Menjalankan server produksi (`tsx src/index.ts`, tanpa reload) |
| `npm run lint` | Pemeriksaan tipe TypeScript strict (`tsc --noEmit`) |
| `npm test` | Tes otomatis HTTP (galat, akses, rate limit, request ID) tanpa database |
| `npm run build` | Pemeriksaan build yang dipakai CI (sama dengan `tsc --noEmit`) |
| `npm run seed` | Data awal: akun demo, 8 wahana, 4 slot jam |
| `npm run seed:extra` | Contoh harga, ulasan, dan FAQ (hanya kalau tabel masih kosong) |
| `npm run smoke` | Menjalankan seluruh smoke test P0–P15 secara berurutan |

Proyek ini menjalankan TypeScript langsung dengan `tsx` (tanpa kompilasi ke `dist/`),
jadi `npm run build` adalah pemeriksaan tipe yang dijalankan CI sebelum image Docker
dibangun. Rincian build, deployment, dan strategi migrasi ada di `docs/deployment.md`.

## Akun demo

Dibuat oleh `npm run seed`, **hanya untuk pengembangan**. Ganti dengan password yang kuat sebelum aplikasi dipakai publik.

| Peran | Email | Password | Hak akses |
|---|---|---|---|
| Pengelola (admin) | `admin@sumbersira.id` | `sumbersira` | Semua, termasuk mengubah wahana, harga, dan mengelola akun |
| Petugas Loket | `petugas@sumbersira.id` | `petugas123` | Melihat data, check-in, konfirmasi tunai; tidak boleh mengubah wahana/staff |

## Smoke test

Skrip uji end-to-end ada di `scripts/smoke/`, satu per fase pengembangan ditambah pemeriksaan konfigurasi (`p0.ts` sampai `p15.ts`). Semua skrip menyalakan servernya sendiri di port acak, memakai data berawalan `[SMOKE]`, dan **membersihkan data uji** di akhir, jadi aman dijalankan pada database tim.

```
npx tsx scripts/smoke/all.ts     # seluruh fase P0-P15 berurutan, berhenti di kegagalan pertama
npx tsx scripts/smoke/p8.ts      # satu fase saja
```

Syarat: `.env` terisi `DATABASE_URL`. Mode pembayaran boleh `simulation` (bawaan) — smoke test tidak memakai Midtrans sungguhan.

## Tes otomatis (`tests/`)

Tes cepat untuk lapisan HTTP, **tidak memerlukan database** dan dipakai CI:

```bash
npm test
```

Yang diuji (`tests/api.test.ts`):

- header keamanan helmet, `X-Request-Id` (dari klien maupun dibuat server), dan formatnya;
- route tidak dikenal → 404, body JSON rusak → 400, input tidak valid → 400;
- endpoint privat tanpa sesi → 401, role tidak berhak → 403;
- galat tak terduga → 500 **tanpa stack trace** atau pesan internal;
- rate limit login → 429;
- aturan kekuatan password.

Tes memakai `NODE_ENV=test`, `LOG_LEVEL=silent`, dan `DATABASE_URL` dummy. Uji
end-to-end yang benar-benar menyentuh database ada di `scripts/smoke/`.

## Keamanan

- Password disimpan sebagai hash **scrypt** dengan salt, dibandingkan memakai `timingSafeEqual`.
- Sesi disimpan di database. Cookie hanya membawa token acak, dan yang tersimpan di database adalah hash SHA-256 dari token itu.
- Cookie sesi `ss_admin_session`: `HttpOnly`, `SameSite=Lax`, dan `Secure` di mode produksi. "Ingat saya" berlaku 7 hari, tanpa itu 8 jam.
- Pesan galat login sama untuk email salah, password salah, maupun akun nonaktif.
- Daftar dan pencabutan sesi selalu difilter berdasarkan pemilik akun, sehingga sesi orang lain tidak bisa disentuh.
- Rute `/admin/*` memakai `requireAuth`, dan aksi ubah data memakai `requireRole("admin")`.
- Tipe berkas unggahan diverifikasi dari **magic bytes**, bukan dari `mimetype` klien.
- Hash password tidak pernah dikirim ke klien; galat internal tidak membocorkan stack trace.
- Setiap request mendapat **request ID** (`X-Request-Id`) yang dipakai bersama oleh log
  terstruktur dan body galat, sehingga satu kejadian mudah ditelusuri.
- Log menyensor `Authorization`, `Cookie`, `Set-Cookie`, serta password/token; body
  request tidak dicatat seluruhnya.
- Rate limit berlapis: jaring pengaman seluruh endpoint, pembatas per endpoint, dan
  pembatas percobaan login per email.
- Password baru wajib memenuhi aturan kekuatan (minimal 8 karakter, huruf kecil,
  huruf besar, dan angka) — diperiksa juga di backend, bukan hanya di form.

## Struktur folder

```
prisma/
  schema.prisma        Skema database (AdminUser, AdminSession, Ride, TimeSlot,
                       Setting, SeqCounter, Ticket, Payment, Booking, BookingLine,
                       Review, Faq, UnansweredQuestion, GalleryPhoto, AiPhotoJob)
  migrations/          Riwayat migrasi
  seed.ts              Data awal (akun, wahana, slot)
  seed-extra.ts        Contoh harga, ulasan, FAQ
src/
  index.ts             Menyalakan server, penyapu berkala, graceful shutdown (SIGTERM/SIGINT)
  app.ts               Middleware (request ID, logger, helmet, CORS, JSON, rate limit) lalu registerRoutes
  logger.ts            Logger JSON (pino) + request ID (X-Request-Id)
  config/              Konfigurasi
    index.ts           Validasi variabel environment dengan Zod (objek config)
    database.ts        Koneksi Prisma ke PostgreSQL
    constants.ts       Slot booking, prediksi keramaian per jam
  routes/index.ts      Daftar alamat dasar tiap controller (/auth, /rides, /tickets, /admin/...)
  controllers/         Controller: router dan handler per modul (*.controller.ts):
                       auth, rides, pricing, tickets, payments, bookings, crowd,
                       reviews, chat, gallery, ai-photo, insight, staff
  models/              Model: skema validasi input (zod) dan pemetaan data ke bentuk respons API
                       (ride, ticket, booking, payment, auth, faq, gallery, review, staff, ai-photo).
                       Struktur tabel database sendiri ada di prisma/schema.prisma
  middleware/auth.ts   requireAuth dan requireRole
  services/            Logika bisnis: password, validatePassword, session, insight, enhancer,
                       sweep, payments/ (simulation dan midtrans), storage/ (local dan vercel-blob)
  utils/               Fungsi bantu tanpa state: pricing, time, seq, phone, limiters, errors
  types/express.d.ts   Tipe req.id, req.log, res.locals.user, res.locals.sessionId
tests/
  api.test.ts          Tes HTTP: 4xx/401/403/404/500, rate limit, request ID
docs/
  api.md               Dokumentasi lengkap API + contoh curl/PowerShell
  deployment.md        Docker, CI/CD, health check, graceful shutdown, strategi migrasi
planning/
  planning.md          Rencana kerja fase P0-P12 dan catatan asumsi
scripts/
  demo-crowd.ts        Menambah/menghapus data keramaian demo (isDemo)
  smoke/               Uji end-to-end per fase + all.ts
.github/workflows/
  ci.yml               Lint + test + build, lalu image Docker ke GHCR
Dockerfile             Image multi-stage (deps → build → runtime)
generated/             Prisma Client hasil generate (tidak di-commit)
```

## Deploy

Panduan lengkap (Docker multi-stage, Nginx, health check, zero-downtime,
graceful shutdown, migrasi expand–contract, CI/CD) ada di **`docs/deployment.md`**.

Cara tercepat dengan Docker:

```bash
docker build -t sumbersira-backend .
docker run --rm -p 4000:4000 --env-file .env.production sumbersira-backend
```

Tanpa Docker, di server/hosting:

1. `npm install` — otomatis menjalankan `prisma generate` (`postinstall`).
2. `npx prisma migrate deploy` — menerapkan semua migrasi yang ada di `prisma/migrations/` (tidak pernah mereset data).
3. `npm start` — menjalankan `tsx src/index.ts`.

Setiap push ke `main` yang lolos CI (lint, test, build) otomatis membangun image
Docker dan mendorongnya ke GHCR (`.github/workflows/ci.yml`).

### Render (otomatis setiap push ke `main`)

Repo ini sudah punya `render.yaml`. Di [Render](https://dashboard.render.com): **New → Blueprint**, pilih
repo ini, isi `DATABASE_URL`, `ADMIN_ORIGIN`, `PUBLIC_BASE_URL`, dan (opsional) `EXTRA_ORIGINS`. Setelah itu
setiap push ke `main` otomatis deploy ulang. Cek `https://<alamat-render>/health`.

Variabel environment yang **wajib diisi di server produksi**:

| Variabel | Nilai untuk produksi |
|---|---|
| `NODE_ENV` | `production` (wajib: menonaktifkan CORS localhost, mengaktifkan cookie `Secure`, mematikan `simulate-pay`) |
| `DATABASE_URL` | Connection string database produksi (pooler boleh, tapi migrasi pakai versi direct) |
| `ADMIN_ORIGIN` | Origin web admin/pengunjung yang sudah dideploy, boleh daftar dipisah koma, mis. `https://admin.sumbersira.id,https://app.sumbersira.id` |
| `PUBLIC_BASE_URL` | URL publik API ini, mis. `https://api.sumbersira.id` (dipakai URL foto **dan** URL webhook Midtrans) |
| `TRUST_PROXY` | `1` bila di belakang proxy (Vercel/Railway/Render/NGINX) |
| `LOG_LEVEL` | `info` (pakai `debug` hanya saat investigasi) |
| `ALLOW_SIMULATE_PAY` | `true` hanya untuk demo dengan `PAYMENT_MODE=simulation`; `false` untuk produksi sungguhan |
| `EXTRA_ORIGINS` | Alamat web Flutter yang dideploy, dipisah koma (CORS) |
| `PAYMENT_MODE` | `midtrans` untuk pembayaran sungguhan |
| `MIDTRANS_SERVER_KEY` | Kunci server Midtrans (`MIDTRANS_ENV=production` untuk live) |
| `MIDTRANS_CLIENT_KEY` | Kunci client untuk web admin |
| `STORAGE_DRIVER` | `vercel-blob` (folder lokal tidak persisten di platform cloud) |
| `BLOB_READ_WRITE_TOKEN` | Token Vercel Blob |

Perilaku yang otomatis berubah saat `NODE_ENV=production`: CORS hanya menerima `ADMIN_ORIGIN` dan
`EXTRA_ORIGINS` (aturan `localhost:*` dihapus), cookie sesi menjadi `Secure`, `simulate-pay` butuh
`ALLOW_SIMULATE_PAY=true`, dan galat internal hanya mengembalikan `{"error":"INTERNAL"}` tanpa detail.

## Kerja kelompok dengan Git

1. `git checkout main` lalu `git pull`
2. Buat branch per fitur: `git checkout -b fitur/nama-fitur`
3. Commit kecil dengan pesan jelas, lalu `git push -u origin fitur/nama-fitur`
4. Buka Pull Request ke `main` dan minta anggota lain me-review sebelum merge

Database Neon dipakai bersama, jadi data yang diubah satu orang terlihat oleh semua. Beri nama data uji dengan awalan `test` atau `[SMOKE]` dan hapus setelah dipakai. Data awal bisa dikembalikan kapan saja dengan `npm run seed`.

## Rencana pengembangan

- [x] P0 Fondasi: Express, Prisma, Neon, helmet, CORS, rate limit
- [x] P1 Autentikasi admin dan petugas, sesi tersimpan di database, wahana & harga
- [x] P2 Tiket masuk dan pembayaran (QRIS simulasi / tunai)
- [x] P3 Booking sewa wahana per slot jam
- [x] P4 Integrasi Midtrans: QRIS sungguhan + webhook terverifikasi signature
- [x] P5 Check-in/check-out, Live Crowd, dashboard admin
- [x] P6 Ulasan dan rating
- [x] P7 Chatbot FAQ + pencatatan pertanyaan belum terjawab
- [x] P8 Galeri foto (moderasi admin, magic bytes, local/vercel-blob)
- [x] P9 AI Photo (perbaikan foto dengan sharp, bisa dibagikan ke galeri)
- [x] P10 AI Insight (saran operasional berbasis aturan)
- [x] P11 Manajemen akun petugas/admin + ubah password
- [x] P12 Penutup: dokumentasi lengkap, smoke test seluruh fase, kesiapan deploy
- [x] P13 Keamanan & observability: log JSON + request ID, error handler terpusat, tes HTTP otomatis
- [x] P14 Deployment: Docker multi-stage, GitHub Actions CI/CD, graceful shutdown, health check database
- [ ] Deploy backend dan web admin ke hosting produksi
- [ ] Aplikasi Flutter tersambung ke endpoint publik
