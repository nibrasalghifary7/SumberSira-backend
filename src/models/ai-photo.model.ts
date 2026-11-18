// Model ai-photo: skema validasi input (zod) dan pemetaan data ke bentuk respons API.
import { z } from "zod";

export const shareSchema = z.object({
  title: z.string().trim().min(1).max(60),
  owner: z.string().trim().min(1).max(40),
});
