# Panduan Mengaktifkan Pembayaran Midtrans (QRIS) di SumberSira

Dokumen ini untuk **manusia** (bukan agen). Isinya langkah konkret mengubah backend SumberSira
dari mode `simulation` ke pembayaran QRIS sungguhan lewat Midtrans, mulai dari daftar akun
sampai produksi.

Kode yang dipakai: **Midtrans Core API `/v2/charge` dengan `payment_type: "qris"`**
(lihat `src/payments/index.ts`). Artinya **tidak** memakai Snap/`client_key`, tidak ada halaman
redirect Midtrans, dan aplikasi Flutter tetap menampilkan QR sendiri dari `qrString` yang dikirim backend.

---

## 0. Ringkasan alur

```
Aplikasi Flutter            Backend SumberSira                 Midtrans
      |  POST /tickets             |                              |
      |--------------------------->|  POST /v2/charge (qris)      |
      |                            |----------------------------->|
      |                            |<----- qr_string, expiry -----|
      |<--- payment.qrString ------|                              |
      |  (tampilkan QR)            |                              |
      |                            |<---- webhook settlement -----|
      |  GET /payments/:id (poll)  |                              |
      |--------------------------->|  (verifikasi + apply status) |
      |<--- status: paid ----------|                              |
```

Dua jalur pengaman: **webhook** (Midtrans yang memanggil kita) dan **polling** (`GET /payments/:id`
memanggil `getStatus` ke Midtrans). Jadi kalau webhook telat/tidak sampai, status tetap benar
saat aplikasi melakukan polling.

---

## 1. Daftar akun Midtrans (sekali saja)

1. Buka <https://dashboard.midtrans.com> → **Sign Up**.
2. Isi email, password, lalu data bisnis (nama usaha: mis. "Sumber Sira", kategori: *Tourism / Recreation*).
3. Setelah masuk, pastikan **switch environment di kanan atas menunjukkan `Sandbox`**.
   Sandbox = uang palsu, aman untuk uji coba.
4. Lengkapi **Settings → Business Profile** bila diminta. Untuk sandbox biasanya boleh data sederhana.

> Kalau akun belum lolos verifikasi bisnis, **sandbox tetap bisa dipakai**. Verifikasi baru wajib
> saat naik ke produksi (lihat bagian 8).

---

## 2. Ambil Access Keys (sandbox)

1. Di dashboard sandbox: **Settings → Access Keys**.
2. Catat dua nilai:
   - **Server Key** — diawali `SB-Mid-server-...` (untuk sandbox).
   - **Client Key** — diawali `SB-Mid-client-...`.
3. **Server Key = rahasia.** Hanya boleh ada di `.env` backend. Jangan pernah ditaruh di
   aplikasi Flutter, repo, screenshot, atau chat.
4. Kunci **sandbox** dan **produksi** berbeda. Jangan tertukar (kunci produksi tidak diawali `SB-`).

Status di repo ini: `.env` **sudah** berisi `MIDTRANS_SERVER_KEY` sandbox. Pastikan nilainya
benar-benar dari **Settings → Access Keys (Sandbox)**, bukan kunci produksi.

---

## 3. Aktifkan channel QRIS

1. **Settings → Payment Channels** (nama menu bisa berbeda: *Payment Methods* / *Channels*).
2. Pastikan **QRIS** (dan/atau **GoPay**) berstatus aktif untuk sandbox.
   Di sandbox hampir semua channel langsung aktif.
3. Untuk **produksi**, QRIS harus diajukan aktivasi dan butuh persetujuan acquirer
   (GoPay/ShopeePay/DANA dll.). Siapkan dokumen usaha (NIB/KTP, rekening bank, foto lokasi).

---

## 4. Isi `.env`

Buka `D:\KULIAH\semester 3\SumberSira-backend\.env` dan sesuaikan:

```dotenv
# --- Pembayaran ---
PAYMENT_MODE="midtrans"          # sebelumnya tidak diisi = simulation
MIDTRANS_ENV="sandbox"           # sandbox dulu, jangan langsung production
MIDTRANS_SERVER_KEY="SB-Mid-server-xxxxxxxxxxxxxxxxxxxx"
MIDTRANS_CLIENT_KEY="SB-Mid-client-xxxxxxxxxxxxxxxxxxxx"   # opsional, tidak dipakai kode saat ini

# --- URL publik (penting!) ---
# Dipakai untuk URL foto galeri/AI Photo DAN header X-Override-Notification ke Midtrans.
PUBLIC_BASE_URL="https://xxxx-xx-xx-xx-xx.ngrok-free.app"
```

