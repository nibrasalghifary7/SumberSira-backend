import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { db } from "./lib/db.js";
import { authRouter } from "./routes/auth.js";
import { adminRidesRouter, ridesRouter, slotsRouter } from "./routes/rides.js";

const app = express();

app.use(express.json());
app.use(cookieParser());
// Di mode pengembangan, semua localhost boleh (Flutter web memakai port acak).
// Di produksi, hanya alamat web admin.
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // Postman, Flutter mobile, server-ke-server
      const dev = process.env.NODE_ENV !== "production" && /^http:\/\/localhost:\d+$/.test(origin);
      cb(null, dev || origin === process.env.ADMIN_ORIGIN);
    },
    credentials: true,
  }),
);
app.get("/health", (_req, res) => res.json({ ok: true }));
app.get("/", (_req, res) => {
  res.json({ name: "SumberSira API", status: "ok" });
});
app.use("/auth", authRouter);
app.use("/rides", ridesRouter);
app.use("/time-slots", slotsRouter);
app.use("/admin/rides", adminRidesRouter);
app.get("/health/db", async (_req, res) => {
  const rides = await db.ride.count();
  res.json({ ok: true, rides });
});

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => console.log(`API jalan di http://localhost:${port}`));