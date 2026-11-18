// Model ride: skema validasi input (zod) dan pemetaan data ke bentuk respons API.
import { z } from "zod";

export type RideRow = {
  id: string;
  name: string;
  category: string;
  price: number;
  unit: string;
  icon: string;
  active: boolean;
};

// Bentuk yang sama dengan objek WAHANA di frontend
export const toRideDto = (r: RideRow) => ({
  id: r.id,
  name: r.name,
  category: r.category,
  price: r.price,
  unit: r.unit,
  icon: r.icon,
  status: r.active ? "Aktif" : "Nonaktif",
});

export const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

export const rideBaseSchema = z.object({
  name: z.string().trim().min(1).max(80),
  category: z.enum(["Sewa Alat", "Wahana"]),
  price: z.number().int().min(0).max(10_000_000),
  unit: z.string().trim().max(30),
  icon: z.string().trim().min(1).max(30),
  status: z.enum(["Aktif", "Nonaktif"]),
});

// Saat menambah: unit, icon, status boleh kosong (diisi default di bawah)
export const createRideSchema = rideBaseSchema.partial({ unit: true, icon: true, status: true });

// Saat mengubah: semua field boleh dikirim sebagian
export const updateRideSchema = rideBaseSchema.partial();
