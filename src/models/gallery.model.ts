// Model gallery: skema validasi input (zod) dan pemetaan data ke bentuk respons API.
import { z } from "zod";

export const createGallerySchema = z.object({
  title: z.string().trim().min(1).max(60),
  owner: z.string().trim().min(1).max(40),
  caption: z.string().trim().max(280).default(""),
});

export const patchGallerySchema = z.object({
  status: z.enum(["approved", "rejected"]),
});
