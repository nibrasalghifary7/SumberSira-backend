import { Router } from "express";
import { z } from "zod";
import { db } from "../lib/db.js";
import { writeLimiter, publicLimiter } from "../lib/limiters.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

export const reviewsRouter = Router();
export const adminReviewsRouter = Router();

const createReviewSchema = z.object({
  name: z.string().trim().min(1).max(40),
  stars: z.number().int().min(1).max(5),
  text: z.string().trim().min(1).max(500),
});

// GET /reviews (Publik, tanpa moderasi)
reviewsRouter.get("/", publicLimiter, async (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));

  const [reviews, totalCount, aggregate] = await Promise.all([
    db.review.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        name: true,
        stars: true,
        text: true,
        createdAt: true,
      },
    }),
    db.review.count(),
    db.review.aggregate({
      _avg: { stars: true },
    }),
  ]);

  const avg = aggregate._avg.stars ?? 0;
  // Format rating 1 desimal
  const rating = Number(avg.toFixed(1));

  res.json({
    items: reviews.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
    })),
    rating,
    count: totalCount,
  });
});

// POST /reviews (Publik)
reviewsRouter.post("/", writeLimiter, async (req, res) => {
  const parsed = createReviewSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "VALIDATION", issues: parsed.error.issues });
  }

  const { name, stars, text } = parsed.data;

  const review = await db.review.create({
    data: {
      name,
      stars,
      text,
    },
  });

  res.status(201).json({
    id: review.id,
    name: review.name,
    stars: review.stars,
    text: review.text,
    createdAt: review.createdAt.toISOString(),
  });
});

// GET /admin/reviews (Admin)
adminReviewsRouter.get("/", requireAuth, requireRole("admin"), async (_req, res) => {
  const reviews = await db.review.findMany({
    orderBy: { createdAt: "desc" },
  });

  res.json(
    reviews.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
    }))
  );
});

// DELETE /admin/reviews/:id (Admin)
adminReviewsRouter.delete("/:id", requireAuth, requireRole("admin"), async (req, res) => {
  const id = req.params.id as string;

  const existing = await db.review.findUnique({ where: { id } });
  if (!existing) {
    return res.status(404).json({ error: "NOT_FOUND" });
  }

  await db.review.delete({ where: { id } });
  res.json({ ok: true });
});
