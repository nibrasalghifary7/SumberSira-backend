import { Router } from "express";
import { z } from "zod";
import { askAi, aiEnabled } from "../lib/ai.js";
import { getCrowd } from "../lib/crowd-service.js";
import { db } from "../lib/db.js";
import { matchFaq } from "../lib/faq-match.js";
import { allow } from "../lib/ratelimit.js";
import { answerFromFacts, buildContext } from "../data/knowledge.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const deviceId = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);
const question = z.string().trim().min(2).max(300);

const faqDto = (f: { id: string; question: string; answer: string; keywords: string; updatedAt: Date }) => ({
  id: f.id,
  question: f.question,
  answer: f.answer,
  keywords: f.keywords,
  updatedAt: f.updatedAt.toISOString(),
});

const questionDto = (q: { id: string; question: string; status: string; answer: string | null; askedAt: Date; answeredAt: Date | null }) => ({
  id: q.id,
  question: q.question,
  status: q.status,
  answer: q.answer,
  askedAt: q.askedAt.toISOString(),
  answeredAt: q.answeredAt?.toISOString() ?? null,
});

// ---------- Publik (aplikasi pengunjung) ----------
export const chatRouter = Router();

// Daftar FAQ untuk tombol pertanyaan cepat
chatRouter.get("/faq", async (_req, res) => {
  const rows = await db.faq.findMany({ orderBy: { createdAt: "asc" } });
  res.json(rows.map(faqDto));
});

// Jawab cepat: FAQ buatan pengelola dulu (tanpa AI), lalu AI yang berpikir dari data Sumber Sira.
// Bila tidak ada jawaban, source = "unknown" dan aplikasi menawarkan "Tanya pengelola".
chatRouter.post("/ask", async (req, res) => {
  const parsed = z.object({ question, deviceId }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "VALIDATION" });
  const { question: q, deviceId: dev } = parsed.data;
  // Batas per perangkat dan per alamat, supaya kuota AI tidak habis oleh satu pihak.
  if (!allow(`ask:${dev}`, 12, 60_000) || !allow(`ask-ip:${req.ip}`, 60, 60_000)) {
    return res.status(429).json({ error: "TOO_MANY_REQUESTS" });
  }

  const faqs = await db.faq.findMany();
  const hit = matchFaq(q, faqs);
  let source: "faq" | "ai" | "kb" | "unknown" = "unknown";
  let answer: string | null = null;

  if (hit) {
    source = "faq";
    answer = hit.faq.answer;
  } else {
    let aiFailed = !aiEnabled();
    if (aiEnabled()) {
      const [rides, crowd] = await Promise.all([db.ride.findMany(), getCrowd()]);
      let context = buildContext(rides, crowd);
      if (faqs.length) context += "\n- Jawaban resmi dari pengelola:\n" + faqs.map((f) => `  * T: ${f.question} J: ${f.answer}`).join("\n");
      const r = await askAi(q, context);
      aiFailed = r.failed;
      if (r.answer) {
        source = "ai";
        answer = r.answer;
      }
    }
    // Tanpa AI (belum dipasang atau gangguan) pakai jawaban cadangan dari kata kunci. AI yang menjawab "tidak tahu" tidak dipaksa.
    if (!answer && aiFailed) {
      const kb = answerFromFacts(q);
      if (kb) {
        source = "kb";
        answer = kb;
      }
    }
  }

  await db.chatLog.create({ data: { source, question: q } }).catch(() => undefined);
  res.json({ source, answer, canAskManager: answer === null });
});

// Kirim pertanyaan ke pengelola (jawaban lambat, ditulis manusia)
chatRouter.post("/questions", async (req, res) => {
  const parsed = z.object({ question, deviceId }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "VALIDATION" });
  const { question: q, deviceId: dev } = parsed.data;
  if (!allow(`ask-mgr:${dev}`, 5, 3600_000)) return res.status(429).json({ error: "TOO_MANY_REQUESTS" });
  const pending = await db.chatQuestion.count({ where: { deviceId: dev, status: "pending" } });
  if (pending >= 10) return res.status(429).json({ error: "TOO_MANY_PENDING" });
  const row = await db.chatQuestion.create({ data: { deviceId: dev, question: q } });
  res.status(201).json(questionDto(row));
});

// Pertanyaan milik perangkat ini beserta balasan pengelola (aplikasi memeriksa ini berkala)
chatRouter.get("/questions", async (req, res) => {
  const dev = deviceId.safeParse(req.query.deviceId);
  if (!dev.success) return res.status(400).json({ error: "VALIDATION" });
  const rows = await db.chatQuestion.findMany({ where: { deviceId: dev.data }, orderBy: { askedAt: "desc" }, take: 30 });
  res.json(rows.map(questionDto));
});

