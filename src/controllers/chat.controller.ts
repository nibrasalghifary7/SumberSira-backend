import { Router } from "express";
import { z } from "zod";
import { db } from "../config/database.js";
import { writeLimiter, publicLimiter } from "../utils/limiters.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { chatMessageSchema, createFaqSchema, quickQuestionsSchema, updateFaqSchema } from "../models/faq.model.js";
import { config } from "../config/index.js";
import { aiAktif } from "../services/ai/client.js";
import { batasChat, tanyaAsisten } from "../services/ai/chatbot.js";

export const chatRouter = Router();
export const adminFaqRouter = Router();







const TOMBOL_BAWAAN = ["Jam buka?", "Cara sewa ATV?", "Harga tiket?", "Parkir bus?"];

// Tombol jawaban cepat yang diatur admin (Setting quickQuestions); bila belum diatur, pakai bawaan.
async function bacaTombolCepat(): Promise<string[]> {
  const setting = await db.setting.findUnique({ where: { key: "quickQuestions" } });
  if (setting && Array.isArray(setting.value)) {
    const daftar = setting.value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
    if (daftar.length) return daftar;
  }
  return TOMBOL_BAWAAN;
}

const JAWABAN_BELUM_TAHU = "Maaf, aku belum punya jawabannya. Pertanyaanmu sudah dicatat untuk admin ya.";

// POST /chat (Publik)
// 1) Tombol jawaban cepat (teks persis sama dengan tombol yang diatur admin) dijawab langsung dengan jawaban FAQ admin,
//    tanpa AI: cepat, gratis, dan pasti sesuai yang ditulis admin.
// 2) Pertanyaan lain dijawab AI yang hanya boleh memakai data resmi: harga, wahana, jam, keramaian, dan FAQ admin.
//    Bila AI tidak tahu, pertanyaan dicatat ke daftar Belum Terjawab supaya admin bisa menambah FAQ.
// 3) Tanpa AI (belum ada kunci, jatah harian habis, atau galat): cadangan pencocokan kata kunci FAQ seperti sebelumnya.
chatRouter.post("/", writeLimiter, async (req, res) => {
  const parsed = chatMessageSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "VALIDATION", issues: parsed.error.issues });
  }

  const pesan = parsed.data.message;
  const pesanKecil = pesan.toLowerCase();

  // Ambil FAQ aktif urut sortOrder ascending
  const faqs = await db.faq.findMany({
    where: { active: true },
    orderBy: { sortOrder: "asc" },
  });
  const jawabanFaq = faqs.find((faq) => faq.keys.some((key) => pesanKecil.includes(key.toLowerCase().trim())))?.answer ?? null;

  const tombol = await bacaTombolCepat();
  const dariTombol = tombol.some((t) => t.trim().toLowerCase() === pesanKecil.trim());
  if (dariTombol && jawabanFaq) {
    return res.json({ answer: jawabanFaq, matched: true, source: "faq" });
  }

  const ai = await tanyaAsisten(pesan, parsed.data.history ?? []);
  if (ai) {
    if (!ai.answered) await db.unansweredQuestion.create({ data: { question: pesan } });
    return res.json({ answer: ai.answer, matched: ai.answered, source: "ai" });
  }

  if (jawabanFaq) {
    return res.json({ answer: jawabanFaq, matched: true, source: "faq" });
  }

  // Jika tidak cocok, catat ke UnansweredQuestion
  await db.unansweredQuestion.create({
    data: {
      question: pesan,
    },
  });

  return res.json({
    answer: JAWABAN_BELUM_TAHU,
    matched: false,
    source: "faq",
  });
});

// GET /chat/quick-questions (Publik)
chatRouter.get("/quick-questions", publicLimiter, async (_req, res) => {
  return res.json(await bacaTombolCepat());
});

// GET /admin/faq/quick-questions (Admin): tombol jawaban cepat yang tampil di aplikasi
adminFaqRouter.get("/quick-questions", requireAuth, requireRole("admin"), async (_req, res) => {
  res.json({ questions: await bacaTombolCepat() });
});

