import { Router } from "express";
import { z } from "zod";
import crypto from "node:crypto";
import { db } from "../config/database.js";
import { getStorageDriver } from "../services/storage/index.js";
import { handleUpload, validateImageBuffer } from "../services/storage/upload.js";
import { autoEnhancer } from "../services/enhancer.js";
import { aiPhotoLimiter, writeLimiter, publicLimiter } from "../utils/limiters.js";
import { shareSchema, strengthSchema } from "../models/ai-photo.model.js";

export const aiPhotoRouter = Router();

// Kekuatan perbaikan 0..100 dari kolom form; kosong atau tidak valid berarti bawaan (60).
function bacaKekuatan(v: unknown): number | undefined {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : undefined;
}



// POST /ai-photo (Publik, proses sinkron: simpan asli, enhance, simpan hasil)
aiPhotoRouter.post("/", aiPhotoLimiter, handleUpload, async (req, res) => {
  if (!req.file || !req.file.buffer) {
    return res.status(400).json({
      error: "VALIDATION",
      issues: [{ path: ["photo"], message: "File foto wajib diunggah" }],
    });
  }

  // Validasi magic bytes (sama dengan P8)
  const validation = validateImageBuffer(req.file.buffer);
  if (!validation.valid || !validation.ext || !validation.contentType) {
    return res.status(415).json({ error: "UNSUPPORTED_MEDIA" });
  }

  const driver = getStorageDriver();
  const uid = crypto.randomUUID();
  const originalKey = `ai/${uid}-original.${validation.ext}`;
  const resultKey = `ai/${uid}-result.jpg`;

  const job = await db.aiPhotoJob.create({
    data: { originalUrl: "", originalKey, status: "processing" },
  });

  try {
    const uploadedOriginal = await driver.put(originalKey, req.file.buffer, validation.contentType);

    // Catat asli segera agar job gagal tetap punya data asli
    await db.aiPhotoJob.update({
      where: { id: job.id },
      data: { originalUrl: uploadedOriginal.url },
    });

    // Perbaikan foto: AI menilai kondisi foto, mesin pengolahan gambar menerapkannya (tidak mengubah bentuk, wajah, atau latar)
    const strength = bacaKekuatan(req.body?.strength);
    const enhanced = await autoEnhancer.enhance(req.file.buffer, { strength });

    const uploadedResult = await driver.put(resultKey, enhanced.jpeg, "image/jpeg");

    await db.aiPhotoJob.update({
      where: { id: job.id },
      data: {
        resultUrl: uploadedResult.url,
        resultKey,
        status: "done",
      },
    });

    res.status(201).json({
      id: job.id,
      status: "done",
      originalUrl: uploadedOriginal.url,
      resultUrl: uploadedResult.url,
      strength: strength ?? 60,
      engine: enhanced.olehAi ? "ai" : "otomatis",
    });
  } catch (err) {
    console.error("Gagal memproses AI Photo:", err);
    const message = err instanceof Error ? err.message : "Gagal memproses gambar";
    await db.aiPhotoJob
      .update({
        where: { id: job.id },
        data: { status: "failed", error: message.slice(0, 200) },
      })
      .catch(() => {});
    res.status(422).json({ error: "PROCESSING_FAILED", id: job.id });
  }
});

// POST /ai-photo/:id/strength (Publik): atur ulang kekuatan perbaikan dari foto asli yang sudah tersimpan (slider di aplikasi)
aiPhotoRouter.post("/:id/strength", aiPhotoLimiter, async (req, res) => {
  const parsed = strengthSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "VALIDATION", issues: parsed.error.issues });
  }

  const job = await db.aiPhotoJob.findUnique({ where: { id: req.params.id as string } });
  if (!job) return res.status(404).json({ error: "NOT_FOUND" });
  if (job.status !== "done" || !job.originalUrl) return res.status(409).json({ error: "INVALID_STATE" });

  try {
    // Foto asli diambil lagi dari penyimpanan (URL dibuat server sendiri saat unggah)
    const asli = await fetch(job.originalUrl, { signal: AbortSignal.timeout(20_000) });
    if (!asli.ok) throw new Error(`Foto asli tidak terbaca (${asli.status})`);
    const buffer = Buffer.from(await asli.arrayBuffer());

    const enhanced = await autoEnhancer.enhance(buffer, { strength: parsed.data.strength });
    const driver = getStorageDriver();
    const resultKey = `ai/${crypto.randomUUID()}-result.jpg`;
    const uploaded = await driver.put(resultKey, enhanced.jpeg, "image/jpeg");
    await db.aiPhotoJob.update({ where: { id: job.id }, data: { resultUrl: uploaded.url, resultKey } });

    res.json({
      id: job.id,
      status: "done",
      originalUrl: job.originalUrl,
      resultUrl: uploaded.url,
      strength: parsed.data.strength,
      engine: enhanced.olehAi ? "ai" : "otomatis",
    });
  } catch (err) {
    console.error("Gagal mengatur ulang kekuatan AI Photo:", err);
    res.status(422).json({ error: "PROCESSING_FAILED", id: job.id });
  }
});

// GET /ai-photo/:id (Publik)
aiPhotoRouter.get("/:id", publicLimiter, async (req, res) => {
  const job = await db.aiPhotoJob.findUnique({
    where: { id: req.params.id as string },
  });

  if (!job) {
    return res.status(404).json({ error: "NOT_FOUND" });
  }

  res.json({
    id: job.id,
    status: job.status,
    originalUrl: job.originalUrl,
    resultUrl: job.resultUrl,
    error: job.error,
    createdAt: job.createdAt.toISOString(),
  });
});

// POST /ai-photo/:id/share-to-gallery (Publik; bagikan hasil AI ke galeri)
aiPhotoRouter.post("/:id/share-to-gallery", writeLimiter, async (req, res) => {
  const parsed = shareSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "VALIDATION", issues: parsed.error.issues });
  }

  const job = await db.aiPhotoJob.findUnique({
    where: { id: req.params.id as string },
  });

  if (!job) {
    return res.status(404).json({ error: "NOT_FOUND" });
  }

  // Hanya job yang selesai dan punya hasil boleh dibagikan
  if (job.status !== "done" || !job.resultUrl || !job.resultKey) {
    return res.status(409).json({ error: "INVALID_STATE" });
  }

  // Satu job hanya boleh dibagikan sekali (storageKey hasil unik per job)
  const existing = await db.galleryPhoto.findFirst({
    where: { storageKey: job.resultKey },
  });
  if (existing) {
    return res.status(409).json({ error: "DUPLICATE" });
  }

  const photo = await db.galleryPhoto.create({
    data: {
      url: job.resultUrl,
      storageKey: job.resultKey,
      title: parsed.data.title,
      owner: parsed.data.owner,
      ai: true,
      status: "pending",
    },
  });

  res.status(201).json({
    id: photo.id,
    url: photo.url,
    title: photo.title,
    owner: photo.owner,
    ai: photo.ai,
    status: photo.status,
    createdAt: photo.createdAt.toISOString(),
  });
});
