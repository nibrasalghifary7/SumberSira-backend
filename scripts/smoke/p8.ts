import { startTestServer, request, loginAs, check } from "./_helpers.js";
import { db } from "../../src/lib/db.js";
import { getStorageDriver } from "../../src/lib/storage/index.js";
import fs from "node:fs/promises";
import path from "node:path";

// PNG 1x1 transparan, byte literal (magic bytes 89 50 4E 47)
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

// Berkas teks palsu diberi nama .png (mimetype diklaim PNG, isi teks)
const FAKE_PNG = Buffer.from("[SMOKE] ini bukan gambar, hanya teks biasa");

// PNG > 4 MB (multer menolak sebelum sampai handler)
const HUGE_PNG = Buffer.concat([PNG_BYTES, new Uint8Array(4 * 1024 * 1024 + 100)]);

function multipart(photo: Buffer | null, title: string, owner: string, filename = "photo.png") {
  const form = new FormData();
  if (photo) {
    form.append("photo", new Blob([new Uint8Array(photo)], { type: "image/png" }), filename);
  }
  form.append("title", title);
  form.append("owner", owner);
  return form;
}

async function run() {
  console.log("=== Menjalankan Smoke Test P8 ===");
  const { baseUrl, close } = await startTestServer();

  const uploadedKeys: string[] = [];

  try {
    const { cookie: adminCookie } = await loginAs(baseUrl, "admin");
    const { cookie: petugasCookie } = await loginAs(baseUrl, "petugas");

    // 1. Unggah PNG asli: 201 dan status pending
    const rUpload = await request(baseUrl, "/gallery", {
      method: "POST",
      body: multipart(PNG_BYTES, "[SMOKE] Foto Uji Galeri", "[SMOKE] Penguji"),
    });
    check("POST /gallery status 201", rUpload.status === 201, `dapat ${rUpload.status}`);
    check("Foto berstatus pending", rUpload.body?.status === "pending");
    check("Foto ber-ai false", rUpload.body?.ai === false);
    check("URL terisi", typeof rUpload.body?.url === "string" && rUpload.body.url.length > 0);
    const photoId = rUpload.body?.id as string;

    // Kunci penyimpanan dari daftar admin
    const rAdminList = await request(baseUrl, "/admin/gallery", {
      headers: { Cookie: adminCookie },
    });
    check("Admin GET /admin/gallery 200", rAdminList.status === 200);
    const created = rAdminList.body?.find((p: any) => p.id === photoId);
    check("Foto uji ada di daftar admin", created !== undefined);
    check("storageKey diawali gallery/", typeof created?.storageKey === "string" && created.storageKey.startsWith("gallery/"));
    uploadedKeys.push(created.storageKey);

    // Berkas benar-benar tertulis dan bisa dibaca lewat /uploads/<key>
    const localPath = path.resolve(process.cwd(), "uploads", created.storageKey);
    const onDisk = await fs.readFile(localPath);
    check("Berkas tersimpan di uploads/ dengan isi sama", Buffer.compare(onDisk, PNG_BYTES) === 0);
    const rStatic = await fetch(`${baseUrl}/uploads/${created.storageKey}`);
    check("GET /uploads/<key> 200", rStatic.status === 200);
    await rStatic.arrayBuffer(); // kosongkan body

    // 2. Belum muncul di GET /gallery (hanya approved)
    const rPublicBefore = await request(baseUrl, "/gallery");
    check("GET /gallery 200", rPublicBefore.status === 200);
    check("Foto pending tidak muncul di galeri publik",
      !rPublicBefore.body?.some((p: any) => p.id === photoId));

    // 3. Petugas tidak boleh menyetujui: 403
    const rPetugasPatch = await request(baseUrl, `/admin/gallery/${photoId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: petugasCookie },
      body: JSON.stringify({ status: "approved" }),
    });
    check("Petugas PATCH /admin/gallery ditolak 403", rPetugasPatch.status === 403);

    // 4. Admin menyetujui: muncul di galeri publik
    const rApprove = await request(baseUrl, `/admin/gallery/${photoId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ status: "approved" }),
    });
    check("Admin PATCH approved 200", rApprove.status === 200 && rApprove.body?.status === "approved");
    check("reviewedAt terisi", typeof rApprove.body?.reviewedAt === "string" && rApprove.body.reviewedAt.length > 0);

    const rPublicAfter = await request(baseUrl, "/gallery");
    check("Foto approved muncul di galeri publik",
      rPublicAfter.body?.some((p: any) => p.id === photoId));

    // 5. Berkas teks diberi nama .png: 415
    const rFake = await request(baseUrl, "/gallery", {
      method: "POST",
      body: multipart(FAKE_PNG, "[SMOKE] Palsu", "[SMOKE] Penguji", "fake.png"),
    });
    check("Teks ber nama .png ditolak 415", rFake.status === 415, `dapat ${rFake.status}`);

    // 6. Berkas lebih dari 4 MB: 413
    const rHuge = await request(baseUrl, "/gallery", {
      method: "POST",
      body: multipart(HUGE_PNG, "[SMOKE] Raksasa", "[SMOKE] Penguji", "huge.png"),
    });
    check("Berkas > 4 MB ditolak 413", rHuge.status === 413, `dapat ${rHuge.status}`);

    // 7. Tanpa file: 400
    const rNoFile = await request(baseUrl, "/gallery", {
      method: "POST",
      body: multipart(null, "[SMOKE] Tanpa Foto", "[SMOKE] Penguji"),
    });
    check("Tanpa file foto ditolak 400", rNoFile.status === 400, `dapat ${rNoFile.status}`);

    // 8. Tanpa title: 400
    const formNoTitle = new FormData();
    formNoTitle.append("photo", new Blob([new Uint8Array(PNG_BYTES)], { type: "image/png" }), "photo.png");
    formNoTitle.append("owner", "[SMOKE] Penguji");
    const rNoTitle = await request(baseUrl, "/gallery", {
      method: "POST",
      body: formNoTitle,
    });
    check("Tanpa title ditolak 400", rNoTitle.status === 400, `dapat ${rNoTitle.status}`);

    // 9. Saring status pada /admin/gallery
    const rPendingOnly = await request(baseUrl, "/admin/gallery?status=pending", {
      headers: { Cookie: adminCookie },
    });
    check("Saring status=pending tidak memuat foto approved",
      !rPendingOnly.body?.some((p: any) => p.id === photoId));

    // 10. DELETE menghapus baris dan berkas
    const rDelete = await request(baseUrl, `/admin/gallery/${photoId}`, {
      method: "DELETE",
      headers: { Cookie: adminCookie },
    });
    check("Admin DELETE 200", rDelete.status === 200, `dapat ${rDelete.status}`);

    let fileGone = false;
    try {
      await fs.access(localPath);
    } catch {
      fileGone = true;
    }
    check("Berkas terhapus dari uploads/", fileGone);

    const rAfterDelete = await request(baseUrl, "/admin/gallery", {
      headers: { Cookie: adminCookie },
    });
    check("Baris foto terhapus dari daftar admin",
      !rAfterDelete.body?.some((p: any) => p.id === photoId));

    console.log("=== Seluruh Pemeriksaan P8 LULUS ===");
  } finally {
    // Pembersihan: hapus baris [SMOKE] dan berkas yang tersisa (jika uji gagal di tengah)
    await db.galleryPhoto.deleteMany({
      where: { title: { startsWith: "[SMOKE]" } },
    });
    const driver = getStorageDriver();
    for (const key of uploadedKeys) {
      await driver.remove(key).catch(() => {});
    }
    await close();
  }
}

run().catch((err) => {
  console.error("Smoke test P8 gagal:", err);
  process.exit(1);
});
