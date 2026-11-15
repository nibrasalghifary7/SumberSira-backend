# Dokumentasi API Sumber Sira Backend

Base URL lokal: `http://localhost:4000`

Semua respons galat menggunakan format seragam:
```json
{
  "error": "KODE_GALAT",
  "issues": [] // opsional, jika error VALIDATION
}
```

---

## 1. Umum

### GET /
- **Akses**: Publik
- **Respons**:
  ```json
  { "name": "SumberSira API", "status": "ok" }
  ```

### GET /health
- **Akses**: Publik
- **Respons**: `{ "ok": true }`

### GET /health/db
- **Akses**: Publik
- **Respons**: `{ "ok": true, "rides": 8 }`

---

## 2. Autentikasi Admin & Petugas

### POST /auth/login
- **Akses**: Publik (Rate limit: maks 5 gagal/menit per email)
- **Body**:
  ```json
  {
    "email": "admin@sumbersira.id",
    "password": "...",
    "remember": false
  }
  ```
- **Cookie**: Menyetel cookie `ss_admin_session` (HttpOnly, `Secure` di produksi). `remember: true` → 7 hari, tanpanya 8 jam.
- **Respons**: `{ "id", "name", "email", "role" }`
- **Kode galat**: `400 VALIDATION`, `401 INVALID_CREDENTIALS` (email salah / password salah / akun nonaktif — pesan sama), `429 RATE_LIMITED`

### GET /auth/me
- **Akses**: Terautentikasi (Cookie `ss_admin_session`)
- **Respons**:
  ```json
  {
    "id": "...",
    "name": "...",
    "email": "...",
    "role": "admin",
    "sessionId": "..."
  }
  ```
- **Kode galat**: `401 UNAUTHENTICATED` (cookie hilang, sesi kadaluarsa, atau akun dinonaktifkan)

### POST /auth/logout
- **Akses**: Terautentikasi
- **Respons**: `{ "ok": true }` (sesi dihapus, cookie dikosongkan)

### GET /auth/sessions
- **Akses**: Terautentikasi
- **Respons**: Daftar sesi milik akun sendiri, terbaru di atas:
  ```json
  [
    { "id": "...", "userAgent": "...", "createdAt": "...", "expiresAt": "...", "current": true }
  ]
  ```

### POST /auth/sessions/revoke-others
- **Akses**: Terautentikasi
- **Fungsi**: Keluar dari semua perangkat lain; sesi saat ini tetap aktif.
- **Respons**: `{ "ok": true, "count": 2 }`

### DELETE /auth/sessions/:id
- **Akses**: Terautentikasi
- **Fungsi**: Mencabut satu sesi milik sendiri (selalu difilter `userId`).
- **Respons**: `{ "ok": true }`
- **Kode galat**: `404 NOT_FOUND` (bukan milik sendiri atau sudah tidak ada)

### POST /auth/change-password
- **Akses**: Terautentikasi (P11)
- **Body**: `{ "currentPassword": "...", "newPassword": "..." }` (password 8..72 karakter)
- **Aturan**: password lama salah → `401 INVALID_CREDENTIALS`; password baru tidak boleh sama dengan email atau password lama → `400 VALIDATION`.
- **Hasil**: password berganti, **sesi lain dicabut**, sesi saat ini tetap aktif.

---

## 3. Wahana & Slot Jam

### GET /rides
- **Akses**: Publik
- **Respons**: Array wahana berstatus `Aktif`, urut kategori lalu nama:
  ```json
  [
    { "id": "atv", "name": "ATV", "category": "Wahana", "price": 25000, "unit": "15 menit", "icon": "atv", "status": "Aktif" }
  ]
  ```

### GET /time-slots
- **Akses**: Publik
- **Respons**: Array slot kedatangan:
  ```json
  [ { "id": "pagi", "label": "08.00 - 10.00", "range": "08.00 - 10.00", "busy": false } ]
  ```

