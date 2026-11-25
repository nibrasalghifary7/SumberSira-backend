# Panduan CHECK POINT

# Materi File Auth & Form Validation

## 1. Frontend — halaman, form, dan sesi pengguna

| Folder + file | Peran / isi yang seharusnya ada |
| --- | --- |
| `src/app/(auth)/login/page.tsx` | Halaman login: menampilkan judul, keterangan, dan komponen form. file ini menampilkan `LoginForm`. |
| `src/app/(auth)/login/components/LoginForm.tsx` | Form email/password, validasi sederhana di browser, pesan kesalahan, dan pengiriman kredensial ke API. |
| `src/app/(auth)/register/page.tsx` | Halaman pendaftaran, **jika aplikasi menyediakan fitur daftar**. Di area auth ada halaman login; belum ditemukan halaman register frontend. |
| `src/app/(auth)/register/components/RegisterForm.tsx` | Form nama/email/password dan konfirmasi password, validasi awal di browser, lalu mengirim data ke endpoint register. Dibutuhkan jika ada halaman pendaftaran. |
| `src/lib/api.ts` | Fungsi untuk mengirim request ke backend, menyertakan token untuk request yang membutuhkannya, dan menangani respons error. |
| `src/lib/user-auth.ts`  | Menyimpan state pengguna untuk kebutuhan tampilan, seperti siapa yang login dan fungsi login/logout. |
| `src/app/(dashboard)/layout.tsx`  | Melindungi tampilan halaman tertentu di frontend—contohnya mengarahkan pengguna yang belum login ke halaman login. Ini membantu UX, tetapi **bukan pengganti pemeriksaan backend**. |
| `src/components/site/auth-gate.tsx` | Komponen yang mengajak pengguna login ketika mencoba fitur yang memerlukan akun. |
| `src/lib/types.ts` | Tipe data pengguna dan respons auth agar frontend tahu bentuk data yang diterima, misalnya `id`, `email`, dan `role`. mendefinisikan tipe pengguna di `types.ts`. |
| `src/lib/validation/auth.ts` | **Opsional:** aturan validasi yang dipakai ulang oleh beberapa form, misalnya format email dan syarat password. Tidak harus dibuat jika proyek memakai pendekatan lain, tetapi bisa menghindari duplikasi validasi frontend. |

> Validasi frontend berguna untuk memberi pesan cepat kepada pengguna. Backend tetap harus memeriksa ulang input karena request dapat dikirim tanpa melalui form web.
> 

## 2. Backend — endpoint, validasi, dan pengamanan akses

| Folder + file | Peran / isi yang seharusnya ada |
| --- | --- |
| `src/app.ts` | Menyiapkan Express, parser JSON, dan memasang router. Prefix `/api/auth`  dipasang di `app.ts` . |
| `src/routes/authRoutes.ts` | Mendaftarkan endpoint, seperti `POST /register`, `POST /login`, `POST /logout`, dan `GET /me`; menentukan middleware yang diperlukan untuk tiap endpoint. Lihat `authRoutes.ts`. |
| `src/controllers/authController.ts` | Menangani proses auth: membaca data request, melakukan validasi, mencari atau membuat akun, memeriksa password, membuat token, dan mengirim respons. Logic auth ada di `authController.ts`. |
| `src/lib/validate.ts` | Aturan validasi input backend yang dapat digunakan ulang, seperti memastikan data berupa string dan format email masuk akal. memiliki helper di `validate.ts`. |
| `src/lib/validatePassword.ts` | Aturan kekuatan password, misalnya minimal panjang tertentu serta huruf besar, huruf kecil, dan angka. |
| `src/middleware/authMiddleware.ts` | Membaca dan memverifikasi token pada request yang dilindungi. Jika valid, middleware memasang informasi pengguna terverifikasi pada `req.user`. Lihat `authMiddleware.ts`. |
| `src/middleware/requireRole.ts` | Memastikan role pengguna sesuai izin endpoint. Contoh: hanya admin yang dapat mengakses route admin. |
| `src/middleware/rateLimiter.ts` | Membatasi percobaan berulang, terutama login, daftar, dan verifikasi OTP. Ini perlindungan tambahan, bukan pengganti validasi.  |
| `src/types/express.d.ts` | Menambahkan tipe `req.user` untuk TypeScript jika middleware menyimpan data pengguna di request. |
| `src/lib/prisma.ts` | Menyediakan koneksi Prisma yang dipakai controller/middleware untuk berinteraksi dengan database. |

