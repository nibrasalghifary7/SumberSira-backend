import { z } from "zod";

/**
 * Aturan kekuatan password yang dipakai bersama oleh endpoint ubah password,
 * pembuatan akun staff, dan reset password. Frontend boleh menampilkan aturan
 * yang sama, tetapi backend tetap memeriksa ulang karena request bisa dikirim
 * tanpa melewati form web.
 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 72;

export const PASSWORD_RULES = [
  `minimal ${PASSWORD_MIN_LENGTH} karakter`,
  "mengandung huruf kecil",
  "mengandung huruf besar",
  "mengandung angka",
] as const;

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Password minimal ${PASSWORD_MIN_LENGTH} karakter`)
  .max(PASSWORD_MAX_LENGTH, `Password maksimal ${PASSWORD_MAX_LENGTH} karakter`)
  .regex(/[a-z]/, "Password harus mengandung huruf kecil")
  .regex(/[A-Z]/, "Password harus mengandung huruf besar")
  .regex(/[0-9]/, "Password harus mengandung angka");