### GET /admin/rides
- **Akses**: Admin, Petugas
- **Respons**: Semua wahana, termasuk yang `Nonaktif` (bentuk sama dengan `GET /rides`).

### POST /admin/rides
- **Akses**: Admin
- **Body** (`unit`, `icon`, `status` boleh dikosongkan → diisi default `""`, `"ring"`, `"Aktif"`; `id` dibuat otomatis dari nama):
  ```json
  { "name": "Kolam Renang Anak", "category": "Wahana", "price": 15000, "unit": "per orang", "icon": "pool", "status": "Aktif" }
  ```
- **Respons (201)**: Objek wahana baru (bentuk sama seperti `GET /rides`).
- **Kode galat**: `400 VALIDATION`, `409 DUPLICATE` (id dari nama sudah dipakai), `403 FORBIDDEN` (petugas)

### PATCH /admin/rides/:id
- **Akses**: Admin
- **Body**: Semua field boleh dikirim sebagian; `status: "Aktif" | "Nonaktif"` dipetakan ke `active`.
  ```json
  { "price": 30000, "status": "Nonaktif" }
  ```
- **Respons**: Objek wahana terbaru.
- **Kode galat**: `400 VALIDATION` (body kosong juga ditolak), `404 NOT_FOUND`, `403 FORBIDDEN`

### DELETE /admin/rides/:id
- **Akses**: Admin
- **Respons**: `{ "ok": true }`
- **Kode galat**: `404 NOT_FOUND`, `403 FORBIDDEN`


---

## 4. Pengaturan Harga & Slot Booking (P1)

### GET /pricing
- **Akses**: Publik
- **Respons**:
  ```json
  {
    "ticketPricePerPerson": 5000,
    "capacity": 300,
    "parking": [
      { "key": "none", "label": "Jalan kaki", "price": 0 },
      { "key": "motor", "label": "Motor", "price": 3000 },
      { "key": "mobil", "label": "Mobil", "price": 10000 },
      { "key": "bus", "label": "Bus", "price": 20000 }
    ]
  }
  ```

### GET /booking-slots
- **Akses**: Publik
- **Respons**:
  ```json
  [
    { "id": "08-09", "label": "08.00 - 09.00" },
    { "id": "09-10", "label": "09.00 - 10.00" },
    ...
  ]
  ```

### GET /admin/pricing
- **Akses**: Admin, Petugas
- **Respons**:
  ```json
  {
    "ticketPricePerPerson": 5000,
    "capacity": 300,
    "parking": {
      "none": 0,
      "motor": 3000,
      "mobil": 10000,
      "bus": 20000
    }
  }
  ```

### PUT /admin/pricing
- **Akses**: Admin
- **Body**:
  ```json
  {
    "ticketPricePerPerson": 6000,
    "capacity": 350,
    "parking": {
      "none": 0,
      "motor": 4000,
      "mobil": 12000,
      "bus": 25000
    }
  }
  ```
- **Respons**: Data harga yang telah diperbarui.
- **Kode galat**: `400 VALIDATION`, `403 FORBIDDEN` (petugas)


---

## 5. Tiket Masuk & Pembayaran (P2)

### POST /tickets
- **Akses**: Publik (`writeLimiter`)
- **Body**:
  ```json
  {
    "name": "Budi Santoso",
    "whatsapp": "081234567890",
    "adults": 2,
    "kids": 1,
    "parking": "motor",
    "arrival": "08.00 - 10.00",
    "paymentMethod": "qris" // atau "cash"
  }
  ```
- **Respons (201)**:
  ```json
  {
    "code": "TK-1001",
    "name": "Budi Santoso",
    "whatsapp": "081234567890",
    "adults": 2,
    "kids": 1,
    "people": 3,
    "parking": "motor",
    "arrival": "08.00 - 10.00",
    "visitDate": "2026-11-12",
    "amount": 13000,
    "status": "waiting",
    "paymentStatus": "pending",
    "checkInAt": null,
    "checkOutAt": null,
    "createdAt": "2026-11-12T...",
    "payment": {
      "id": "...",
      "method": "qris",
      "status": "pending",
      "amount": 13000,
      "qrString": "QRIS-SIM:TK-1001-XXXX:13000",
      "qrUrl": null,
      "expiresAt": "..."
    }
  }
  ```