// PUT /admin/faq/quick-questions (Admin): tambah, kurangi, atau ubah tombol (1 sampai 6)
adminFaqRouter.put("/quick-questions", requireAuth, requireRole("admin"), async (req, res) => {
  const parsed = quickQuestionsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "VALIDATION", issues: parsed.error.issues });
  }
  // Buang duplikat tanpa memedulikan huruf besar-kecil
  const unik = parsed.data.questions.filter((q, i, arr) => arr.findIndex((x) => x.toLowerCase() === q.toLowerCase()) === i);
  await db.setting.upsert({
    where: { key: "quickQuestions" },
    update: { value: unik },
    create: { key: "quickQuestions", value: unik },
  });
  res.json({ questions: unik });
});

// GET /admin/faq/ai-status (Admin): apakah chatbot AI aktif, dan berapa jatah hari ini terpakai
adminFaqRouter.get("/ai-status", requireAuth, requireRole("admin"), (_req, res) => {
  res.json({
    enabled: aiAktif() && config.CHAT_AI_DAILY_LIMIT > 0,
    model: config.CHAT_MODEL,
    dailyLimit: config.CHAT_AI_DAILY_LIMIT,
    usedToday: batasChat.terpakai(),
  });
});

// GET /admin/faq (Admin, urut sortOrder)
adminFaqRouter.get("/", requireAuth, requireRole("admin"), async (_req, res) => {
  const faqs = await db.faq.findMany({
    orderBy: { sortOrder: "asc" },
  });
  res.json(faqs);
});

// POST /admin/faq (Admin)
adminFaqRouter.post("/", requireAuth, requireRole("admin"), async (req, res) => {
  const parsed = createFaqSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "VALIDATION", issues: parsed.error.issues });
  }

  const { keys, answer, sortOrder, active } = parsed.data;
  const lowerKeys = keys.map((k) => k.toLowerCase().trim());

  const created = await db.faq.create({
    data: {
      keys: lowerKeys,
      answer,
      sortOrder: sortOrder ?? 0,
      active: active ?? true,
    },
  });

  res.status(201).json(created);
});

// PATCH /admin/faq/:id (Admin)
adminFaqRouter.patch("/:id", requireAuth, requireRole("admin"), async (req, res) => {
  const id = req.params.id as string;
  const parsed = updateFaqSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "VALIDATION", issues: parsed.error.issues });
  }

  const existing = await db.faq.findUnique({ where: { id } });
  if (!existing) {
    return res.status(404).json({ error: "NOT_FOUND" });
  }

  const { keys, answer, sortOrder, active } = parsed.data;
  const data: any = {};
  if (keys !== undefined) {
    data.keys = keys.map((k) => k.toLowerCase().trim());
  }
  if (answer !== undefined) data.answer = answer;
  if (sortOrder !== undefined) data.sortOrder = sortOrder;
  if (active !== undefined) data.active = active;

  const updated = await db.faq.update({
    where: { id },
    data,
  });

  res.json(updated);
});

// DELETE /admin/faq/:id (Admin)
adminFaqRouter.delete("/:id", requireAuth, requireRole("admin"), async (req, res) => {
  const id = req.params.id as string;

  const existing = await db.faq.findUnique({ where: { id } });
  if (!existing) {
    return res.status(404).json({ error: "NOT_FOUND" });
  }

  await db.faq.delete({ where: { id } });
  res.json({ ok: true });
});

// GET /admin/faq/unanswered (Admin)
adminFaqRouter.get("/unanswered", requireAuth, requireRole("admin"), async (_req, res) => {
  const list = await db.unansweredQuestion.findMany({
    orderBy: { createdAt: "desc" },
  });
  res.json(
    list.map((q) => ({
      ...q,
      createdAt: q.createdAt.toISOString(),
    }))
  );
});

// DELETE /admin/faq/unanswered/:id (Admin)
adminFaqRouter.delete("/unanswered/:id", requireAuth, requireRole("admin"), async (req, res) => {
  const id = req.params.id as string;

  const existing = await db.unansweredQuestion.findUnique({ where: { id } });
  if (!existing) {
    return res.status(404).json({ error: "NOT_FOUND" });
  }

  await db.unansweredQuestion.delete({ where: { id } });
  res.json({ ok: true });
});
