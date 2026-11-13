import { Router } from "express";
import { z } from "zod";
import crypto from "node:crypto";
import { db } from "../lib/db.js";
import { getStorageDriver } from "../lib/storage/index.js";
import { handleUpload, validateImageBuffer } from "../lib/storage/upload.js";
import { writeLimiter, publicLimiter } from "../lib/limiters.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import type { PhotoStatus } from "../../generated/prisma/enums.js";

export const galleryRouter = Router();
export const adminGalleryRouter = Router();

const createGallerySchema = z.object({
  title: z.string().trim().min(1).max(60),
  owner: z.string().trim().min(1).max(40),
});

const patchGallerySchema = z.object({
  status: z.enum(["approved", "rejected"]),
});

// POST /gallery (Publik, upload foto)
galleryRouter.post("/", writeLimiter, handleUpload, async (req, res) => {
  if (!req.file || !req.file.buffer) {
    return res.status(400).json({
      error: "VALIDATION",
      issues: [{ path: ["photo"], message: "File foto wajib diunggah" }],
    });
  }

  const parsed = createGallerySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "VALIDATION", issues: parsed.error.issues });
  }

  // Validasi magic bytes
  const validation = validateImageBuffer(req.file.buffer);
  if (!validation.valid || !validation.ext || !validation.contentType) {
    return res.status(415).json({ error: "UNSUPPORTED_MEDIA" });
  }

  const storageKey = `gallery/${crypto.randomUUID()}.${validation.ext}`;
  const driver = getStorageDriver();

  try {
    const uploaded = await driver.put(storageKey, req.file.buffer, validation.contentType);

    const photo = await db.galleryPhoto.create({
      data: {
        url: uploaded.url,
        storageKey,
        title: parsed.data.title,
        owner: parsed.data.owner,
        ai: false,
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
  } catch (err) {
    console.error("Gagal mengunggah foto galeri:", err);
    res.status(500).json({ error: "INTERNAL" });
  }
});

// GET /gallery?limit= (Publik, hanya approved)
galleryRouter.get("/", publicLimiter, async (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));

  const photos = await db.galleryPhoto.findMany({
    where: { status: "approved" },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      url: true,
      title: true,
      owner: true,
      ai: true,
      createdAt: true,
    },
  });

  res.json(
    photos.map((p) => ({
      id: p.id,
      url: p.url,
      title: p.title,
      owner: p.owner,
      ai: p.ai,
      createdAt: p.createdAt.toISOString(),
    }))
  );
});

// GET /admin/gallery?status= (Admin)
adminGalleryRouter.get("/", requireAuth, requireRole("admin"), async (req, res) => {
  const statusQuery = req.query.status as PhotoStatus | undefined;
  const where: any = {};
  if (statusQuery && ["pending", "approved", "rejected"].includes(statusQuery)) {
    where.status = statusQuery;
  }

  const photos = await db.galleryPhoto.findMany({
    where,
    orderBy: { createdAt: "desc" },
  });

  res.json(
    photos.map((p) => ({
      id: p.id,
      url: p.url,
      storageKey: p.storageKey,
      title: p.title,
      owner: p.owner,
      ai: p.ai,
      status: p.status,
      createdAt: p.createdAt.toISOString(),
      reviewedAt: p.reviewedAt ? p.reviewedAt.toISOString() : null,
    }))
  );
});

// PATCH /admin/gallery/:id (Admin)
adminGalleryRouter.patch("/:id", requireAuth, requireRole("admin"), async (req, res) => {
  const id = req.params.id as string;
  const parsed = patchGallerySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "VALIDATION", issues: parsed.error.issues });
  }

  const existing = await db.galleryPhoto.findUnique({ where: { id } });
  if (!existing) {
    return res.status(404).json({ error: "NOT_FOUND" });
  }

  const updated = await db.galleryPhoto.update({
    where: { id },
    data: {
      status: parsed.data.status,
      reviewedAt: new Date(),
    },
  });

  res.json({
    id: updated.id,
    url: updated.url,
    title: updated.title,
    owner: updated.owner,
    ai: updated.ai,
    status: updated.status,
    reviewedAt: updated.reviewedAt ? updated.reviewedAt.toISOString() : null,
  });
});

// DELETE /admin/gallery/:id (Admin)
adminGalleryRouter.delete("/:id", requireAuth, requireRole("admin"), async (req, res) => {
  const id = req.params.id as string;

  const existing = await db.galleryPhoto.findUnique({ where: { id } });
  if (!existing) {
    return res.status(404).json({ error: "NOT_FOUND" });
  }

  // Foto dari AI Photo: berkas hasil masih dirujuk oleh AiPhotoJob (resultUrl),
  // jadi barisnya dihapus tetapi berkasnya dipertahankan selama job masih ada.
  if (!existing.ai) {
    const driver = getStorageDriver();
    await driver.remove(existing.storageKey);
  }

  await db.galleryPhoto.delete({ where: { id } });
  res.json({ ok: true });
});
