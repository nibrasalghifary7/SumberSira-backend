# Deployment, CI/CD, dan Operasi Produksi

Dokumen ini menjelaskan cara backend SumberSira dibangun, dirilis, dan dioperasikan
di server produksi. Ringkasan alur:

```
Pull Request ──► GitHub Actions (lint → test → build) ──► merge ke main
                                                             │
                                                             ▼
                                        build image Docker ──► GHCR
                                                             │
                                                             ▼
                            server: migrasi database ──► container baru ──► /health
                                                             │
                                              lolos? ──► trafik dialihkan
                                              gagal? ──► versi lama tetap jalan
```

## 1. Docker: build vs runtime

`Dockerfile` memakai **multi-stage build**:

| Tahap | Isi | Tujuan |
|---|---|---|
| `deps` | dependency lengkap (termasuk dev) | bahan untuk build |
| `build` | Prisma Client hasil `prisma generate` + `npm run build` (typecheck) | memastikan kode valid |
| `runtime` | hanya dependency produksi + `src/`, `generated/`, `prisma/` | image kecil, tanpa alat build |

Prinsip penting:

- **Image yang sama dipakai di semua environment.** Tidak ada URL atau rahasia
  yang “ditanam” saat build. Semua konfigurasi (`DATABASE_URL`,
  `MIDTRANS_SERVER_KEY`, `BLOB_READ_WRITE_TOKEN`, dst.) dibaca **saat runtime**
  dari environment container.
- Nilai `DATABASE_URL` dummy di tahap build hanya dipakai `prisma generate`,
  bukan untuk koneksi.
- `.env` **tidak pernah** ikut ke dalam image (lihat `.dockerignore`). Di server,
  isi variabel lewat `--env-file` atau secret manager platform.
- Proyek ini menjalankan TypeScript langsung dengan `tsx`, jadi `npm run build`
  adalah **pemeriksaan tipe** (`tsc --noEmit`), bukan kompilasi ke `dist/`.
  Hasil yang diuji di CI sama dengan yang dijalankan di container.

Membangun dan menjalankan secara lokal:

```bash
docker build -t sumbersira-backend:local .

docker run --rm -p 4000:4000 \
  --env-file .env.production \
  sumbersira-backend:local
```

Cek kesehatan:

```bash
curl http://localhost:4000/health/live   # server hidup
curl http://localhost:4000/health        # server + database siap
```

## 2. Arsitektur produksi dan `trust proxy`

```
Internet ──► Nginx (TLS/SSL, reverse proxy) ──► container API (port 4000)
```

Karena ada proxy di depan, set:

```env
TRUST_PROXY=1
```

Tanpa ini, Express melihat IP Nginx untuk semua klien sehingga **rate limit**
dan log akan salah sasaran (semua pengunjung dianggap satu IP).

Contoh blok Nginx:

```nginx
server {
  listen 443 ssl http2;
  server_name api.sumbersira.id;

  # sertifikat TLS (contoh: Certbot)
  ssl_certificate     /etc/letsencrypt/live/api.sumbersira.id/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/api.sumbersira.id/privkey.pem;

  client_max_body_size 5m;   # unggah foto maksimal 4 MB + overhead

  location / {
    proxy_pass http://127.0.0.1:4000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 60s;
  }
}

server {
  listen 80;
  server_name api.sumbersira.id;
  return 301 https://$host$request_uri;
}
```

Tambahkan juga `X-Request-Id` bila ingin melacak satu request end-to-end:

```nginx
proxy_set_header X-Request-Id $request_id;
```

## 3. Health check dan rilis tanpa downtime (zero-downtime)

Dua endpoint dengan peran berbeda:

| Endpoint | Menyentuh database? | Dipakai untuk |
|---|---|---|
| `GET /health/live` | tidak | liveness probe Docker/orchestrator |
| `GET /health` | ya (`SELECT 1`, timeout 2 detik) | readiness sebelum trafik dialihkan |
| `GET /health/db` | ya (jumlah wahana) | pemeriksaan manual/debug |

`GET /health` membalas **503** bila database tidak dapat dipakai, sehingga
orchestrator tidak mengirim pengguna ke versi yang rusak.

Urutan rilis yang aman:

1. Jalankan **migrasi database** (lihat bagian 6) — versi lama harus tetap
   berjalan setelah migrasi (expand).
2. Nyalakan container versi **baru** di port/internal network lain.
3. Tunggu `GET /health` membalas `200` beberapa kali.
4. Alihkan trafik Nginx/load balancer ke container baru.
5. Hentikan container lama dengan **SIGTERM** (bukan `kill -9`).
6. Bila kesehatan versi baru gagal, jangan alihkan trafik dan hentikan container
   baru — versi lama masih melayani (rollback aman).

Contoh `docker-compose.yml` di server (image dari GHCR):

```yaml
services:
  api:
    image: ghcr.io/nibrasalghifary7/sumbersira-backend:latest
    restart: unless-stopped
    env_file: /srv/sumbersira/.env
    ports:
      - "4000:4000"
    healthcheck:
      test:
        [
          "CMD",
          "node",
          "-e",
          "fetch('http://127.0.0.1:4000/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))",
        ]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 20s
    stop_grace_period: 15s
```

Untuk dua versi berjalan bersamaan (blue-green), buat dua service
(`api-blue` dan `api-green`) di belakang Nginx `upstream`, lalu pindahkan
`upstream` setelah `health` versi baru lolos.