### GET /tickets/:code?whatsapp=
- **Akses**: Publik (`publicLimiter`)
- **Query**: `whatsapp` wajib cocok dengan tiket (A4). Jika tidak cocok atau tidak ada: `404 NOT_FOUND`.
- **Respons**: Objek tiket (bentuk sama dengan respons `POST /tickets`).

### GET /tickets?whatsapp=
- **Akses**: Publik (`publicLimiter`)
- **Query**: `whatsapp` wajib disertakan (`400 VALIDATION` jika kosong).
- **Respons**: Array riwayat tiket milik nomor WhatsApp tersebut, terbaru di atas.

### GET /payments/:id
- **Akses**: Publik (`publicLimiter`)
- **Respons**: Data status pembayaran terkini (`id`, `ticketId`, `bookingId`, `method`, `provider`, `status`, `amount`, `qrString`, `qrUrl`, `expiresAt`, `paidAt`, ...). Jika pending dan QRIS, otomatis sinkronisasi ke provider.
- **Kode galat**: `404 NOT_FOUND`

### POST /payments/:id/simulate-pay
- **Akses**: Publik (Hanya saat `PAYMENT_MODE=simulation` **dan bukan** produksi; selain itu `404 NOT_FOUND`).
- **Fungsi**: Mensimulasikan pembayaran QRIS menjadi lunas (`paid`). Idempoten.
- **Respons**: Data pembayaran terbaru.

### GET /admin/tickets?date=&status=&q=&page=&limit=
- **Akses**: Admin, Petugas
- **Query**: `date` (default hari ini WIB), `status` (waiting/inside/out), `q` (kode/nama/wa), `page` (default 1), `limit` (default 50, maks 100).
- **Respons**:
  ```json
  { "total": 25, "page": 1, "limit": 50, "items": [ { "...tiket": "..." } ] }
  ```

### POST /admin/tickets/:code/confirm-cash
- **Akses**: Admin, Petugas
- **Fungsi**: Konfirmasi pembayaran tunai oleh petugas di loket. Tiket & pembayaran menjadi `paid`.
- **Respons**: Objek tiket terbaru (`paymentStatus: "paid"`).
- **Kode galat**: `404 NOT_FOUND`, `409 INVALID_STATE` (bukan metode tunai / sudah lunas)

### POST /admin/payments/:id/mark-paid
- **Akses**: Admin
- **Fungsi**: Menandai lunas pembayaran secara manual jika masih pending.
- **Respons**: Data pembayaran terbaru.
- **Kode galat**: `404 NOT_FOUND`, `409 INVALID_STATE` (status bukan `pending`), `403 FORBIDDEN`

### POST /admin/payments/:id/cancel
- **Akses**: Admin
- **Fungsi**: Membatalkan pembayaran pending.
- **Respons**: Data pembayaran terbaru (`status: "cancelled"`).
- **Kode galat**: `404 NOT_FOUND`, `409 INVALID_STATE`, `403 FORBIDDEN`


---

## 6. Booking Sewa & Wahana (P3)

### POST /bookings
- **Akses**: Publik (`writeLimiter`)
- **Fungsi**: Memesan sewa alat dan wahana. Metode pembayaran hanya **QRIS**.
- **Body**:
  ```json
  {
    "name": "Budi Santoso",
    "whatsapp": "085678901234",
    "slot": "09-10",
    "visitDate": "2026-11-12", // opsional, default hari ini WIB, maks 30 hari ke depan
    "items": [
      { "rideId": "atv", "qty": 2 },
      { "rideId": "ban-kecil", "qty": 1 }
    ]
  }
  ```
