import type { Request, Response, NextFunction } from "express";
import { logger } from "../logger.js";

/**
 * Error bertipe untuk kondisi yang memang sudah diperkirakan
 * (input salah, data tidak ditemukan, akses ditolak, dan sejenisnya).
 * Status 4xx dianggap galat pemanggil; hanya galat tak terduga yang menjadi 500.
 */
export class HttpError extends Error {
  status: number;
  code: string;
  extra?: Record<string, unknown>;

  constructor(status: number, code: string, extra?: Record<string, unknown>) {
    super(code);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

// Route yang tidak terdaftar. Dibedakan dari galat tak terduga (500).
export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ error: "NOT_FOUND", requestId: req.id });
}

/**
 * Handler galat terakhir (empat argumen). Format respons mengikuti API proyek:
 * `{ error: "KODE", requestId?: "..." }`.
 *
 * - Galat yang dikenal (HttpError, body-parser, multer) dibalas 4xx dengan kode jelas.
 * - Galat tak terduga dibalas 500 dengan pesan umum `INTERNAL`; detail dan stack
 *   hanya masuk log server, tidak pernah ke klien.
 * - Bila header respons sudah terkirim, penerusan diserahkan ke Express agar
 *   koneksi ditutup dengan benar (tidak mencoba mengirim JSON kedua kali).
 */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (res.headersSent) {
    return next(err);
  }

  if (err instanceof HttpError) {
    return res.status(err.status).json({
      ...(err.extra ?? {}),
      error: err.code,
      requestId: req.id,
    });
  }

  // Galat dari body-parser / klien: body bukan JSON valid ("entity.parse.failed",
  // termasuk body "null" karena parser memakai mode strict), body terlalu besar,
  // atau galat lain yang membawa status 4xx. Ini galat pemanggil (4xx), bukan
  // galat internal, jadi tidak di-log sebagai Internal Server Error.
  const clientError = err as { type?: unknown; status?: unknown; statusCode?: unknown } | null;
  const type = typeof clientError?.type === "string" ? clientError.type : undefined;
  const status =
    typeof clientError?.status === "number"
      ? clientError.status
      : typeof clientError?.statusCode === "number"
        ? clientError.statusCode
        : undefined;

  if (type === "entity.parse.failed") {
    return res.status(400).json({ error: "VALIDATION", requestId: req.id });
  }

  if (type === "entity.too.large") {
    return res.status(413).json({ error: "VALIDATION", requestId: req.id });
  }

  if (status !== undefined && status >= 400 && status < 500) {
    return res.status(status).json({ error: "VALIDATION", requestId: req.id });
  }

  // Log detail internal di server (stack trace ikut tercatat di sini, bukan di respons).
  (req.log ?? logger).error({ err, requestId: req.id }, "unhandled error");

  res.status(500).json({ error: "INTERNAL", requestId: req.id });
}
