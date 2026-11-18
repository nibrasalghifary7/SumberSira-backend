// Model auth: skema validasi input (zod) dan pemetaan data ke bentuk respons API.
import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  remember: z.boolean().optional(),
});

// Ubah password sendiri: sesi lain dicabut, sesi saat ini tetap
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(72),
});
