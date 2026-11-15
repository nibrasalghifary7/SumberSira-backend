export const BOOKING_SLOTS = [
  "08-09",
  "09-10",
  "10-11",
  "11-12",
  "12-13",
  "13-14",
  "14-15",
  "15-16",
] as const;

export const BOOKING_SLOT_ITEMS = BOOKING_SLOTS.map((slot) => {
  const [start, end] = slot.split("-");
  return {
    id: slot,
    label: `${start}.00 - ${end}.00`,
  };
});

export const HOURLY_FORECAST = [
  { hour: "08", count: 30 },
  { hour: "09", count: 60 },
  { hour: "10", count: 135 },
  { hour: "11", count: 225 },
  { hour: "12", count: 285 },
  { hour: "13", count: 270 },
  { hour: "14", count: 240 },
  { hour: "15", count: 120 },
  { hour: "16", count: 45 },
];

export function getCrowdLabel(percent: number): "Sepi" | "Sedang" | "Ramai" {
  if (percent < 40) return "Sepi";
  if (percent <= 75) return "Sedang";
  return "Ramai";
}
