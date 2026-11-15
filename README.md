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

## Variabel environment

Salin `.env.example` menjadi `.env`, lalu isi. Semua variabel punya nilai bawaan kecuali `DATABASE_URL`:

| Variabel | Bawaan | Fungsi |
|---|---|---|
| `DATABASE_URL` | (wajib) | Connection string PostgreSQL/Neon. Pakai versi **direct** (tanpa `-pooler` di alamat host) untuk migrasi. |
| `PORT` | `4000` | Port server |
| `ADMIN_ORIGIN` | `http://localhost:3000` | Alamat web admin yang diizinkan CORS |
| `NODE_ENV` | `development` | `production` mengubah perilaku CORS, cookie, dan simulate-pay (lihat bawah) |
| `TRUST_PROXY` | `0` | Jumlah proxy di depan server (di Vercel/Railway/Render biasanya `1`) agar rate limit membaca IP asli |
| `PUBLIC_BASE_URL` | `""` | URL publik server, dipakai provider pembayaran untuk membuat QR Midtrans |
| `PAYMENT_MODE` | `simulation` | `simulation` (QRIS palsu, cocok untuk pengembangan) atau `midtrans` |
| `MIDTRANS_ENV` | `sandbox` | `sandbox` atau `production` (URL API Midtrans) |
| `MIDTRANS_SERVER_KEY` | `""` | Wajib diisi bila `PAYMENT_MODE=midtrans` |
| `MIDTRANS_CLIENT_KEY` | `""` | Dipakai web admin untuk Snap/QR |
| `STORAGE_DRIVER` | `local` | `local` (folder `uploads/`, cocok pengembangan) atau `vercel-blob` |
| `BLOB_READ_WRITE_TOKEN` | `""` | Wajib diisi bila `STORAGE_DRIVER=vercel-blob` |

File `.env` berisi password database dan kunci rahasia. **Jangan pernah di-commit.**

### Mode pembayaran

- **`simulation`** (bawaan): QRIS dibuat palsu (`QRIS-SIM:...`), dan ada endpoint uji `POST /payments/:id/simulate-pay` untuk menandai lunas. Endpoint ini otomatis **hilang (404)** saat `PAYMENT_MODE` bukan `simulation` atau saat `NODE_ENV=production`.
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

   Cek `http://localhost:4000/health` (harus `{"ok":true}`) dan `http://localhost:4000/health/db` (menampilkan jumlah wahana).

## Perintah npm

| Perintah | Fungsi |
|---|---|
| `npm run dev` | Menjalankan server dengan reload otomatis (`tsx watch`) |
| `npm start` | Menjalankan server produksi (`tsx src/index.ts`, tanpa reload) |
| `npm run seed` | Data awal: akun demo, 8 wahana, 4 slot jam |
| `npm run seed:extra` | Contoh harga, ulasan, dan FAQ (hanya kalau tabel masih kosong) |
| `npm run smoke` | Menjalankan seluruh smoke test P0–P12 secara berurutan |

Tidak ada script `build`: proyek ini dijalankan langsung dari TypeScript dengan `tsx`, jadi deploy tidak perlu langkah kompilasi.

## Akun demo

Dibuat oleh `npm run seed`, **hanya untuk pengembangan**. Ganti dengan password yang kuat sebelum aplikasi dipakai publik.

| Peran | Email | Password | Hak akses |
|---|---|---|---|
| Pengelola (admin) | `admin@sumbersira.id` | `sumbersira` | Semua, termasuk mengubah wahana, harga, dan mengelola akun |
| Petugas Loket | `petugas@sumbersira.id` | `petugas123` | Melihat data, check-in, konfirmasi tunai; tidak boleh mengubah wahana/staff |

## Smoke test

Skrip uji end-to-end ada di `scripts/smoke/`, satu per fase pengembangan (`p0.ts` sampai `p12.ts`). Semua skrip menyalakan servernya sendiri di port acak, memakai data berawalan `[SMOKE]`, dan **membersihkan data uji** di akhir, jadi aman dijalankan pada database tim.

```
npx tsx scripts/smoke/all.ts     # seluruh fase P0-P12 berurutan, berhenti di kegagalan pertama
npx tsx scripts/smoke/p8.ts      # satu fase saja
```

