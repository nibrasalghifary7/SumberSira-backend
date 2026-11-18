import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { config } from "./config/index.js";
import path from "node:path";
import { errorHandler, notFoundHandler } from "./utils/errors.js";
import { db } from "./config/database.js";
import { registerRoutes } from "./routes/index.js";

export const app = express();

app.set("trust proxy", config.TRUST_PROXY);

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

app.use(express.json());
app.use(cookieParser());

// Di mode pengembangan, semua localhost, 127.0.0.1, dan IP LAN boleh (Flutter web memakai port acak, HP memakai IP LAN).
// Di produksi, hanya alamat web admin dan EXTRA_ORIGINS (mis. web Flutter yang dideploy).
// Garis miring di akhir alamat dibuang supaya https://contoh.com/ dan https://contoh.com dianggap sama.
const extraOrigins = config.EXTRA_ORIGINS.split(",")
  .map((s) => s.trim().replace(/\/+$/, ""))
  .filter(Boolean);
const adminOrigin = config.ADMIN_ORIGIN.replace(/\/+$/, "");
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // Postman, Flutter mobile, server-ke-server
      const dev =
        config.NODE_ENV !== "production" &&
        /^http:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+)(:\d+)?$/.test(origin);
      cb(null, dev || origin === adminOrigin || extraOrigins.includes(origin));
    },
    credentials: true,
  }),
);

app.get("/", (_req, res) => {
  res.json({ name: "SumberSira API", status: "ok" });
});

app.get("/health", (_req, res) => res.json({ ok: true }));

app.get("/health/db", async (_req, res) => {
  const rides = await db.ride.count();
  res.json({ ok: true, rides });
});


// Semua rute dipasang dari routes/index.ts
registerRoutes(app);

// Sajikan file statis uploads hanya saat STORAGE_DRIVER=local
if (config.STORAGE_DRIVER === "local") {
  app.use("/uploads", express.static(path.resolve(process.cwd(), "uploads")));
}

// Handler 404 untuk rute tak dikenal
app.use(notFoundHandler);

// Handler galat global
app.use(errorHandler);
