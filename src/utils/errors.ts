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

  // Log galat internal di server
  console.error("Internal Server Error:", err);

  res.status(500).json({ error: "INTERNAL" });
}
