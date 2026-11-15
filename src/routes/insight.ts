import { Router } from "express";
import { db } from "../lib/db.js";
import { HOURLY_FORECAST } from "../constants.js";
import { ruleBasedInsightGenerator } from "../lib/insight.js";
import { calculateCurrentCrowd } from "./crowd.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

export const adminInsightRouter = Router();

// GET /admin/insight (Admin)
adminInsightRouter.get("/", requireAuth, requireRole("admin"), async (_req, res) => {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [starGroups, lowStarsLast7Days, crowd] = await Promise.all([
    db.review.groupBy({
      by: ["stars"],
      _count: { stars: true },
    }),
    db.review.count({
      where: { stars: { in: [1, 2] }, createdAt: { gte: sevenDaysAgo } },
    }),
    calculateCurrentCrowd(),
  ]);

  // Distribusi bintang 1..5 dan rata-rata 1 desimal
  const distribution = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
  let reviewCount = 0;
  let starSum = 0;
  for (const g of starGroups) {
    const key = String(g.stars) as keyof typeof distribution;
    if (key in distribution) {
      distribution[key] = g._count.stars;
      reviewCount += g._count.stars;
      starSum += g.stars * g._count.stars;
    }
  }
  const rating = reviewCount > 0 ? Math.round((starSum / reviewCount) * 10) / 10 : 0;

  // Jam terpadat dari konstanta HOURLY_FORECAST
  const peak = HOURLY_FORECAST.reduce((a, b) => (b.count > a.count ? b : a));

  const crowdSummary = {
    inside: crowd.inside,
    percent: crowd.percent,
    label: crowd.label,
  };

  const suggestions = ruleBasedInsightGenerator.suggest({
    rating,
    reviewCount,
    lowStarsLast7Days,
    crowd: crowdSummary,
  });

  res.json({
    rating,
    reviewCount,
    distribution,
    crowd: crowdSummary,
    peakHour: peak.hour,
    suggestions,
  });
});