Syarat: `.env` terisi `DATABASE_URL`. Mode pembayaran boleh `simulation` (bawaan) — smoke test tidak memakai Midtrans sungguhan.

## Keamanan

- Password disimpan sebagai hash **scrypt** dengan salt, dibandingkan memakai `timingSafeEqual`.
- Sesi disimpan di database. Cookie hanya membawa token acak, dan yang tersimpan di database adalah hash SHA-256 dari token itu.
- Cookie sesi `ss_admin_session`: `HttpOnly`, `SameSite=Lax`, dan `Secure` di mode produksi. "Ingat saya" berlaku 7 hari, tanpa itu 8 jam.
- Pesan galat login sama untuk email salah, password salah, maupun akun nonaktif.
- Daftar dan pencabutan sesi selalu difilter berdasarkan pemilik akun, sehingga sesi orang lain tidak bisa disentuh.
- Rute `/admin/*` memakai `requireAuth`, dan aksi ubah data memakai `requireRole("admin")`.
- Tipe berkas unggahan diverifikasi dari **magic bytes**, bukan dari `mimetype` klien.
- Hash password tidak pernah dikirim ke klien; galat internal tidak membocorkan stack trace.

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
  index.ts             Menyalakan server
  app.ts               Memasang seluruh rute + middleware
  config.ts            Validasi variabel environment dengan Zod
  constants.ts         Slot booking, prediksi keramaian per jam
  lib/                 db, password, session, pricing, time, seq, phone,
                       limiters, errors, insight, enhancer, storage/
  middleware/auth.ts   requireAuth dan requireRole
  routes/              auth, rides, pricing, tickets, payments, bookings,
                       crowd, reviews, chat, gallery, ai-photo, insight, staff
  payments/            Provider pembayaran: simulation dan midtrans
docs/
  api.md               Dokumentasi lengkap API + contoh curl/PowerShell
planning/
  planning.md          Rencana kerja fase P0-P12 dan catatan asumsi
scripts/
  demo-crowd.ts        Menambah/menghapus data keramaian demo (isDemo)
  smoke/               Uji end-to-end per fase + all.ts
generated/             Prisma Client hasil generate (tidak di-commit)
```

## Deploy

Backend dijalankan langsung dengan `tsx`, jadi tidak ada langkah build. Di server/hosting:

1. `npm install` — otomatis menjalankan `prisma generate` (`postinstall`).
2. `npx prisma migrate deploy` — menerapkan semua migrasi yang ada di `prisma/migrations/` (tidak pernah mereset data).
3. `npm start` — menjalankan `tsx src/index.ts`.

Variabel environment yang **wajib diisi di server produksi**:

| Variabel | Nilai untuk produksi |
|---|---|
| `NODE_ENV` | `production` (wajib: menonaktifkan CORS localhost, mengaktifkan cookie `Secure`, mematikan `simulate-pay`) |
| `DATABASE_URL` | Connection string database produksi (pooler boleh, tapi migrasi pakai versi direct) |
| `ADMIN_ORIGIN` | URL web admin yang sudah dideploy, mis. `https://admin.sumbersira.id` |
| `PUBLIC_BASE_URL` | URL publik API ini, mis. `https://api.sumbersira.id` |
| `TRUST_PROXY` | `1` bila di belakang proxy (Vercel/Railway/Render/NGINX) |
| `PAYMENT_MODE` | `midtrans` untuk pembayaran sungguhan |
| `MIDTRANS_SERVER_KEY` | Kunci server Midtrans (`MIDTRANS_ENV=production` untuk live) |
| `MIDTRANS_CLIENT_KEY` | Kunci client untuk web admin |
| `STORAGE_DRIVER` | `vercel-blob` (folder lokal tidak persisten di platform cloud) |
| `BLOB_READ_WRITE_TOKEN` | Token Vercel Blob |

Perilaku yang otomatis berubah saat `NODE_ENV=production`: CORS hanya menerima `ADMIN_ORIGIN` (aturan `localhost:*` dihapus), cookie sesi menjadi `Secure`, endpoint `simulate-pay` dinonaktifkan, dan galat internal hanya mengembalikan `{"error":"INTERNAL"}` tanpa detail.

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
- [ ] Deploy backend dan web admin ke hosting produksi
- [ ] Aplikasi Flutter tersambung ke endpoint publik
