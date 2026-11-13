import { Router } from "express";
import { z } from "zod";
import { db } from "../lib/db.js";
import { writeLimiter, publicLimiter } from "../lib/limiters.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

export const chatRouter = Router();
export const adminFaqRouter = Router();

const chatMessageSchema = z.object({
  message: z.string().trim().min(1).max(300),
});

const createFaqSchema = z.object({
  keys: z.array(z.string().trim().min(1).max(30)).min(1).max(10),
  answer: z.string().trim().min(1).max(500),
  sortOrder: z.number().int().optional(),
  active: z.boolean().optional(),
});

const updateFaqSchema = z.object({
  keys: z.array(z.string().trim().min(1).max(30)).min(1).max(10).optional(),
  answer: z.string().trim().min(1).max(500).optional(),
  sortOrder: z.number().int().optional(),
  active: z.boolean().optional(),
});

// POST /chat (Publik, pencocokan kata kunci FAQ aktif urut sortOrder)
chatRouter.post("/", writeLimiter, async (req, res) => {
  const parsed = chatMessageSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "VALIDATION", issues: parsed.error.issues });
  }

  const message = parsed.data.message.toLowerCase();

  // Ambil FAQ aktif urut sortOrder ascending
  const faqs = await db.faq.findMany({
    where: { active: true },
    orderBy: { sortOrder: "asc" },
  });

  let matchedAnswer: string | null = null;
  for (const faq of faqs) {
    const hasMatch = faq.keys.some((key) => message.includes(key.toLowerCase().trim()));
    if (hasMatch) {
      matchedAnswer = faq.answer;
      break;
    }
  }

  if (matchedAnswer) {
    return res.json({
      answer: matchedAnswer,
      matched: true,
    });
  }

  // Jika tidak cocok, catat ke UnansweredQuestion
  await db.unansweredQuestion.create({
    data: {
      question: parsed.data.message,
    },
  });

  return res.json({
    answer: "Maaf, aku belum punya jawabannya. Pertanyaanmu sudah dicatat untuk admin ya.",
    matched: false,
  });
});

// GET /chat/quick-questions (Publik)
chatRouter.get("/quick-questions", publicLimiter, async (_req, res) => {
  const setting = await db.setting.findUnique({
    where: { key: "quickQuestions" },
  });

  if (setting && Array.isArray(setting.value)) {
    return res.json(setting.value);
  }

  return res.json(["Jam buka?", "Cara sewa ATV?", "Harga tiket?", "Parkir bus?"]);
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