- **Respons (201)**:
  ```json
  {
    "code": "SS-20261112-001",
    "name": "Budi Santoso",
    "whatsapp": "085678901234",
    "slot": "09-10",
    "slotLabel": "09.00 - 10.00",
    "visitDate": "2026-11-12",
    "amount": 55000,
    "paymentStatus": "pending",
    "createdAt": "...",
    "lines": [
      {
        "rideId": "atv",
        "name": "ATV (15 menit)",
        "qty": 2,
        "unitPrice": 25000,
        "subtotal": 50000
      },
      {
        "rideId": "ban-kecil",
        "name": "Ban Kecil/Sedang",
        "qty": 1,
        "unitPrice": 5000,
        "subtotal": 5000
      }
    ],
    "payment": {
      "id": "...",
      "method": "qris",
      "status": "pending",
      "amount": 55000,
      "qrString": "QRIS-SIM:SS-20261112-001-XXXX:55000",
      "qrUrl": null,
      "expiresAt": "..."
    }
  }
  ```

### GET /bookings/:code?whatsapp=
- **Akses**: Publik (`publicLimiter`)
- **Query**: `whatsapp` wajib disertakan dan cocok. Tidak cocok: `404 NOT_FOUND`.

### GET /bookings?whatsapp=
- **Akses**: Publik (`publicLimiter`)
- **Respons**: Array riwayat booking milik nomor WhatsApp tersebut.

### GET /admin/bookings?date=&q=&page=&limit=
- **Akses**: Admin, Petugas
- **Query**: `date` (YYYY-MM-DD, opsional — tanpa filter = semua tanggal), `q` (kode/nama/wa), `page` (default 1), `limit` (default 50, maks 100).
- **Respons**: `{ "total", "page", "limit", "items": [ ...booking ] }`

### GET /admin/bookings/:code
- **Akses**: Admin, Petugas
- **Respons**: Objek booking lengkap dengan `lines` dan `payment`.
- **Kode galat**: `404 NOT_FOUND`


---

## 7. Midtrans Integration & Webhook (P4)

### POST /payments/midtrans/notification
- **Akses**: Publik (Webhook resmi Midtrans)
- **Header**: `Content-Type: application/json`
- **Body**: Payload standar HTTP Notification Midtrans (`order_id`, `status_code`, `gross_amount`, `signature_key`, `transaction_status`, dsb.)
- **Keamanan**:
  - Validasi signature SHA-512 menggunakan string `gross_amount` persis dengan `crypto.timingSafeEqual`.
  - Verifikasi ulang status ke Core API Midtrans `GET /v2/:order_id/status` sebagai sumber kebenaran sebelum mengupdate database.
  - Idempoten: pengiriman berulang tidak mengubah transaksi yang sudah final (`paid`).
  - Respons `200 { ok: true }` atau `200 { ok: true, ignored: true }` jika order id tidak cocok/jumlah berbeda.


---

## 8. Check-in, Live Crowd, & Dashboard (P5)

### POST /admin/tickets/:code/check-in
- **Akses**: Admin, Petugas
- **Syarat**: Tiket `paymentStatus=paid`, `status=waiting`, dan `visitDate` hari ini (WIB).
- **Hasil**: `status=inside`, mengisi timestamp `checkInAt`.

### POST /admin/tickets/:code/check-out
- **Akses**: Admin, Petugas
- **Syarat**: Tiket `status=inside`.
- **Hasil**: `status=out`, mengisi timestamp `checkOutAt`.

### GET /crowd
- **Akses**: Publik (`publicLimiter`)
- **Respons**:
  ```json
  {
    "inside": 120,
    "capacity": 300,
    "percent": 40,
    "label": "Sedang", // "< 40": Sepi, "<= 75": Sedang, "> 75": Ramai
    "updatedAt": "...",
    "forecast": [
      { "hour": "08", "count": 30 },
      ...
    ]
  }
  ```

### GET /admin/dashboard
- **Akses**: Admin, Petugas
- **Respons**:
  ```json
  {
    "ticketsToday": 25,
    "visitorsToday": 60,
    "bookingsToday": 8,
    "revenueToday": 450000,
    "pendingCash": 2,
    "pendingQris": 1,
    "crowd": {
      "inside": 45,
      "capacity": 300,
      "percent": 15,
      "label": "Sepi"
    }
  }
  ```


