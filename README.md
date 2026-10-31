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

   File `.env` berisi password database. **Jangan pernah di-commit.**

3. **Generate Prisma Client** (wajib, hasilnya ada di folder `generated/` yang tidak ikut di-commit)

   ```
   npx prisma generate
   ```

4. **Siapkan database.**
   - Memakai database Neon bersama milik tim: tabel sudah ada, cukup lanjut ke langkah 5.
   - Memakai database kosong milik sendiri: jalankan `npx prisma migrate dev`, lalu `npm run seed`.

5. **Jalankan server**

   ```
   npm run dev
   ```

   Cek `http://localhost:4000/health` (harus `{"ok":true}`) dan `http://localhost:4000/health/db` (menampilkan jumlah wahana).

## Perintah npm

| Perintah | Fungsi |
|---|---|
| `npm run dev` | Menjalankan server dengan reload otomatis |
| `npm run seed` | Mengisi akun demo, 8 wahana, dan 4 slot jam. Aman diulang (`upsert`), sekaligus mengembalikan data awal. |
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

## Keamanan

- Password disimpan sebagai hash **scrypt** dengan salt, dibandingkan memakai `timingSafeEqual`.
- Sesi disimpan di database. Cookie hanya membawa token acak, dan yang tersimpan di database adalah hash SHA-256 dari token itu.
- Cookie sesi `ss_admin_session`: `HttpOnly`, `SameSite=Lax`, dan `Secure` di mode produksi. "Ingat saya" berlaku 7 hari, tanpa itu 8 jam.
- Pesan galat login sama untuk email salah maupun password salah.
- Daftar dan pencabutan sesi selalu difilter berdasarkan pemilik akun, sehingga sesi orang lain tidak bisa disentuh.
- Rute `/admin/*` memakai `requireAuth`, dan aksi ubah data memakai `requireRole("admin")`.
- Hash password tidak pernah dikirim ke klien.

## Struktur folder

```
prisma/
  schema.prisma        Skema database (AdminUser, AdminSession, Ride, TimeSlot)
  migrations/          Riwayat migrasi
  seed.ts              Data awal
src/
  index.ts             Menyalakan server dan memasang rute
  lib/db.ts            Koneksi Prisma
  lib/password.ts      Hash dan verifikasi password
  lib/session.ts       Nama cookie, hash token, pembuat token
  middleware/auth.ts   requireAuth dan requireRole
  routes/auth.ts       Endpoint autentikasi
  routes/rides.ts      Endpoint wahana dan slot jam
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
- [ ] Aplikasi Flutter tersambung ke `/rides` dan `/time-slots`
- [ ] Order, booking, dan pembayaran
- [ ] Tiket, check-in, dan Live Crowd
- [ ] Galeri dan ulasan (upload foto ke Vercel Blob, moderasi admin)
- [ ] FAQ dan chatbot, AI Photo
- [ ] Pembatasan percobaan login (rate limiting)
- [ ] Deploy backend dan web admin