## 4. CI/CD (GitHub Actions)

Workflow: `.github/workflows/ci.yml`.

| Tahap | Perintah | Kapan |
|---|---|---|
| Lint | `npm run lint` (TypeScript strict) | setiap PR dan push ke `main` |
| Test | `npm test` | setiap PR dan push ke `main` |
| Build | `npm run build` | setiap PR dan push ke `main` |
| Image | build & push ke `ghcr.io/<repo>` | push ke `main` setelah semua lolos |
| Deploy | contoh SSH tersedia (dikomentari) | setelah image tersedia |

Tambahkan **branch protection** di GitHub: PR ke `main` wajib lolos job
`verify` sebelum bisa di-merge.

## 5. Graceful shutdown

`src/index.ts` menangani `SIGTERM` (dikirim Docker saat `docker stop` atau saat
mengganti versi) dan `SIGINT` (Ctrl+C):

1. berhenti menerima koneksi baru,
2. menyelesaikan request yang sedang berjalan,
3. menghentikan penyapu periodik,
4. menutup koneksi Prisma (`db.$disconnect()`),
5. keluar dengan kode 0.

Bila proses belum selesai dalam **10 detik**, proses keluar paksa (kode 1) agar
container tidak menggantung. Karena itu, set `stop_grace_period` Docker lebih
besar dari 10 detik (contoh di atas: 15 detik). SIGTERM **tidak** boleh diabaikan
dan `kill -9` hanya dipakai sebagai upaya terakhir.

## 6. Strategi migrasi database (expand–contract)

Saat rilis baru, versi lama dan baru bisa berjalan bersamaan beberapa saat.
Karena itu, satu rilis **tidak boleh** langsung menghapus atau mengganti nama
kolom. Gunakan pola **expand–contract**:

**Contoh: mengganti `name` menjadi `fullName` pada tabel `AdminUser`.**

Rilis 1 — *expand* (aman untuk versi lama):

```prisma
model AdminUser {
  name     String   // masih dipakai versi lama
  fullName String?  // kolom baru, boleh kosong
}
```

1. `npx prisma migrate dev --name add_full_name`
2. Deploy kode yang **menulis ke kedua kolom** dan membaca `fullName ?? name`.
3. Isi data lama: `UPDATE "AdminUser" SET "fullName" = name WHERE "fullName" IS NULL;`

Rilis 2 — *contract* (setelah semua instance memakai kolom baru):

```prisma
model AdminUser {
  fullName String   // wajib, kolom lama sudah tidak dipakai
  // name dihapus
}
```

Aturan praktis:

- **Tambah** kolom/tabel → aman kapan saja (nullable atau punya default).
- **Ubah** tipe/rename → dua langkah (tambah baru, salin, baru hapus lama).
- **Hapus** kolom → hanya setelah kode lama benar-benar tidak berjalan.
- Migrasi di produksi memakai `npx prisma migrate deploy` (tidak pernah
  `migrate dev`, yang bisa mereset data).
- Selalu uji migrasi pada salinan database sebelum rilis.

Perintah migrasi (dijalankan sebelum container baru menerima trafik):

```bash
# di runner CI atau checkout kode di server (butuh devDependency `prisma`)
npm ci
DATABASE_URL="postgresql://..." npx prisma migrate deploy
```

Alternatif berbasis image: bangun tahap `build` (`docker build --target build`)
lalu jalankan `npx prisma migrate deploy` di dalamnya. Image **runtime** sengaja
tidak membawa Prisma CLI (hanya dependency produksi), jadi jangan menjalankan
migrasi dari image runtime.

## 7. Logging dan penelusuran error

- Log ditulis sebagai JSON terstruktur (`pino`) ke stdout; platform/`docker logs`
  yang mengumpulkannya.
- Setiap request punya **request ID**: diambil dari header `X-Request-Id` (bila
  formatnya wajar) atau dibuat baru, lalu dikirim balik pada header respons dan
  disertakan pada body galat.
- Field sensitif disensor: `Authorization`, `Cookie`, `Set-Cookie`, serta
  `password`/`token` di body.
- Level log diatur lewat `LOG_LEVEL` (`info` bawaan, `debug` saat investigasi,
  `silent` saat test).

Mencari satu request di log:

```bash
docker logs sumbersira-api 2>&1 | grep '"requestId":"<id-dari-header>"'
```

## 8. Checklist rilis

- [ ] `npm run lint`, `npm test`, `npm run build` hijau di CI.
- [ ] `NODE_ENV=production` dan seluruh variabel wajib terisi di server.
- [ ] `TRUST_PROXY=1` bila di belakang Nginx/load balancer.
- [ ] `STORAGE_DRIVER=vercel-blob` + `BLOB_READ_WRITE_TOKEN` (disk server tidak persisten).
- [ ] `npx prisma migrate deploy` selesai tanpa error.
- [ ] `GET /health` membalas 200 dari container baru.
- [ ] Cookie sesi `Secure` (otomatis di produksi) dan HTTPS aktif.
- [ ] Webhook Midtrans (`<PUBLIC_BASE_URL>/payments/midtrans/notification`)
      terdaftar dan dapat diakses publik.
- [ ] Uji SIGTERM: `docker stop` tidak memutus request yang sedang berjalan.
