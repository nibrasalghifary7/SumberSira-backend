import "dotenv/config";
import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { db } from "./lib/db.js";
import { authRouter } from "./routes/auth.js";
import { adminChatRouter, chatRouter } from "./routes/chat.js";
import { adminRidesRouter, ridesRouter, slotsRouter } from "./routes/rides.js";
import { adminInsightRouter, adminTicketsRouter, crowdRouter, ticketsRouter } from "./routes/tickets.js";

const app = express();

app.use(express.json({ limit: "50kb" }));
app.use(cookieParser());
// Di mode pengembangan, semua localhost boleh (Flutter web memakai port acak).
// Di produksi, hanya alamat web admin.
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // Postman, Flutter mobile, server-ke-server
      const dev = process.env.NODE_ENV !== "production" && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin);
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
app.use("/tickets", ticketsRouter);
app.use("/crowd", crowdRouter);
app.use("/chat", chatRouter);
app.use("/admin/tickets", adminTicketsRouter);
app.use("/admin/insight", adminInsightRouter);
app.use("/admin/chat", adminChatRouter);
app.get("/health/db", async (_req, res) => {
  const rides = await db.ride.count();
  res.json({ ok: true, rides });
});

// Kesalahan tak terduga (mis. database putus) selalu dijawab JSON, bukan halaman HTML Express.
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  if (res.headersSent) return;
  const bad = err instanceof SyntaxError || (err as { type?: string })?.type === "entity.parse.failed";
  res.status(bad ? 400 : 500).json({ error: bad ? "BAD_JSON" : "SERVER_ERROR" });
});

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => {
  console.log(`API jalan di http://localhost:${port}`);
  // Hangatkan dua koneksi database sejak awal (sambungan pertama ke Neon makan beberapa detik),
  // supaya halaman admin pertama yang dibuka tidak ikut menunggu.
  void Promise.all([db.$queryRaw`SELECT 1`, db.$queryRaw`SELECT 1`]).catch(() => console.warn("Database belum terjangkau saat start; akan dicoba lagi saat ada permintaan."));
});
