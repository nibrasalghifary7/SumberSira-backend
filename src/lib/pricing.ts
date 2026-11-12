import { z } from "zod";
import { db } from "./db.js";

export const parkingSchema = z.object({
  none: z.literal(0),
  motor: z.number().int().min(0).max(1_000_000),
  mobil: z.number().int().min(0).max(1_000_000),
  bus: z.number().int().min(0).max(1_000_000),
});

export const pricingSchema = z.object({
  ticketPricePerPerson: z.number().int().min(500).max(1_000_000),
  capacity: z.number().int().min(1).max(100_000),
  parking: parkingSchema,
});

export type PricingConfig = z.infer<typeof pricingSchema>;

export const DEFAULT_PRICING: PricingConfig = {
  ticketPricePerPerson: 5000,
  capacity: 300,
  parking: {
    none: 0,
    motor: 3000,
    mobil: 10000,
    bus: 20000,
  },
};

export const PARKING_LABELS: Record<keyof PricingConfig["parking"], string> = {
  none: "Jalan kaki",
  motor: "Motor",
  mobil: "Mobil",
  bus: "Bus",
};

export async function getPricing(): Promise<PricingConfig> {
  const setting = await db.setting.findUnique({
    where: { key: "pricing" },
  });

  if (!setting || !setting.value) {
    return DEFAULT_PRICING;
  }

  const parsed = pricingSchema.safeParse(setting.value);
  if (!parsed.success) {
    return DEFAULT_PRICING;
  }

  return parsed.data;
}

export async function setPricing(data: unknown): Promise<PricingConfig> {
  const validated = pricingSchema.parse(data);

  await db.setting.upsert({
    where: { key: "pricing" },
    create: {
      key: "pricing",
      value: validated,
    },
    update: {
      value: validated,
    },
  });

  return validated;
}
