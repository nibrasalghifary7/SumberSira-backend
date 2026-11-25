import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import pino, { type Logger } from "pino";
import { pinoHttp } from "pino-http";
import { config } from "./config/index.js";

/**
 * Logger terstruktur (JSON) untuk seluruh aplikasi.
 *
 * - Setiap baris log membawa `service`, `env`, dan `requestId` (bila ada request).
 * - Data sensitif disensor: header Authorization/Cookie, Set-Cookie, dan field
 *   password/token di body. Body request tidak pernah dicatat seluruhnya.
 * - `LOG_LEVEL=silent` dipakai saat test agar output tidak mengotori hasil.
 */
export const logger: Logger = pino({
  level: config.LOG_LEVEL,
  base: { service: "sumbersira-api", env: config.NODE_ENV },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      'res.headers["set-cookie"]',
      "password",
      "currentPassword",
      "newPassword",
      "token",
      "*.password",
      "*.currentPassword",
      "*.newPassword",
      "*.token",
      "*.authorization",
      "*.cookie",
    ],
    censor: "[REDACTED]",
  },
});

// ID dari klien hanya diterima bila bentuknya wajar: 8-128 karakter
// huruf/angka/titik/strip/garis bawah/titik dua. Selain itu dibuat ID baru,
// supaya nilai sembarang tidak bisa memecah format log.
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

/**
 * Membuat (atau memvalidasi) request ID, menyimpannya di `req.id`, dan
 * mengirimkannya kembali pada header respons `X-Request-Id`.
 * Dipasang paling awal agar semua log dan respons galat memakai ID yang sama.
 */
export function requestId(req: Request, res: Response, next: NextFunction) {
  const incoming = req.get("x-request-id");
  const id = incoming && REQUEST_ID_PATTERN.test(incoming) ? incoming : randomUUID();

  req.id = id;
  res.setHeader("X-Request-Id", id);

  // Semua respons galat (`{ error: "KODE", ... }`) otomatis membawa requestId
  // yang sama dengan header, tanpa setiap route harus menuliskannya sendiri.
  const sendJson = res.json.bind(res);
  res.json = ((body: unknown) => {
    if (body && typeof body === "object" && !Array.isArray(body) && "error" in body) {
      return sendJson({ ...(body as Record<string, unknown>), requestId: id });
    }
    return sendJson(body as never);
  }) as Response["json"];

  next();
}

/**
 * Request logger: mencatat method, path, status, durasi, dan request ID.
 * Path health-check diabaikan agar log tidak penuh oleh probe.
 */
export const httpLogger = pinoHttp({
  logger,
  genReqId: (req) => (req as unknown as Request).id,
  customProps: (req) => ({ requestId: (req as unknown as Request).id }),
  autoLogging: {
    ignore: (req) => {
      const url = (req.url ?? "").split("?")[0];
      return url === "/health" || url === "/health/live";
    },
  },
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return "error";
    if (res.statusCode >= 400) return "warn";
    return "info";
  },
  serializers: {
    req(req) {
      return {
        id: req.id,
        method: req.method,
        url: req.url,
        remoteAddress: req.remoteAddress,
      };
    },
    res(res) {
      return { statusCode: res.statusCode };
    },
  },
});
