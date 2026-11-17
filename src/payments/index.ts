import { config } from "../config.js";

export interface CreateQrisItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
}

export interface CreateQrisInput {
  orderId: string;
  amount: number;
  customerName: string;
  customerPhone: string;
  items: CreateQrisItem[];
}

export interface CreateQrisOutput {
  providerTransactionId?: string;
  qrString?: string;
  qrUrl?: string;
  expiresAt: Date;
}

export interface PaymentProvider {
  name: "simulation" | "midtrans";
  createQris(input: CreateQrisInput): Promise<CreateQrisOutput>;
  getStatus(orderId: string): Promise<{
    status: "pending" | "paid" | "failed" | "expired" | "cancelled";
    raw?: unknown;
  }>;
}

export const simulationProvider: PaymentProvider = {
  name: "simulation",
  async createQris(input: CreateQrisInput): Promise<CreateQrisOutput> {
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // sekarang + 15 menit
    return {
      providerTransactionId: `SIM-TX-${Date.now()}`,
      qrString: `QRIS-SIM:${input.orderId}:${input.amount}`,
      qrUrl: undefined,
      expiresAt,
    };
  },
  async getStatus(_orderId: string) {
    return { status: "pending" as const };
  },
};

export const midtransProvider: PaymentProvider = {
  name: "midtrans",
  async createQris(input: CreateQrisInput): Promise<CreateQrisOutput> {
    const baseUrl =
      config.MIDTRANS_ENV === "production"
        ? "https://api.midtrans.com"
        : "https://api.sandbox.midtrans.com";

    const authHeader = `Basic ${Buffer.from(`${config.MIDTRANS_SERVER_KEY}:`).toString("base64")}`;

    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: authHeader,
    };

    if (config.PUBLIC_BASE_URL) {
      headers["X-Override-Notification"] = `${config.PUBLIC_BASE_URL}/payments/midtrans/notification`;
    }

    const payload = {
      payment_type: "qris",
      transaction_details: {
        order_id: input.orderId,
        gross_amount: input.amount,
      },
      item_details: input.items.map((it) => ({
        id: it.id,
        price: it.price,
        quantity: it.quantity,
        name: it.name.slice(0, 50),
      })),
      customer_details: {
        first_name: input.customerName,
        phone: input.customerPhone,
      },
      qris: {
        acquirer: "gopay",
      },
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      const res = await fetch(`${baseUrl}/v2/charge`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const data = (await res.json().catch(() => ({}))) as any;

      if (!res.ok || (data.status_code !== "201" && data.status_code !== 201)) {
        throw new Error(
          `Midtrans charge gagal (HTTP ${res.status}, status_code ${data.status_code ?? "-"})`
        );
      }

      const transactionId = data.transaction_id;

      const qrString =
        typeof data.qr_string === "string" && data.qr_string.length > 0
          ? data.qr_string
          : undefined;

      let qrUrl: string | undefined = undefined;
      if (Array.isArray(data.actions)) {
        const qrAction = data.actions.find(
          (a: any) => typeof a.name === "string" && a.name.startsWith("generate-qr-code")
        );
        if (qrAction && typeof qrAction.url === "string" && qrAction.url) {
          qrUrl = qrAction.url;
        }
      }

      // Tanpa QR, pembeli tidak bisa membayar. Perlakukan sebagai galat provider
      // agar route membalas PAYMENT_PROVIDER_ERROR, bukan Payment tanpa QR.
      if (!qrString && !qrUrl) {
        throw new Error("Midtrans tidak mengembalikan qr_string maupun URL QR");
      }

      const expiresAt =
        parseMidtransExpiry(data.expiry_time) ?? new Date(Date.now() + 15 * 60 * 1000);

      return {
        providerTransactionId: transactionId,
        qrString,
        qrUrl,
        expiresAt,
      };
    } finally {
      clearTimeout(timeout);
    }
  },

  async getStatus(orderId: string) {
    const baseUrl =
      config.MIDTRANS_ENV === "production"
        ? "https://api.midtrans.com"
        : "https://api.sandbox.midtrans.com";

    const authHeader = `Basic ${Buffer.from(`${config.MIDTRANS_SERVER_KEY}:`).toString("base64")}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      const res = await fetch(`${baseUrl}/v2/${encodeURIComponent(orderId)}/status`, {
        headers: {
          Accept: "application/json",
          Authorization: authHeader,
        },
        signal: controller.signal,
      });

      const data = (await res.json().catch(() => ({}))) as any;

      if (!res.ok || (data.status_code !== undefined && String(data.status_code) !== "200")) {
        throw new Error(
          `Midtrans status gagal (HTTP ${res.status}, status_code ${data.status_code ?? "-"})`
        );
      }

      return {
        status: mapMidtransStatus(data.transaction_status, data.fraud_status),
        raw: data,
      };
    } finally {
      clearTimeout(timeout);
    }
  },
};

/**
 * Midtrans mengirim expiry_time sebagai "YYYY-MM-DD HH:mm:ss" dalam WIB (UTC+7),
 * bukan ISO 8601 dengan zona waktu. Parse eksplisit agar tidak bergeser mengikuti
 * zona waktu server.
 */
export function parseMidtransExpiry(value: unknown): Date | null {
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(trimmed)
    ? `${trimmed.replace(" ", "T")}+07:00`
    : trimmed;

  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function mapMidtransStatus(
  transactionStatus?: string,
  fraudStatus?: string
): "pending" | "paid" | "failed" | "expired" | "cancelled" {
  switch (transactionStatus) {
    case "settlement":
      return "paid";
    case "capture":
      // Capture normal langsung lunas; challenge/deny dari fraud detection
      // belum boleh dianggap lunas.
      if (fraudStatus === "deny") return "failed";
      if (fraudStatus === "challenge") return "pending";
      return "paid";
    case "pending":
      return "pending";
    case "expire":
      return "expired";
    case "cancel":
      return "cancelled";
    case "deny":
    case "failure":
      return "failed";
    case "refund":
    case "partial_refund":
    default:
      return "pending";
  }
}

export function providerFor(mode: "simulation" | "midtrans"): PaymentProvider {
  if (mode === "simulation") {
    return simulationProvider;
  }
  if (mode === "midtrans") {
    return midtransProvider;
  }
  throw new Error(`Penyedia pembayaran ${mode} tidak dikenal.`);
}