---

## 9. Ulasan & Rating (P6)

### GET /reviews?limit=
- **Akses**: Publik (`publicLimiter`)
- **Query**: `limit` (default 20, maks 100)
- **Respons**:
  ```json
  {
    "items": [
      {
        "id": "...",
        "name": "Bu Rani S.",
        "stars": 5,
        "text": "Airnya jernih banget, anak-anak senang main di kolam!",
        "createdAt": "..."
      }
    ],
    "rating": 4.7,
    "count": 3
  }
  ```

### POST /reviews
- **Akses**: Publik (`writeLimiter`)
- **Body**:
  ```json
  {
    "name": "Dimas P.",
    "stars": 4, // 1..5
    "text": "Spot foto oke, tapi pas siang rame banget."
  }
  ```
- **Respons (201)**: Data review baru.

### GET /admin/reviews
- **Akses**: Admin
- **Respons**: Array semua ulasan, terbaru di atas: `[{ id, name, stars, text, createdAt }]`

### DELETE /admin/reviews/:id
- **Akses**: Admin
- **Respons**: `{ "ok": true }`
- **Kode galat**: `404 NOT_FOUND`


---

## 10. Chatbot & FAQ (P7)

### POST /chat
- **Akses**: Publik (`writeLimiter`)
- **Body**: `{ "message": "jam buka?" }`
- **Respons**:
  ```json
  {
    "answer": "Weekday buka 08.00-16.00, weekend 08.00-17.00 ya!",
    "matched": true
  }
  ```
  Jika tidak cocok, disimpan ke daftar pertanyaan belum terjawab dan mengembalikan:
  ```json
  {
    "answer": "Maaf, aku belum punya jawabannya. Pertanyaanmu sudah dicatat untuk admin ya.",
    "matched": false
  }
  ```

### GET /chat/quick-questions
- **Akses**: Publik

### GET /admin/faq
- **Akses**: Admin
- **Respons**: Array semua FAQ (termasuk yang tidak aktif) dengan `id`, `keys`, `answer`, `sortOrder`, `active`.

### POST /admin/faq
- **Akses**: Admin
- **Body**: `{ "keys": ["jam"], "answer": "...", "sortOrder": 1, "active": true }` (`keys` minimal 1 kata kunci)
- **Respons (201)**: FAQ baru yang dibuat.

### PATCH /admin/faq/:id
- **Akses**: Admin
- **Body**: Field mana pun boleh dikirim sebagian (`keys` / `answer` / `sortOrder` / `active`).
- **Respons**: FAQ terbaru.
- **Kode galat**: `400 VALIDATION`, `404 NOT_FOUND`

### DELETE /admin/faq/:id
- **Akses**: Admin
- **Respons**: `{ "ok": true }`
- **Kode galat**: `404 NOT_FOUND`

### GET /admin/faq/unanswered
- **Akses**: Admin
- **Respons**: Array pertanyaan pengunjung yang tidak cocok dengan FAQ mana pun, terbaru di atas: `[{ id, question, createdAt }]`

### DELETE /admin/faq/unanswered/:id
- **Akses**: Admin
- **Fungsi**: Tandai selesai (hapus) satu pertanyaan yang belum terjawab.
- **Respons**: `{ "ok": true }`
- **Kode galat**: `404 NOT_FOUND`


---

## 11. Galeri Foto (P8)

> Penyimpanan dipilih lewat `STORAGE_DRIVER`: `local` (folder `uploads/`, disajikan lewat `/uploads/<key>`) atau `vercel-blob` (butuh `BLOB_READ_WRITE_TOKEN`). Tipe file diverifikasi dari **magic bytes** (JPEG/PNG/WebP), bukan dari `mimetype` klien. Batas ukuran **4 MB**.