# 3. Pahami “Prisma & Migration” lalu terapkan di project kalian

# 4. Pahami materi “**Manajemen File Upload & Cloud Storage** ” lalu terapkan di project kalian memakai vercel blob

| Materi | Gunakan ketika… | Biasanya tidak perlu ketika… | Contoh |
| --- | --- | --- | --- |
| **File Upload & Cloud Storage** | Pengguna atau admin perlu **mengunggah file yang dapat berubah** dan file itu perlu disimpan atau ditampilkan lagi. | Aplikasi hanya mengelola data seperti teks dan angka, atau hanya menampilkan aset tetap bawaan aplikasi. | Pengguna mengirim foto wisata untuk ditinjau admin; admin mengunggah foto produk; pengguna mengunggah bukti pembayaran. |

### **Petunjuk khusus Cloud Storage**

**Pertimbangkan Cloud Storage jika project punya fitur seperti:**

- Admin menambah atau mengganti foto produk web/mobile app lewat dashboard.
- Pengguna mengunggah foto profil, foto laporan, atau bukti pembayaran.
- Pengguna mengirim foto/video untuk ditinjau admin sebelum ditampilkan.
- Aplikasi perlu menyimpan dan menampilkan kembali file yang diunggah.

**Cloud Storage kemungkinan tidak dibutuhkan jika:**

- Dashboard hanya mengelola data seperti nama, harga, kategori, atau status.
- Aplikasi tidak menerima file dari pengguna maupun admin.
- Gambar yang ditampilkan hanya logo atau ilustrasi tetap yang dimasukkan developer ke dalam project, misalnya di `public/images/`.

> **Catatan:** 
Jadi, untuk setiap kelompok, langkah pertama adalah melihat fitur project-nya. Kalau memang ada kebutuhan upload file, barulah rancang alur **pilih file → validasi → simpan ke storage → catat referensinya → tampilkan atau tinjau file**.
> 

# 5. Keamanan, Error & Logging

## **Backend — Express.js**

| Prioritas | File/lokasi | Apa yang harus dilakukan dan ada di file |
| --- | --- | --- |
| Wajib | `src/app.ts` | Susun middleware agar request logger dipasang paling awal, lalu Helmet, rate limiter, parser body, routes, handler 404, dan error handler paling akhir. Atur `trust proxy` jika deployment memang berada di belakang proxy. Batasi origin CORS secara jelas di production. |
| Wajib | `src/middleware/rateLimiter.ts` | Batasi request umum dan endpoint sensitif. Pastikan rate limit menghasilkan 429. Jika aplikasi berjalan di beberapa instance, gunakan store bersama. Nilai 100 request per 15 menit di PPT adalah contoh, bukan angka wajib untuk semua aplikasi. |
| Wajib | Middleware autentikasi dan otorisasi, misalnya `src/middleware/authMiddleware.ts` dan `src/middleware/requireRole.ts` | Pastikan endpoint privat memeriksa identitas dan izin pengguna. Gunakan 401 untuk belum terautentikasi dan 403 untuk tidak berhak. Pertahankan atau lengkapi implementasi yang sudah ada; tidak perlu membuat middleware duplikat. |
| Wajib | Validasi di route/controller dan helper yang sudah digunakan proyek | Validasi input yang diterima server. Input tidak valid harus menghasilkan respons 4xx yang jelas, bukan diteruskan sebagai error server 500. |
| Wajib | `src/lib/httpError.ts` atau kelas error aplikasi yang sudah ada | Gunakan error bertipe untuk kondisi yang memang diharapkan, seperti input salah, data tidak ditemukan, atau akses ditolak. Tidak perlu membuat `AppError` baru jika proyek sudah punya tipe error setara. |
| Wajib | Error handler di `src/app.ts` atau `src/middleware/errorHandler.ts` | Gunakan middleware Express empat argumen dan pasang paling akhir. Bedakan error yang dikenal dari error tak terduga, ikuti format respons API proyek, catat detail internal di log, dan kirim pesan umum untuk 500. Tangani juga kondisi ketika headers respons sudah terkirim. |
| Wajib | Handler 404 di `src/app.ts` | Kembalikan 404 untuk route yang tidak ditemukan. Bedakan dari error tak terduga yang menghasilkan 500. |
| Wajib | `src/logger.ts` dan middleware request logger, misalnya `pino-http` | Catat request secara terstruktur: request ID, method, path, status, dan durasi. Sensor password, token, cookie, dan header authorization; jangan mencatat seluruh body request atau rahasia. |
| Wajib | Pembuatan request ID di konfigurasi logger atau middleware request context | Buat atau validasi request ID, kirimkan sebagai header respons, dan sertakan ID yang sama dalam log serta respons error bila format API mendukungnya. Ini membantu menelusuri satu kejadian. |
| Wajib | Route/controller async di Express 4 | Pastikan rejection atau error async diteruskan ke error handler—misalnya memakai `try/catch` dengan `next(err)` atau async wrapper. Jangan menganggap perilaku otomatis pada contoh Express 5 berlaku di Express 4. |
| Wajib | `tests/` | Uji input salah 4xx, akses tidak berhak 401/403, data tidak ditemukan 404, dan error tak terduga 500 tanpa stack trace di respons. Uji juga rate limit dan konsistensi request ID/log bila memungkinkan. |

