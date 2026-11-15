import type { Server } from "node:http";
import { app } from "../../src/app.js";
import { db } from "../../src/lib/db.js";

// Pastikan mode simulasi saat smoke test
process.env.PAYMENT_MODE = "simulation";

export interface TestContext {
  server: Server;
  baseUrl: string;
  close: () => Promise<void>;
}

export async function startTestServer(): Promise<TestContext> {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr !== null ? addr.port : 0;
      const baseUrl = `http://localhost:${port}`;
      resolve({
        server,
        baseUrl,
        close: async () => {
          await new Promise<void>((res) => server.close(() => res()));
          await db.$disconnect();
        },
      });
    });
  });
}

export async function request(
  baseUrl: string,
  path: string,
  options: RequestInit = {}
): Promise<{ status: number; headers: Headers; body: any }> {
  const url = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  const res = await fetch(url, options);
  const text = await res.text();
  let body: any = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return {
    status: res.status,
    headers: res.headers,
    body,
  };
}

export async function loginAs(
  baseUrl: string,
  role: "admin" | "petugas"
): Promise<{ cookie: string }> {
  const credentials =
    role === "admin"
      ? { email: "admin@sumbersira.id", password: "sumbersira" }
      : { email: "petugas@sumbersira.id", password: "petugas123" };

  const res = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(credentials),
  });

  const cookie = res.headers.get("set-cookie") || "";
  return { cookie };
}

export function check(name: string, condition: boolean, details?: string) {
  if (condition) {
    console.log(`  [LULUS] ${name}`);
  } else {
    console.error(`  [GAGAL] ${name} ${details ? `(${details})` : ""}`);
    throw new Error(`Pemeriksaan gagal: ${name}`);
  }
}
