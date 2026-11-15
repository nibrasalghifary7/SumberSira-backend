import rateLimit from "express-rate-limit";

// Pembatas publik umum: 60 req / menit / IP
export const publicLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({ error: "RATE_LIMITED" });
  },
});

// Pembatas aksi tulis (order, tiket, dll): 20 req / menit / IP
export const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({ error: "RATE_LIMITED" });
  },
});

// Pembatas unggah AI Photo: 10 req / menit / IP
export const aiPhotoLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({ error: "RATE_LIMITED" });
  },
});

// Pembatas percobaan login gagal: 5 gagal / menit / email normalisasi
export const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { default: true, keyGeneratorIpFallback: false },
  keyGenerator: (req) => {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    return email || req.ip || "unknown";
  },
  handler: (_req, res) => {
    res.status(429).json({ error: "RATE_LIMITED" });
  },
});