## **Frontend — Next.js App Router**

| Prioritas | File/lokasi | Apa yang harus dilakukan dan ada di file |
| --- | --- | --- |
| Wajib | `next.config.js` atau `next.config.ts` | Atur header keamanan yang sesuai, seperti `X-Content-Type-Options: nosniff` dan `X-Frame-Options: DENY`, sesuai slide 5. Konfigurasi `allowedOrigins` hanya jika aplikasi menggunakan proxy/CDN yang memerlukannya—jangan menambahkannya tanpa alasan. |
| Wajib jika menggunakan Server Actions | File Server Action terkait | Perlakukan setiap action sebagai pintu publik: periksa autentikasi dan otorisasi di action, validasi input, dan kembalikan data secukupnya—jangan mengandalkan form atau tombol yang disembunyikan sebagai pengaman. |
| Wajib | `src/app/error.tsx` atau `app/error.tsx` | Buat error boundary per segmen. Tampilkan pesan aman dan fungsi coba lagi melalui `reset()`. File ini harus menjadi Client Component. |
| Wajib | Penanganan di event handler terkait | Error dari event handler tidak otomatis ditangkap error boundary. Tangani dengan `try/catch` dan state agar pengguna mendapat umpan balik yang sesuai. |
| Wajib | `src/app/not-found.tsx` atau `app/not-found.tsx` | Tampilkan halaman 404 untuk kondisi yang memang ditandai dengan `notFound()`. |
| Wajib jika menangani error root | `src/app/global-error.tsx` atau `app/global-error.tsx` | Tangani error pada root layout. Komponen harus menyediakan elemen `<html>` dan `<body>` sendiri. |
| Wajib untuk pelaporan error server Next.js | `instrumentation.ts` atau `src/instrumentation.ts` sesuai struktur proyek | Gunakan `onRequestError` untuk mencatat error server Next.js. Log harus aman dan tidak berisi token atau data sensitif yang tidak diperlukan. |
| Wajib | Tes di folder tes proyek | Uji tampilan error, halaman 404, dan respons saat API gagal. Pastikan detail internal server tidak ditampilkan kepada pengguna. |
|  |  |  |

# 6. Performa (Khusus Web Dashboard)

Karena proyek yang Anda kembangkan adalah **web dashboard** (bukan website publik yang mengandalkan SEO seperti blog atau e-commerce umum), fokus utama pada materi ini **bukanlah SEO**, melainkan **optimasi kecepatan, kestabilan layout, dan efisiensi data**.
• **Core Web Vitals yang Perlu Dipantau:**
    ◦ **LCP (Largest Contentful Paint $\le$ 2,5 detik):** Pastikan elemen visual utama dashboard (seperti grafik awal atau tabel ringkasan data) termuat dengan cepat.   
    ◦ **INP (Interaction to Next Paint $\le$ 200 ms):** Pastikan tombol navigasi, filter tabel, dan form di dashboard langsung responsif saat diklik/diketik.   
    ◦ **CLS (Cumulative Layout Shift $\le$ 0,1):** Pastikan tata letak elemen dashboard tidak bergeser atau "melompat-lompat" saat data dari API selesai dimuat.   
