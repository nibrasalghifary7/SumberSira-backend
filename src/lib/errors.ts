import type { Request, Response, NextFunction } from "express";

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

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: "NOT_FOUND" });
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({
      error: err.code,
      ...(err.extra ?? {}),
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
    return res.status(400).json({ error: "VALIDATION" });
  }

  if (type === "entity.too.large") {
    return res.status(413).json({ error: "VALIDATION" });
  }

  if (status !== undefined && status >= 400 && status < 500) {
    return res.status(status).json({ error: "VALIDATION" });
  }

  // Log galat internal di server
  console.error("Internal Server Error:", err);

  res.status(500).json({ error: "INTERNAL" });
}
