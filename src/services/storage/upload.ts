import type { Request, Response, NextFunction } from "express";
import multer from "multer";

const storage = multer.memoryStorage();

export const uploadSinglePhoto = multer({
  storage,
  limits: {
    fileSize: 4 * 1024 * 1024, // 4 MB
  },
}).single("photo");

export function handleUpload(req: Request, res: Response, next: NextFunction) {
  uploadSinglePhoto(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({ error: "FILE_TOO_LARGE" });
      }
      return res.status(400).json({ error: "VALIDATION" });
    }
    if (err) {
      return res.status(400).json({ error: "VALIDATION" });
    }
    next();
  });
}

/**
 * Validasi magic bytes gambar:
 * - JPEG: FF D8 FF
 * - PNG: 89 50 4E 47
 * - WebP: RIFF (bytes 0..3) & WEBP (bytes 8..11)
 */
export function validateImageBuffer(buffer: Buffer): { valid: boolean; ext?: string; contentType?: string } {
  if (!buffer || buffer.length < 12) {
    return { valid: false };
  }

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { valid: true, ext: "jpg", contentType: "image/jpeg" };
  }

  // PNG: 89 50 4E 47
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return { valid: true, ext: "png", contentType: "image/png" };
  }

  // WebP: 'RIFF' di 0..3 dan 'WEBP' di 8..11
  const isRiff = buffer.toString("ascii", 0, 4) === "RIFF";
  const isWebp = buffer.toString("ascii", 8, 12) === "WEBP";
  if (isRiff && isWebp) {
    return { valid: true, ext: "webp", contentType: "image/webp" };
  }

  return { valid: false };
}