### POST /gallery
- **Akses**: Publik (`writeLimiter`)
- **Content-Type**: `multipart/form-data`
- **Body**: `photo` (berkas, JPEG/PNG/WebP maks 4 MB), `title` (1..60), `owner` (1..40)
- **Kode galat**: `413 FILE_TOO_LARGE`, `415 UNSUPPORTED_MEDIA`, `400 VALIDATION`
- **Respons (201)**:
  ```json
  {
    "id": "...",
    "url": "http://localhost:4000/uploads/gallery/cuid.png",
    "title": "Kolam anak",
    "owner": "Budi",
    "ai": false,
    "status": "pending",
    "createdAt": "..."
  }
  ```

### GET /gallery?limit=
- **Akses**: Publik (`publicLimiter`)
- **Query**: `limit` (default 20, maks 100)
- **Respons**: Array foto berstatus `approved` saja, terbaru di atas: `[{ id, url, title, owner, ai, createdAt }]`

### GET /admin/gallery?status=
- **Akses**: Admin
- **Query**: `status` (`pending` | `approved` | `rejected`, opsional)
- **Respons**: Semua foto lengkap dengan `storageKey` dan `reviewedAt`.

### PATCH /admin/gallery/:id
- **Akses**: Admin
- **Body**: `{ "status": "approved" | "rejected" }`
- **Hasil**: Status diperbarui dan `reviewedAt` diisi. Foto `approved` langsung tampil di galeri publik.

### DELETE /admin/gallery/:id
- **Akses**: Admin
- **Fungsi**: Menghapus baris database **dan** berkas fisiknya dari penyimpanan (`remove`).
  - **Khusus foto dari AI Photo (`ai: true`)**: hanya baris yang dihapus; berkas hasil dipertahankan karena masih dirujuk oleh `AiPhotoJob` (`resultUrl`). Job tidak pernah ikut terhapus.


---

## 12. AI Photo (P9)

> Perbaikan gambar dilakukan **lokal dengan `sharp`** (rotate EXIF, resize maks 2048 px tanpa memperbesar, normalise, brightness 1.05, saturation 1.2, sharpen, JPEG kualitas 88) melalui antarmuka `ImageEnhancer` — bisa diganti layanan AI sungguhan nanti. Validasi file sama dengan galeri: magic bytes JPEG/PNG/WebP, maks 4 MB.

### POST /ai-photo
- **Akses**: Publik (`aiPhotoLimiter`, 10 permintaan/menit/IP)
- **Content-Type**: `multipart/form-data`
- **Body**: `photo` (berkas gambar, maks 4 MB)
- **Alur**: simpan asli (`ai/<id>-original.<ext>`), perbaiki, simpan hasil (`ai/<id>-result.jpg`)
- **Kode galat**: `413 FILE_TOO_LARGE`, `415 UNSUPPORTED_MEDIA`, `400 VALIDATION`, `422 PROCESSING_FAILED` (job tersimpan berstatus `failed` dengan `error` ringkas)
- **Respons (201)**:
  ```json
  {
    "id": "...",
    "status": "done",
    "originalUrl": "http://localhost:4000/uploads/ai/xxx-original.png",
    "resultUrl": "http://localhost:4000/uploads/ai/xxx-result.jpg"
  }
  ```

### GET /ai-photo/:id
- **Akses**: Publik (`publicLimiter`)
- **Respons**:
  ```json
  {
    "id": "...",
    "status": "done",
    "originalUrl": "...",
    "resultUrl": "...",
    "error": null,
    "createdAt": "..."
  }
  ```

### POST /ai-photo/:id/share-to-gallery
- **Akses**: Publik (`writeLimiter`)
- **Body**:
  ```json
  { "title": "Hasil AI Saya", "owner": "Budi" }
  ```