• **Pengecekan Wajib untuk Performa Dashboard:**
    ◦ **Uji di Mode Produksi:** Jangan menguji performa menggunakan `npm run dev`. Lakukan `next build` lalu `next start` sebelum mengetesnya via Lighthouse.   
    ◦ **Implementasi Pagination:** Pastikan data tabel yang besar dipecah menggunakan *pagination* (misalnya `page=1`, `limit=10`) agar browser dan server tidak berat merender ribuan data sekaligus.
    ◦ **Optimasi Aset & Gambar:** Gunakan komponen `<Image/>` Next.js dengan atribut `sizes` yang tepat untuk avatar atau ilustrasi agar ukuran unduhan gambar optimal.   
    ◦ **Analisis Bundle (`npx next analyze`):** Pastikan tidak ada *library* berat di sisi *client* yang membuat ukuran file JavaScript bengkak.   

# 7. Deployment, CI/CD & Produksi

### **1. Apa itu CI/CD (Bahasa Santai)**

- **CI (Continuous Integration / Integrasi Berkelanjutan):** Asisten otomatis yang bertugas mengecek kode barumu setiap kali kamu kirim (*push* atau *pull request*). Dia akan otomatis menjalankan *linting*, tes, dan *build* untuk memastikan kodemu **tidak error** sebelum digabung ke branch utama (`main`).
- **CD (Continuous Deployment / Pengiriman Berkelanjutan):** Jalur otomatis berikutnya. Kalau kodenya sudah lolos tes CI, sistem akan otomatis membungkus aplikasimu (biasanya pakai **Docker**), mengirimkannya ke server, mengetes kesehatan aplikasimu, lalu mengganti versi lama dengan versi baru **tanpa bikin webnya down (tanpa deg-degan)**.

### **2. Rangkuman Inti Materi (Catatan Penting)**

1. **Prinsip Docker & Environment (Build vs Runtime):**
    - *Image* Docker yang sama harus bisa dipakai di mana saja (development, staging, production).
    - Variabel yang pakai awalan `NEXT_PUBLIC_*` **akan terkunci permanen saat proses `next build`**. Jadi, jangan masukkan rahasia atau URL dinamis ke dalam `NEXT_PUBLIC_*`. Variabel rahasia (seperti `DATABASE_URL`) dibaca saat *runtime* (saat aplikasi jalan).
2. **Arsitektur Produksi (Susunan di Server):**
    - Di depan dipasang **Nginx** (berfungsi sebagai *reverse proxy* dan pengaman SSL/TLS).
    - Karena pakai proxy di depan, aplikasi Express kamu butuh konfigurasi `app.set('trust proxy', 1)` agar pembatasan akses (*rate limit*) dan pembacaan IP klien tidak salah.
3. **Health Check & Zero-Downtime:**
    - Server harus punya endpoint `/health` (yang mengecek apakah koneksi ke database MySQL aman).
    - Saat rilis versi baru, sistem tidak langsung mematikan yang lama. Versi baru dijalankan dulu, dicek kesehatan (*health check*)-nya via endpoint `/health`. Kalau lolos, baru trafik dialihkan ke versi baru. Kalau gagal, versi lama tetap dibiarkan jalan (*rollback* aman).

### **3. Tugasnya Itu Sebenarnya Apa? (Pengecekan & Praktik)**

Dalam konteks kuliah/capstone ini, tugas dan hal-hal yang harus kamu pastikan terkait deployment meliputi:

- **Membuat `Dockerfile` yang Optimal:**
Menggunakan teknik *multi-stage build* agar ukuran *image* Docker kecil dan aman (tidak membawa alat *build* atau file rahasia seperti `.env` dan folder `node_modules` ke dalam server).
- **Menyiapkan GitHub Actions (Workflow CI/CD):**
Membuat file otomatisasi (biasanya di `.github/workflows/...`) agar setiap ada *Pull Request* atau *Merge* ke branch `main`, GitHub yang mengecek kodenya (jalankan `npm run lint`, `npm test`, dan `npm run build`) secara otomatis.
- **Mengatur Penanganan Error & Sinyal Server (Graceful Shutdown):**
Memastikan aplikasi Express/Node.js di server bisa berhenti secara sopan saat ada pembaruan (*SIGTERM handler*), yaitu menyelesaikan dulu request yang sedang berjalan sebelum benar-benar menutup koneksi database.
- **Strategi Migrasi Database:**
Jika ada perubahan struktur database (misal tambah kolom), harus dilakukan secara bertahap (*expand-contract pattern*) supaya saat versi aplikasi lama dan versi baru jalan bersamaan sejenak, aplikasinya tidak *crash*.