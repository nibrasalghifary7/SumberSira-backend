import { startTestServer, request, check } from "./_helpers.js";
import { db } from "../../src/lib/db.js";
import { getStorageDriver } from "../../src/lib/storage/index.js";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

// Berkas teks diberi nama .png
const FAKE_PNG = Buffer.from("[SMOKE] ini bukan gambar");

const keyFromUrl = (url: string) => url.split("/uploads/")[1] ?? "";

function multipart(photo: Buffer, filename = "photo.png") {
  const form = new FormData();
  form.append("photo", new Blob([new Uint8Array(photo)], { type: "image/png" }), filename);
  return form;
}

async function run() {
  console.log("=== Menjalankan Smoke Test P9 ===");
  const { baseUrl, close } = await startTestServer();

  // PNG asli dibuat dengan sharp (64x64 berwarna) agar proses enhance realistis
  const goodPng = await sharp({
    create: { width: 64, height: 64, channels: 3, background: { r: 100, g: 150, b: 200 } },
  })
    .png()
    .toBuffer();

  // Magic bytes PNG valid tetapi isi rusak: lolos validasi magic bytes, gagal saat diproses
  const brokenPng = Buffer.concat([goodPng.subarray(0, 8), Buffer.from("SMOKE-RUSAK-SMSEK-SEKAPUS")]);

  const uploadedKeys: string[] = [];
  const jobIds: string[] = [];

  try {
    // 1. Unggah PNG asli: job done, resultUrl berbeda dari originalUrl
    const rCreate = await request(baseUrl, "/ai-photo", {
      method: "POST",
      body: multipart(goodPng),
    });
    check("POST /ai-photo status 201", rCreate.status === 201, `dapat ${rCreate.status}`);
    check("Status job done", rCreate.body?.status === "done");
    check("originalUrl terisi", typeof rCreate.body?.originalUrl === "string" && rCreate.body.originalUrl.length > 0);
    check("resultUrl terisi", typeof rCreate.body?.resultUrl === "string" && rCreate.body.resultUrl.length > 0);
    check("resultUrl berbeda dari originalUrl", rCreate.body?.resultUrl !== rCreate.body?.originalUrl);

    const jobId = rCreate.body.id as string;
    jobIds.push(jobId);
    const originalKey = keyFromUrl(rCreate.body.originalUrl);
    const resultKey = keyFromUrl(rCreate.body.resultUrl);
    uploadedKeys.push(originalKey, resultKey);

    // 2. File hasil benar-benar ada dan bisa dibaca sebagai gambar JPEG
    const resultPath = path.resolve(process.cwd(), "uploads", resultKey);
    const resultBytes = await fs.readFile(resultPath);
    check("File hasil ada di uploads/", resultBytes.length > 0);
    check("File hasil JPEG (FF D8 FF)", resultBytes[0] === 0xff && resultBytes[1] === 0xd8 && resultBytes[2] === 0xff);

    const rStatic = await fetch(`${baseUrl}/uploads/${resultKey}`);
    check("File hasil dapat diakses via /uploads/", rStatic.status === 200);
    await rStatic.arrayBuffer();

    // 3. GET /ai-photo/:id
    const rGet = await request(baseUrl, `/ai-photo/${jobId}`);
    check("GET /ai-photo/:id 200", rGet.status === 200);
    check("GET job status done", rGet.body?.status === "done");
    check("GET job resultUrl sama", rGet.body?.resultUrl === rCreate.body.resultUrl);

    // 4. PNG rusak (magic valid, isi rusak): 422 dan job failed
    const rBroken = await request(baseUrl, "/ai-photo", {
      method: "POST",
      body: multipart(brokenPng, "broken.png"),
    });
    check("PNG rusak ditolak 422", rBroken.status === 422, `dapat ${rBroken.status}`);
    check("Kode galat PROCESSING_FAILED", rBroken.body?.error === "PROCESSING_FAILED");
    const brokenJobId = rBroken.body?.id as string;
    jobIds.push(brokenJobId);
    const rBrokenGet = await request(baseUrl, `/ai-photo/${brokenJobId}`);
    check("Job rusak berstatus failed", rBrokenGet.body?.status === "failed");
    check("Job rusak mencatat error ringkas", typeof rBrokenGet.body?.error === "string" && rBrokenGet.body.error.length > 0);
    const brokenOriginalKey = keyFromUrl(rBrokenGet.body?.originalUrl ?? "");
    if (brokenOriginalKey) uploadedKeys.push(brokenOriginalKey);

    // 5. Berkas teks diberi nama .png: 415
    const rFake = await request(baseUrl, "/ai-photo", {
      method: "POST",
      body: multipart(FAKE_PNG, "fake.png"),
    });
    check("Teks ber nama .png ditolak 415", rFake.status === 415, `dapat ${rFake.status}`);

    // 6. Bagikan ke galeri: sekali sukses, kedua kali 409 DUPLICATE
    const rShare = await request(baseUrl, `/ai-photo/${jobId}/share-to-gallery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "[SMOKE] Hasil AI", owner: "[SMOKE] Penguji" }),
    });
    check("Share-to-gallery pertama 201", rShare.status === 201, `dapat ${rShare.status}`);
    check("Foto galeri ber-ai true", rShare.body?.ai === true);
    check("Foto galeri pending", rShare.body?.status === "pending");
    check("URL galeri = resultUrl job", rShare.body?.url === rCreate.body.resultUrl);

    const rShareAgain = await request(baseUrl, `/ai-photo/${jobId}/share-to-gallery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "[SMOKE] Hasil AI", owner: "[SMOKE] Penguji" }),
    });
    check("Share-to-gallery kedua ditolak 409", rShareAgain.status === 409, `dapat ${rShareAgain.status}`);
    check("Kode galat DUPLICATE", rShareAgain.body?.error === "DUPLICATE");

    // 7. Bagikan job yang belum selesai (rusak): 409 INVALID_STATE
    const rShareBroken = await request(baseUrl, `/ai-photo/${brokenJobId}/share-to-gallery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "[SMOKE] Hasil AI", owner: "[SMOKE] Penguji" }),
    });
    check("Share job gagal ditolak 409", rShareBroken.status === 409, `dapat ${rShareBroken.status}`);

    // 8. Validasi body share: title kosong ditolak 400
    const rShareBad = await request(baseUrl, `/ai-photo/${jobId}/share-to-gallery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "", owner: "[SMOKE] Penguji" }),
    });
    check("Share tanpa title ditolak 400", rShareBad.status === 400, `dapat ${rShareBad.status}`);

    // 9. Job tak dikenal: 404
    const rNotFound = await request(baseUrl, "/ai-photo/tidak-ada-xyz");
    check("Job tak dikenal 404", rNotFound.status === 404);

    console.log("=== Seluruh Pemeriksaan P9 LULUS ===");
  } finally {
    // Pembersihan: hapus baris galeri [SMOKE], baris job uji, dan berkas yang tersisa
    await db.galleryPhoto.deleteMany({
      where: { title: { startsWith: "[SMOKE]" } },
    });
    for (const id of jobIds) {
      await db.aiPhotoJob.deleteMany({ where: { id } });
    }
    const driver = getStorageDriver();
    for (const key of uploadedKeys) {
      if (key) await driver.remove(key).catch(() => {});
    }
    await close();
  }
}

run().catch((err) => {
  console.error("Smoke test P9 gagal:", err);
  process.exit(1);
});
