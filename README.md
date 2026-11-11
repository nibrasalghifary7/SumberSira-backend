# SumberSira Backend

REST API untuk aplikasi **Sumber Sira**, wisata kolam mata air di Desa Putukrejo, Malang. Backend ini dipakai bersama oleh dua antarmuka yang ada di repo [SumberSira](https://github.com/deanadibaanugrah/SumberSira):

| Klien | Teknologi | Cara memakai API |
|---|---|---|
| Web admin (pengelola dan petugas) | Next.js + TypeScript | Dipanggil dari server Next.js (Server Action dan DAL), sesi lewat cookie |
| Aplikasi pengunjung | Flutter | Memanggil endpoint publik (tanpa login) |

```
Flutter (pengunjung) ──┐
                       ├──► SumberSira-backend (Express) ──► PostgreSQL (Neon)
Next.js (admin)  ──────┘
```

## Teknologi

- Node.js 20 atau lebih baru (dikembangkan di Node 24)
- Express + TypeScript (dijalankan dengan `tsx`)
- Prisma ORM **versi 7** dengan driver adapter `@prisma/adapter-pg`
- PostgreSQL di Neon (cloud)
- Zod untuk validasi input
- `cookie-parser` dan `cors`
- Claude API (`@anthropic-ai/sdk`) untuk chatbot Tanya Sira (opsional, lihat bagian Chatbot)

> **Penting:** pasang Prisma dengan versi terkunci (`prisma@7` dan `@prisma/client@7`). Menjalankan `npm install prisma` tanpa nomor versi bisa memasang Prisma 8 (rilis kandidat), yang tidak punya perintah `generate` dan `migrate dev`, sehingga proyek ini tidak bisa dijalankan.

## Menjalankan di komputer sendiri

1. **Clone dan pasang paket**

   ```
   git clone https://github.com/nibrasalghifary7/SumberSira-backend.git
   cd SumberSira-backend
   npm install
   ```

2. **Siapkan environment.** Salin `.env.example` menjadi `.env`, lalu isi:

   ```
   DATABASE_URL="postgresql://...neon.tech/neondb?sslmode=require"
   PORT=4000
   ADMIN_ORIGIN=http://localhost:3000
   ```

   | Variabel | Fungsi |
   |---|---|
   | `DATABASE_URL` | Connection string Neon. Pakai versi **direct** (tanpa `-pooler` di alamat host). Minta ke anggota tim lewat chat pribadi. |
   | `PORT` | Port server, bawaan 4000 |
   | `ADMIN_ORIGIN` | Alamat web admin yang diizinkan oleh CORS |
   | `ANTHROPIC_API_KEY` | (Opsional) Kunci Claude API supaya chatbot menjawab dengan AI. Kosong = chatbot tetap jalan dari FAQ dan data bawaan. |
   | `AI_MODEL` | (Opsional) Model yang dipakai chatbot, bawaan `claude-opus-5-5`. Untuk lebih murah dan cepat: `claude-haiku-5-5`. |
   | `DB_SCHEMA` | (Opsional, untuk uji coba) Memakai schema Postgres terpisah, mis. `dean_dev`, supaya data asli di `public` tidak tersentuh. |

   File `.env` berisi password database. **Jangan pernah di-commit.**

3. **Generate Prisma Client** (wajib, hasilnya ada di folder `generated/` yang tidak ikut di-commit)

   ```
   npx prisma generate
   ```

4. **Siapkan database.**
   - Memakai database Neon bersama milik tim: jalankan `npx prisma migrate deploy` (menambah tabel tiket, FAQ, dan chat; data lama aman), lalu `npm run seed` (mengisi FAQ awal bila masih kosong).
   - Memakai database kosong milik sendiri: jalankan `npx prisma migrate dev`, lalu `npm run seed`.

   > **Kalau `prisma migrate` menjawab `P1001: Can't reach database server`** padahal internet jalan dan `npm run dev` bisa terhubung: biasanya jaringan punya IPv6 yang tidak bisa dipakai. Prisma mencoba IPv6 dulu lalu menunggu sampai habis waktu, sedangkan driver `pg` (yang dipakai server) langsung jatuh ke IPv4. Pakai `npm run db:apply`, yang menerapkan file migrasi yang sama lewat `pg` dan mencatatnya di `_prisma_migrations`, jadi hasilnya sama dengan `migrate deploy`.

5. **Jalankan server**

   ```
   npm run dev
   ```

   Cek `http://localhost:4000/health` (harus `{"ok":true}`) dan `http://localhost:4000/health/db` (menampilkan jumlah wahana).

## Perintah npm

| Perintah | Fungsi |
|---|---|
| `npm run dev` | Menjalankan server dengan reload otomatis |
| `npm run seed` | Mengisi akun demo, 8 wahana, 4 slot jam, dan 8 FAQ awal (FAQ hanya diisi bila tabelnya masih kosong). Aman diulang. |
| `npm run seed:demo` | Membuat 20 tiket contoh hari ini dengan jam masuk dan keluar tersebar, untuk mencoba grafik keramaian. Hanya untuk pengembangan. |
| `npm run db:apply` | Menerapkan migrasi lewat `pg` (cadangan bila `prisma migrate` gagal P1001). Mendukung `DB_SCHEMA`. |
| `npm test` | Menjalankan unit test (perhitungan keramaian, pencocokan FAQ, nomor WhatsApp, harga, pembatas permintaan). |
| `npm run build` / `npm start` | Belum dikonfigurasi untuk produksi, akan diatur saat tahap deploy |

## Akun demo

Dibuat oleh `npm run seed`, **hanya untuk pengembangan**. Ganti dengan password yang kuat sebelum aplikasi dipakai publik.

| Peran | Email | Password | Hak akses |
|---|---|---|---|
| Pengelola (admin) | `admin@sumbersira.id` | `sumbersira` | Semua, termasuk mengubah wahana dan harga |
| Petugas Loket | `petugas@sumbersira.id` | `petugas123` | Melihat data, tidak boleh mengubah wahana |

## Daftar endpoint

Kode status yang dipakai: `200` berhasil, `201` dibuat, `400` input tidak valid, `401` belum login, `403` sudah login tetapi perannya tidak berhak, `404` tidak ditemukan, `409` data ganda.

### Status server

| Method | Path | Akses | Fungsi |
|---|---|---|---|
| GET | `/health` | Publik | Server hidup |
| GET | `/health/db` | Publik | Tes koneksi database |

### Autentikasi admin

| Method | Path | Akses | Fungsi |
|---|---|---|---|
| POST | `/auth/login` | Publik | Login (`email`, `password`, `remember` opsional), mengirim cookie sesi |
| POST | `/auth/logout` | Login | Menghapus sesi saat ini |
| GET | `/auth/me` | Login | Data admin yang sedang login, termasuk `sessionId` |
| GET | `/auth/sessions` | Login | Daftar sesi aktif milik akun sendiri |
| POST | `/auth/sessions/revoke-others` | Login | Keluar dari semua perangkat lain |
| DELETE | `/auth/sessions/:id` | Login | Mencabut satu sesi milik sendiri |

### Wahana dan jam kunjungan

| Method | Path | Akses | Fungsi |
|---|---|---|---|
| GET | `/rides` | Publik | Wahana yang berstatus Aktif (untuk Flutter) |
| GET | `/time-slots` | Publik | Pilihan jam kunjungan |
| GET | `/admin/rides` | Admin dan petugas | Semua wahana, termasuk yang Nonaktif |
| POST | `/admin/rides` | Admin | Tambah wahana |
| PATCH | `/admin/rides/:id` | Admin | Ubah wahana (boleh sebagian field) |
| DELETE | `/admin/rides/:id` | Admin | Hapus wahana |

Bentuk data wahana sama dengan katalog di frontend, jadi tidak perlu diubah di sisi klien:

```json
{
  "id": "atv",
  "name": "ATV",
  "category": "Wahana",
  "price": 25000,
  "unit": "15 menit",
  "icon": "atv",
  "status": "Aktif"
}
```

### Tiket masuk dan Live Crowd

Live Crowd dihitung dari tiket yang **discan petugas**: check-in menaikkan angka, check-out menurunkannya, dan hanya tiket yang berlaku hari itu (WIB) yang dihitung. Kapasitas 300 orang; di bawah 40% Sepi, sampai 75% Sedang, di atasnya Ramai. Harga selalu dihitung server (Rp5.000 per orang usia 3 tahun ke atas, balita gratis, ditambah parkir motor 3rb, mobil 10rb, bus 20rb).

| Method | Path | Akses | Fungsi |
|---|---|---|---|
| POST | `/tickets` | Publik | Beli tiket (`name`, `whatsapp`, `adults`, `kids`, `parking`, `payment`, `arrival`, `visitDate` opsional) |
| GET | `/tickets?whatsapp=08...` | Publik | Riwayat tiket satu nomor WhatsApp (tanpa login) |
| GET | `/tickets/:code/status` | Publik | Status satu tiket (belum masuk, di dalam, keluar), tanpa data pribadi |
| GET | `/crowd` | Publik | Live Crowd saat ini |
| GET | `/crowd/hourly` | Publik | Puncak orang di dalam per jam hari ini, dan kebiasaan hari-hari sebelumnya |
| GET | `/admin/tickets?date=` | Admin dan petugas | Daftar tiket satu hari (bawaan hari ini) beserta keramaian |
| GET | `/admin/tickets/code/:code` | Admin dan petugas | Cari tiket dari kodenya, tanggal apa pun |
| POST | `/admin/tickets` | Admin dan petugas | Jual tiket di loket |
| POST | `/admin/tickets/:id/check-in` | Admin dan petugas | Tiket masuk (409 bila sudah dipakai, berlaku hari lain, atau kapasitas penuh) |
| POST | `/admin/tickets/:id/check-out` | Admin dan petugas | Pengunjung keluar |
| GET | `/admin/insight?date=` | Admin dan petugas | Grafik keramaian sepanjang hari, puncak per jam, ringkasan, rincian pembayaran dan parkir |
| GET | `/admin/insight/week` | Admin dan petugas | Pola keramaian 7 hari terakhir (heatmap) |

Dua petugas yang menekan check-in bersamaan pada tiket yang sama tidak menghitung orang dua kali (pembaruan bersyarat di database).

### Chatbot Tanya Sira dan FAQ

Pengunjung punya dua cara bertanya:

1. **Jawab cepat** (`POST /chat/ask`): dicocokkan dulu dengan FAQ buatan pengelola (tanpa AI). Kalau tidak ada, **AI menjawab hanya dari data Sumber Sira** (jam, harga, fasilitas, daftar wahana terbaru dari database, keramaian saat ini, dan FAQ pengelola). Kalau AI belum dipasang atau sedang gangguan, dipakai jawaban cadangan dari kata kunci. Kalau tetap tidak ada, jawabannya kosong dan aplikasi menawarkan "Tanya pengelola".
2. **Tanya pengelola** (`POST /chat/questions`): pertanyaan menunggu dibalas manusia di web admin. Balasannya diambil aplikasi lewat `GET /chat/questions?deviceId=`. Lebih lambat, tapi jawabannya dari pengelola.

AI hanya aktif bila `ANTHROPIC_API_KEY` terisi. Instruksi sistem melarangnya mengarang di luar data, dan pertanyaan pengunjung dibungkus sebagai data (bukan perintah) supaya tidak bisa dipakai untuk mengubah aturannya. Permintaan dibatasi per perangkat dan per alamat IP supaya kuota AI tidak habis.

| Method | Path | Akses | Fungsi |
|---|---|---|---|
| GET | `/chat/faq` | Publik | Daftar FAQ |
| POST | `/chat/ask` | Publik | Jawab cepat (`question`, `deviceId`) |
| POST | `/chat/questions` | Publik | Kirim pertanyaan ke pengelola |
| GET | `/chat/questions?deviceId=` | Publik | Pertanyaan milik perangkat itu beserta balasan |
| GET | `/admin/chat/overview` | Admin dan petugas | FAQ, pertanyaan menunggu, yang sudah dijawab, dan statistik |
| POST | `/admin/chat/questions/:id/answer` | Admin dan petugas | Menjawab (`answer`, `saveAsFaq` agar pertanyaan serupa berikutnya dijawab otomatis) |
| DELETE | `/admin/chat/questions/:id` | Admin dan petugas | Menghapus pertanyaan |
| GET, POST, PATCH | `/admin/chat/faq` | Admin dan petugas | Mengelola FAQ |
| DELETE | `/admin/chat/faq/:id` | Admin | Menghapus FAQ |

## Kecepatan

Database Neon ada di Ohio (us-east-2), jadi tiap query dari Indonesia memakan sekitar 300 ms dan koneksi baru beberapa detik. Yang sudah dilakukan: sesi login disimpan 30 detik di memori (dibuang seketika saat logout atau sesi dicabut), Live Crowd disimpan 3 detik dan dibuang tiap ada check-in atau tiket baru, query yang saling lepas dijalankan bersamaan, dan koneksi database dibiarkan hidup 4 menit serta dihangatkan saat server menyala. Cara paling besar pengaruhnya: buat project Neon baru di **Singapore (ap-southeast-1)** lalu ganti `DATABASE_URL`.

## Keamanan

- Password disimpan sebagai hash **scrypt** dengan salt, dibandingkan memakai `timingSafeEqual`.
- Sesi disimpan di database. Cookie hanya membawa token acak, dan yang tersimpan di database adalah hash SHA-256 dari token itu.
- Cookie sesi `ss_admin_session`: `HttpOnly`, `SameSite=Lax`, dan `Secure` di mode produksi. "Ingat saya" berlaku 7 hari, tanpa itu 8 jam.
- Pesan galat login sama untuk email salah maupun password salah.
- Daftar dan pencabutan sesi selalu difilter berdasarkan pemilik akun, sehingga sesi orang lain tidak bisa disentuh.
- Rute `/admin/*` memakai `requireAuth`, dan aksi ubah data memakai `requireRole("admin")`.
- Hash password tidak pernah dikirim ke klien.
- Endpoint publik (beli tiket, riwayat, chat) dibatasi jumlah permintaannya dan memvalidasi semua input dengan zod. Status tiket publik sengaja tanpa nama dan nomor WhatsApp.
- Kesalahan tak terduga selalu dijawab JSON (`SERVER_ERROR`), tidak membocorkan detail.

## Struktur folder

```
prisma/
  schema.prisma        Skema database (admin, sesi, wahana, slot jam, tiket, FAQ, pertanyaan chat)
  migrations/          Riwayat migrasi
  seed.ts              Data awal (akun, wahana, slot jam, FAQ)
  seed-demo.ts         Tiket contoh untuk mencoba grafik
  apply-migrations.ts  Cadangan migrate deploy lewat pg
src/
  index.ts             Menyalakan server dan memasang rute
  lib/db.ts            Koneksi Prisma
  lib/password.ts      Hash dan verifikasi password
  lib/session.ts       Nama cookie, hash token, pembuat token
  middleware/auth.ts   requireAuth dan requireRole
  routes/auth.ts       Endpoint autentikasi
  routes/rides.ts      Endpoint wahana dan slot jam
  routes/tickets.ts    Tiket, Live Crowd, check-in/out, insight
  routes/chat.ts       Chatbot Tanya Sira, pertanyaan ke pengelola, FAQ
  lib/crowd.ts         Hitungan keramaian (fungsi murni, ada unit test)
  lib/crowd-service.ts Live Crowd dan grafik per jam dari database (dengan cache singkat)
  lib/faq-match.ts     Pencocokan pertanyaan dengan FAQ tanpa AI
  lib/ai.ts            Pemanggil Claude API untuk chatbot
  lib/ratelimit.ts     Pembatas permintaan
  data/knowledge.ts    Data pengetahuan chatbot (jam, harga, fasilitas, aturan)
generated/             Prisma Client hasil generate (tidak di-commit)
```

## Kerja kelompok dengan Git

1. `git checkout main` lalu `git pull`
2. Buat branch per fitur: `git checkout -b fitur/nama-fitur`
3. Commit kecil dengan pesan jelas, lalu `git push -u origin fitur/nama-fitur`
4. Buka Pull Request ke `main` dan minta anggota lain me-review sebelum merge

Database Neon dipakai bersama, jadi data yang diubah satu orang terlihat oleh semua. Beri nama data uji dengan awalan `test` dan hapus setelah dipakai. Data awal bisa dikembalikan kapan saja dengan `npm run seed`.

## Rencana pengembangan

- [x] Fondasi: Express, Prisma, Neon
- [x] Autentikasi admin dan petugas, sesi tersimpan di database
- [x] Endpoint wahana dan jam kunjungan
- [x] Web admin tersambung ke backend (login dan Wahana & Harga)
- [x] Aplikasi Flutter tersambung ke `/rides` dan `/time-slots`
- [ ] Order, booking, dan pembayaran
- [x] Tiket, check-in, dan Live Crowd (grafik dari tiket yang discan)
- [ ] Galeri dan ulasan (upload foto ke Vercel Blob, moderasi admin)
- [x] FAQ dan chatbot Tanya Sira (jawab cepat dengan FAQ dan AI, atau tanya pengelola)
- [x] AI Photo Studio di aplikasi (diproses di HP)
- [ ] Pembatasan percobaan login (rate limiting)
- [ ] Deploy backend dan web admin