// ---------- Admin ----------
export const adminChatRouter = Router();
adminChatRouter.use(requireAuth);

// Semua data halaman FAQ dan Chatbot dalam satu panggilan: FAQ, pertanyaan menunggu, sudah dijawab, dan statistik
adminChatRouter.get("/overview", async (_req, res) => {
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [faqs, pending, answered, logs] = await Promise.all([
    db.faq.findMany({ orderBy: { createdAt: "asc" } }),
    db.chatQuestion.findMany({ where: { status: "pending" }, orderBy: { askedAt: "asc" } }),
    db.chatQuestion.findMany({ where: { status: "answered" }, orderBy: { answeredAt: "desc" }, take: 30 }),
    db.chatLog.groupBy({ by: ["source"], where: { createdAt: { gte: since } }, _count: { _all: true } }),
  ]);
  const count = (s: string) => logs.find((l) => l.source === s)?._count._all ?? 0;
  const faq = count("faq");
  const ai = count("ai");
  const kb = count("kb");
  const unknown = count("unknown");
  // Persentase otomatis dihitung dari pertanyaan "jawab cepat" 30 hari terakhir; pertanyaan ke pengelola dihitung terpisah.
  const total = faq + ai + kb + unknown;
  const auto = faq + ai + kb;
  res.json({
    faqs: faqs.map(faqDto),
    pending: pending.map(questionDto),
    answered: answered.map(questionDto),
    stats: {
      total,
      auto,
      byFaq: faq,
      byAi: ai,
      byKb: kb,
      unknown,
      pending: pending.length,
      answered: answered.length,
      autoPercent: total === 0 ? 0 : Math.round((auto / total) * 100),
      aiActive: aiEnabled(),
    },
  });
});

// Jawab pertanyaan pengunjung. Hanya yang masih menunggu, supaya dua pengelola tidak saling menimpa jawaban.
adminChatRouter.post("/questions/:id/answer", async (req, res) => {
  const id = String(req.params.id);
  const parsed = z
    .object({ answer: z.string().trim().min(1).max(1000), saveAsFaq: z.boolean().default(false) })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "VALIDATION" });
  const { answer, saveAsFaq } = parsed.data;

  const { count } = await db.chatQuestion.updateMany({
    where: { id, status: "pending" },
    data: { status: "answered", answer, answeredAt: new Date() },
  });
  if (count === 0) return res.status(409).json({ error: "ALREADY_ANSWERED_OR_MISSING" });

  const row = await db.chatQuestion.findUniqueOrThrow({ where: { id } });
  // Simpan jadi FAQ supaya pertanyaan serupa berikutnya dijawab otomatis, tanpa menunggu pengelola lagi.
  const faq = saveAsFaq ? await db.faq.create({ data: { question: row.question, answer } }) : null;
  res.json({ question: questionDto(row), faq: faq && faqDto(faq) });
});

adminChatRouter.delete("/questions/:id", async (req, res) => {
  const { count } = await db.chatQuestion.deleteMany({ where: { id: String(req.params.id) } });
  if (count === 0) return res.status(404).json({ error: "NOT_FOUND" });
  res.json({ ok: true });
});

const faqBody = z.object({
  question: z.string().trim().min(3).max(200),
  answer: z.string().trim().min(1).max(1000),
  keywords: z.string().trim().max(200).default(""),
});

// FAQ: admin dan petugas boleh mengelola
adminChatRouter.get("/faq", async (_req, res) => {
  res.json((await db.faq.findMany({ orderBy: { createdAt: "asc" } })).map(faqDto));
});

adminChatRouter.post("/faq", async (req, res) => {
  const parsed = faqBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "VALIDATION" });
  res.status(201).json(faqDto(await db.faq.create({ data: parsed.data })));
});

adminChatRouter.patch("/faq/:id", async (req, res) => {
  const parsed = faqBody.partial().safeParse(req.body);
  if (!parsed.success || Object.keys(parsed.data).length === 0) return res.status(400).json({ error: "VALIDATION" });
  const id = String(req.params.id);
  const { count } = await db.faq.updateMany({ where: { id }, data: parsed.data });
  if (count === 0) return res.status(404).json({ error: "NOT_FOUND" });
  res.json(faqDto(await db.faq.findUniqueOrThrow({ where: { id } })));
});

adminChatRouter.delete("/faq/:id", requireRole("admin"), async (req, res) => {
  const { count } = await db.faq.deleteMany({ where: { id: String(req.params.id) } });
  if (count === 0) return res.status(404).json({ error: "NOT_FOUND" });
  res.json({ ok: true });
});
