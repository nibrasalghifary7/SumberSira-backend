import type { Logger } from "pino";

/**
 * Tipe tambahan untuk objek Express.
 *
 * `req.id` dan `req.log` dipasang oleh middleware di `src/logger.ts`.
 * `res.locals.user` dan `res.locals.sessionId` dipasang oleh
 * `requireAuth` di `src/middleware/auth.ts`, sehingga controller tidak perlu
 * memakai `any` dan bentuk data pengguna yang lolos ke tampilan selalu sama.
 */
declare global {
  namespace Express {
    interface Request {
      /** Request ID yang juga dikirim pada header respons `X-Request-Id`. */
      id: string;
      /** Logger anak (child logger) yang sudah membawa request ID. */
      log: Logger;
    }

    interface Locals {
      user: {
        id: string;
        name: string;
        email: string;
        role: "admin" | "petugas";
        active: boolean;
        createdAt: Date;
      };
      sessionId: string;
    }
  }
}

export {};
