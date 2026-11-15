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
        throw new Error(`Midtrans charge gagal with status ${res.status}`);
      }

      const transactionId = data.transaction_id;
      const qrString = data.qr_string;

      let qrUrl: string | undefined = undefined;
      if (Array.isArray(data.actions)) {
        const qrAction = data.actions.find(
          (a: any) => typeof a.name === "string" && a.name.startsWith("generate-qr-code")
        );
        if (qrAction && qrAction.url) {
          qrUrl = qrAction.url;
        }
      }

      let expiresAt: Date;
      if (data.expiry_time) {
        expiresAt = new Date(data.expiry_time);
      } else {
        expiresAt = new Date(Date.now() + 15 * 60 * 1000);
      }

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

      return {
        status: mapMidtransStatus(data.transaction_status, data.fraud_status),
        raw: data,
      };
    } finally {
      clearTimeout(timeout);
    }
  },
};

export function mapMidtransStatus(
  transactionStatus?: string,
  fraudStatus?: string
): "pending" | "paid" | "failed" | "expired" | "cancelled" {
  switch (transactionStatus) {
    case "settlement":
      return "paid";
    case "capture":
      return fraudStatus === "accept" ? "paid" : "pending";
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