- **Syarat**: job berstatus `done`. Satu job hanya boleh dibagikan **sekali** (`409 DUPLICATE`).
- **Hasil**: membuat `GalleryPhoto` dengan `ai: true` dan `status: pending` (perlu persetujuan admin agar tampil publik).
- **Kode galat**: `400 VALIDATION`, `404 NOT_FOUND`, `409 INVALID_STATE` (job belum `done`), `409 DUPLICATE`
- **Respons (201)**: data foto galeri (`id`, `url`, `title`, `owner`, `ai`, `status`, `createdAt`)


---

## 13. AI Insight (P10)

> Analisis admin berbasis **aturan** (bukan LLM) melalui antarmuka `InsightGenerator`, sehingga bisa diganti layanan LLM sungguhan nanti tanpa mengubah endpoint.

### GET /admin/insight
- **Akses**: Admin
- **Isi**: rating rata-rata (1 desimal), jumlah ulasan, distribusi bintang 1-5, keramaian saat ini, jam terpadat (`HOURLY_FORECAST`), dan saran (maks. 5 kalimat) dari aturan:
  - keramaian > 75% → saran tambah petugas + anjurkan datang di jam sepi;
  - rating < 4,0 → saran memeriksa ulasan terbaru;
  - ada ulasan bintang 1-2 dalam 7 hari terakhir → peringatan;
  - tanpa pemicu → satu kalimat netral.
- **Respons**:
  ```json
  {
    "rating": 4.7,
    "reviewCount": 12,
    "distribution": { "1": 0, "2": 0, "3": 1, "4": 3, "5": 8 },
    "crowd": { "inside": 120, "percent": 40, "label": "Sedang" },
    "peakHour": "12",
    "suggestions": ["..."]
  }
  ```
- **Kode galat**: `401 UNAUTHENTICATED`, `403 FORBIDDEN` (petugas tidak berhak)


---

## 14. Manajemen Petugas & Admin (P11)

> Kolom `active` ditambahkan pada `AdminUser`. Pengguna nonaktif diperlakukan sama seperti kredensial salah saat login, dan semua sesinya langsung ditolak oleh `requireAuth`.

### GET /admin/staff
- **Akses**: Admin
- **Respons**: `[{ id, name, email, role, active, createdAt }]` — tanpa `passwordHash`

### POST /admin/staff
- **Akses**: Admin
- **Body**: `{ "name" (1..60), "email", "role": "petugas" | "admin", "password" (8..72) }`
- **Kode galat**: `400 VALIDATION`, `409 DUPLICATE` (email sudah dipakai)

### PATCH /admin/staff/:id
- **Akses**: Admin
- **Body**: `{ "name"? , "role"?, "active"? }` (boleh sebagian)
- **Proteksi** (`409 INVALID_STATE`):
  - tidak bisa menonaktifkan atau menurunkan peran **diri sendiri**;
  - tidak bisa menonaktifkan atau menurunkan **admin aktif terakhir**.
- **Hasil**: menonaktifkan akun **mencabut semua sesi** pengguna itu.

### POST /admin/staff/:id/reset-password
- **Akses**: Admin
- **Body**: `{ "password" (8..72) }`
- **Hasil**: password berganti dan **semua sesi** pengguna itu dicabut.

**Kode galat umum**: `401 UNAUTHENTICATED`, `403 FORBIDDEN` (petugas tidak berhak mengelola staff), `404 NOT_FOUND`.


---

## 15. Kumpulan Contoh Permintaan (curl & PowerShell)

> `BASE` = `http://localhost:4000`. Contoh PowerShell memakai `Invoke-RestMethod`; cookie sesi disimpan di variabel `$session`.

### Curl (Git Bash / Linux / macOS)

