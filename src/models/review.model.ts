// Model review: skema validasi input (zod) dan pemetaan data ke bentuk respons API.
import { z } from "zod";

export const createReviewSchema = z.object({
  name: z.string().trim().min(1).max(40),
  stars: z.number().int().min(1).max(5),
  text: z.string().trim().min(1).max(500),
});