Catatan:

- `PAYMENT_MODE=midtrans` membutuhkan `MIDTRANS_SERVER_KEY`; kalau kosong server **menolak start**
  dengan pesan jelas (sudah dijaga di `src/config.ts`).
- Selama `PAYMENT_MODE=simulation`, tombol **"Saya Sudah Bayar"** muncul di aplikasi.
  Setelah `midtrans`, tombol itu hilang otomatis (endpoint `simulate-pay` membalas 404).
- `PUBLIC_BASE_URL` **wajib** diisi saat uji Midtrans di lokal, karena Midtrans tidak bisa
  memanggil `localhost`. Tanpa ini, webhook tidak akan sampai (polling masih menyelamatkan status,
  tapi webhook adalah jalur utama di produksi).

---

## 5. Buka akses publik untuk webhook (ngrok)

Webhook = Midtrans mengirim `POST` ke server kita saat pembayaran selesai. Di laptop,
pakai ngrok:

```powershell
# sekali saja
winget install ngrok.ngrok      # atau unduh dari https://ngrok.com/download

# tiap kali mau tes
ngrok config add-authtoken <TOKEN_DARI_DASHBOARD_NGROK>
ngrok http 4000
```

Salin URL `https://....ngrok-free.app` (versi **https**) ke:

1. `.env` → `PUBLIC_BASE_URL="https://....ngrok-free.app"` (tanpa garis miring di akhir),
2. Dashboard Midtrans → **Settings → Configuration** → **Payment Notification URL**:
   `https://....ngrok-free.app/payments/midtrans/notification`

Lalu **restart backend** (`npm run dev`) supaya `.env` terbaca. Perhatikan: setiap kali ngrok
dinyalakan ulang, URL gratis berubah → perbarui `.env` **dan** dashboard.

> Kode juga mengirim header `X-Override-Notification` per transaksi (berisi
> `PUBLIC_BASE_URL + /payments/midtrans/notification`), jadi transaksi baru akan memakai URL itu
> walau dashboard belum diperbarui.

---

## 6. Uji di sandbox (end-to-end)

1. Nyalakan backend: `npm run dev` (port 4000).
2. Jalankan aplikasi: `flutter run` (emulator) atau `flutter run -d edge`.
3. Beli tiket **QRIS** di aplikasi → akan muncul QR asli Midtrans.
4. Buka simulator QRIS: <https://simulator.sandbox.midtrans.com/>
   → pilih **QRIS** → tempel isi `qrString` (dari aplikasi, atau dari
   `GET http://localhost:4000/payments/<id>`) → pilih channel (mis. GoPay) → **Pay**.
5. Periksa hasilnya:
   - Log backend muncul `POST /payments/midtrans/notification` (webhook masuk).
   - Dashboard Midtrans → **Transactions** → status transaksi `settlement`.
   - `GET /payments/<id>` → `"status": "paid"`.
   - Aplikasi (polling tiap 3 detik) berubah jadi **Lunas** tanpa menekan tombol apa pun.

Cek cepat lewat PowerShell:

```powershell
# lihat status pembayaran
Invoke-RestMethod "http://localhost:4000/payments/<PAYMENT_ID>" | ConvertTo-Json

# simulasi webhook (hanya untuk uji; signature dihitung dari server key asli)
# gunakan simulator dashboard Midtrans untuk uji signature yang sah.
```

Kalau QR tidak muncul / muncul `PAYMENT_PROVIDER_ERROR`, lihat bagian 9.

---

## 7. Uji tanpa ngrok (opsional, khusus pengembangan)

Kalau hanya ingin memastikan QR keluar dan status berubah **tanpa** webhook:

- Biarkan `PUBLIC_BASE_URL` kosong dan **jangan** daftarkan notifikasi.
- Setelah membayar di simulator, tunggu aplikasi melakukan polling `GET /payments/:id`.
  Backend akan memanggil `getStatus(order_id)` ke Midtrans dan menandai lunas sendiri.
- Ini cukup untuk demo, tetapi **jangan** diandalkan di produksi: webhook tetap jalur utama.

---

## 8. Naik ke produksi