```bash
BASE=http://localhost:4000

# Kesehatan server
curl "$BASE/health/db"

# Login (simpan cookie sesi)
curl -c cookies.txt -H "Content-Type: application/json" \
  -d '{"email":"admin@sumbersira.id","password":"sumbersira"}' \
  "$BASE/auth/login"

# Data akun sendiri
curl -b cookies.txt "$BASE/auth/me"

# Katalog publik
curl "$BASE/rides"
curl "$BASE/pricing"
curl "$BASE/crowd"

# Beli tiket (simulasi QRIS, lalu bayar)
curl -H "Content-Type: application/json" \
  -d '{"name":"Budi","whatsapp":"081234567890","adults":2,"kids":1,"parking":"motor","arrival":"08.00 - 10.00","paymentMethod":"qris"}' \
  "$BASE/tickets"

# Booking sewa wahana
curl -H "Content-Type: application/json" \
  -d '{"name":"Budi","whatsapp":"081234567890","slot":"09-10","items":[{"rideId":"atv","qty":2}]}' \
  "$BASE/bookings"

# Ubah harga (admin)
curl -b cookies.txt -X PUT -H "Content-Type: application/json" \
  -d '{"ticketPricePerPerson":6000,"capacity":350,"parking":{"none":0,"motor":3000,"mobil":10000,"bus":20000}}' \
  "$BASE/admin/pricing"

# Daftar tiket hari ini (admin/petugas)
curl -b cookies.txt "$BASE/admin/tickets"

# Check-in tiket
curl -b cookies.txt -X POST "$BASE/admin/tickets/TK-1001/check-in"

# Unggah foto galeri
curl -b cookies.txt -F "photo=@foto.jpg" -F "title=Kolam anak" -F "owner=Budi" "$BASE/gallery"

# Persetujuan foto (admin)
curl -b cookies.txt -X PATCH -H "Content-Type: application/json" \
  -d '{"status":"approved"}' "$BASE/admin/gallery/<id>"

# AI Photo
curl -F "photo=@potret.jpg" "$BASE/ai-photo"

# Buat akun petugas (admin)
curl -b cookies.txt -H "Content-Type: application/json" \
  -d '{"name":"Petugas Satu","email":"petugas1@sumbersira.id","role":"petugas","password":"rahasia123"}' \
  "$BASE/admin/staff"
```

### PowerShell (Windows)

```powershell
$BASE = "http://localhost:4000"
$session = $null

# Login (cookie sesi disimpan di $session)
$login = Invoke-RestMethod -Uri "$BASE/auth/login" -Method Post -SessionVariable session `
  -ContentType "application/json" -Body '{"email":"admin@sumbersira.id","password":"sumbersira"}'

# Data akun sendiri
Invoke-RestMethod -Uri "$BASE/auth/me" -WebSession $session

# Ubah harga (admin)
Invoke-RestMethod -Uri "$BASE/admin/pricing" -Method Put -WebSession $session `
  -ContentType "application/json" `
  -Body '{"ticketPricePerPerson":6000,"capacity":350,"parking":{"none":0,"motor":3000,"mobil":10000,"bus":20000}}'

# Daftar tiket hari ini
Invoke-RestMethod -Uri "$BASE/admin/tickets" -WebSession $session

# Check-in tiket
Invoke-RestMethod -Uri "$BASE/admin/tickets/TK-1001/check-in" -Method Post -WebSession $session

# Unggah foto galeri
$form = @{ photo = Get-Item "foto.jpg"; title = "Kolam anak"; owner = "Budi" }
Invoke-RestMethod -Uri "$BASE/gallery" -Method Post -Form $form

# Persetujuan foto (admin)
Invoke-RestMethod -Uri "$BASE/admin/gallery/<id>" -Method Patch -WebSession $session `
  -ContentType "application/json" -Body '{"status":"approved"}'

# Buat akun petugas (admin)
Invoke-RestMethod -Uri "$BASE/admin/staff" -Method Post -WebSession $session `
  -ContentType "application/json" `
  -Body '{"name":"Petugas Satu","email":"petugas1@sumbersira.id","role":"petugas","password":"rahasia123"}'
```

### Webhook Midtrans (dipanggil oleh Midtrans, bukan manusia)

```bash
curl -X POST -H "Content-Type: application/json" \
  -d '{"order_id":"TK-1001-ABC123","status_code":"200","gross_amount":"13000","signature_key":"...","transaction_status":"settlement"}' \
  "$BASE/payments/midtrans/notification"
```
