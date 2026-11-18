// Model staff: skema validasi input (zod) dan pemetaan data ke bentuk respons API.
import { z } from "zod";
import { passwordSchema } from "../services/validatePassword.js";

export const createStaffSchema = z.object({
  name: z.string().trim().min(1).max(60),
  email: z.string().trim().email(),
  role: z.enum(["petugas", "admin"]),
  password: passwordSchema,
});

export const patchStaffSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  role: z.enum(["petugas", "admin"]).optional(),
  active: z.boolean().optional(),
});

export const resetPasswordSchema = z.object({
  password: passwordSchema,
});
