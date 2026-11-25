// Model faq: skema validasi input (zod) dan pemetaan data ke bentuk respons API.
import { z } from "zod";

export const chatMessageSchema = z.object({
  message: z.string().trim().min(1).max(300),
  // Beberapa pesan terakhir (opsional) supaya pertanyaan lanjutan seperti "kalau anak-anak?" dimengerti AI.
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(600) }))
    .max(8)
    .optional(),
});

// Tombol jawaban cepat di aplikasi: 1 sampai 6 pertanyaan pendek.
export const quickQuestionsSchema = z.object({
  questions: z.array(z.string().trim().min(2).max(40)).min(1).max(6),
});

export const createFaqSchema = z.object({
  keys: z.array(z.string().trim().min(1).max(30)).min(1).max(10),
  answer: z.string().trim().min(1).max(500),
  sortOrder: z.number().int().optional(),
  active: z.boolean().optional(),
});

export const updateFaqSchema = z.object({
  keys: z.array(z.string().trim().min(1).max(30)).min(1).max(10).optional(),
  answer: z.string().trim().min(1).max(500).optional(),
  sortOrder: z.number().int().optional(),
  active: z.boolean().optional(),
});
