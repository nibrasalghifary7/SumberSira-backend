// Model ai-photo: skema validasi input (zod) dan pemetaan data ke bentuk respons API.
import { z } from "zod";

export const shareSchema = z.object({
  title: z.string().trim().min(1).max(60),
  owner: z.string().trim().min(1).max(40),
  // Caption opsional; klien lama yang belum mengirim caption tetap valid.
  caption: z.string().trim().max(280).default(""),
});

// Kekuatan perbaikan foto: 0 = foto asli, 100 = perbaikan penuh.
export const strengthSchema = z.object({
  strength: z.number().int().min(0).max(100),
});
