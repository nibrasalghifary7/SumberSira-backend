// Harga tiket masuk: Rp5.000 per orang (usia 3 tahun ke atas, balita gratis) ditambah biaya parkir.
export const CAPACITY = 300;
export const TICKET_PRICE = 5000;

export type ParkingType = "none" | "motor" | "mobil" | "bus";
export const PARKING_PRICE: Record<ParkingType, number> = { none: 0, motor: 3000, mobil: 10000, bus: 20000 };

export const ticketTotal = (adults: number, parking: ParkingType): number => adults * TICKET_PRICE + PARKING_PRICE[parking];
