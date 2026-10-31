import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { db } from "./lib/db.js";
import { authRouter } from "./routes/auth.js";

const app = express();

app.use(express.json());
app.use(cookieParser());
app.use(cors({ origin: process.env.ADMIN_ORIGIN, credentials: true }));

app.get("/health", (_req, res) => res.json({ ok: true }));
app.use("/auth", authRouter);
app.get("/health/db", async (_req, res) => {
  const rides = await db.ride.count();
  res.json({ ok: true, rides });
});

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => console.log(`API jalan di http://localhost:${port}`));