1. **Verifikasi bisnis (KYB)** di dashboard produksi: data usaha, NPWP/NIB, rekening bank atas
   nama usaha, situs/aplikasi, kebijakan privasi & refund.
2. Minta **aktivasi QRIS produksi** (Settings → Payment Channels). Butuh review acquirer, bisa
   beberapa hari kerja. Ada biaya MDR per transaksi (umumnya ~0,7% untuk QRIS; tarif final sesuai
   kontrak dengan Midtrans/acquirer).
3. Setelah disetujui, ambil **Access Keys produksi** (tanpa awalan `SB-`).
4. Ubah `.env` server produksi:

   ```dotenv
   NODE_ENV="production"
   PAYMENT_MODE="midtrans"
   MIDTRANS_ENV="production"
   MIDTRANS_SERVER_KEY="<server key produksi>"
   PUBLIC_BASE_URL="https://api.domainmu.com"    # HTTPS permanen, wajib
   ```

5. Daftarkan **Payment Notification URL** produksi:
   `https://api.domainmu.com/payments/midtrans/notification`
6. Uji nominal kecil dengan uang sungguhan (mis. Rp1.000), lalu refund manual dari dashboard
   bila perlu.
7. Pastikan `simulate-pay` mati di produksi (otomatis: `NODE_ENV=production` → 404).

**Jangan** memakai kunci sandbox di produksi dan sebaliknya.

---

## 9. Troubleshooting

| Gejala | Penyebab umum | Perbaikan |
| --- | --- | --- |
| `PAYMENT_PROVIDER_ERROR` saat beli tiket | `MIDTRANS_SERVER_KEY` salah/tertukar produksi-sandbox, atau channel QRIS belum aktif | Cek ulang Access Keys sesuai environment, cek menu Payment Channels |
| Server gagal start: "MIDTRANS_SERVER_KEY wajib diisi..." | `PAYMENT_MODE=midtrans` tapi key kosong | Isi key sandbox |
| QR muncul tapi tidak pernah lunas | Webhook tidak sampai (localhost/URL salah) dan polling tidak jalan | Isi `PUBLIC_BASE_URL`, daftarkan notifikasi, atau tunggu polling `GET /payments/:id` |
| Webhook masuk tapi `403 FORBIDDEN` | Signature tidak cocok → server key di `.env` bukan yang dipakai Midtrans | Samakan key dengan environment transaksi |
| Webhook `200 {ignored:true}` | `order_id` tidak ada di DB, atau `gross_amount` ≠ `payment.amount` | Pastikan transaksi dibuat lewat backend ini, jangan ubah nominal manual |
| QR kedaluwarsa (15 menit) | Batas waktu Midtrans | Buat pesanan/tiket baru |
| Foto galeri tidak tampil di HP | `PUBLIC_BASE_URL` kosong → URL `localhost` | Isi `PUBLIC_BASE_URL` (lihat Task 2 di `planning/lanjutan-config-midtrans.md`) |
| Error 500 "is not valid JSON" pada aksi tanpa body | body-parser menolak `"null"` (bug lama) | Sudah diperbaiki di klien; sisi server ditangani Task 3 |

---

## 10. Yang tidak perlu dilakukan

- **Tidak perlu** memasang SDK Midtrans di Flutter. Aplikasi hanya menampilkan `qrString`.
- **Tidak perlu** `MIDTRANS_CLIENT_KEY` untuk alur QRIS Core API ini (hanya relevan kalau nanti
  memakai Snap/redirect).
- **Tidak perlu** mengubah bentuk JSON API. Kontrak `payment` tetap sama:
  `id, method, provider, status, amount, qrString, qrUrl, expiresAt, paidAt, ...`.

---

## 11. Checklist singkat

- [ ] Akun Midtrans dibuat, environment **Sandbox** aktif
- [ ] Server Key sandbox diambil dari Settings → Access Keys
- [ ] QRIS aktif di Payment Channels
- [ ] `.env`: `PAYMENT_MODE=midtrans`, `MIDTRANS_ENV=sandbox`, `PUBLIC_BASE_URL=https://...`
- [ ] Backend di-restart
- [ ] Notifikasi URL didaftarkan (dashboard dan/atau `PUBLIC_BASE_URL`)
- [ ] Tiket QRIS dibayar lewat simulator → status `paid`
- [ ] Webhook terlihat di log backend
- [ ] Siap produksi: KYB, kunci produksi, HTTPS permanen, uji nominal kecil
