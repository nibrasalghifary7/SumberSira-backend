import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import express, { type Express } from "express";

// Environment test diset SEBELUM modul aplikasi dimuat. DATABASE_URL sengaja
// dummy: seluruh tes di bawah tidak boleh menyentuh database sungguhan.
process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";
process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5432/test";
process.env.PAYMENT_MODE = "simulation";
process.env.STORAGE_DRIVER = "local";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface TestServer {
  server: Server;
  baseUrl: string;
}

async function startServer(app: Express): Promise<TestServer> {
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

async function stopServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve()))
  );
}

async function call(
  baseUrl: string,
  path: string,
  init: RequestInit = {}
): Promise<{ status: number; headers: Headers; body: any; text: string }> {
  const res = await fetch(`${baseUrl}${path}`, init);
  const text = await res.text();
  let body: any = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, headers: res.headers, body, text };
}

function jsonPost(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

describe("middleware keamanan dan request ID", () => {
  let api: TestServer;

  before(async () => {
    const { app } = await import("../src/app.js");
    api = await startServer(app);
  });

  after(async () => {
    await stopServer(api.server);
  });

  it("GET /health/live membalas 200 dengan header keamanan dan request ID", async () => {
    const res = await call(api.baseUrl, "/health/live");

    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.equal(res.headers.get("x-frame-options"), "SAMEORIGIN");
    assert.match(res.headers.get("x-request-id") ?? "", UUID_PATTERN);
    assert.equal(res.headers.get("x-powered-by"), null);
  });

  it("memakai kembali X-Request-Id dari klien bila formatnya wajar", async () => {
    const res = await call(api.baseUrl, "/health/live", {
      headers: { "X-Request-Id": "smoke-request-0001" },
    });

    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-request-id"), "smoke-request-0001");
  });

  it("mengganti X-Request-Id yang tidak wajar dengan ID baru", async () => {
    const res = await call(api.baseUrl, "/health/live", {
      headers: { "X-Request-Id": "bukan id yang sah!!!" },
    });

    const id = res.headers.get("x-request-id") ?? "";
    assert.notEqual(id, "bukan id yang sah!!!");
    assert.match(id, UUID_PATTERN);
  });
});

describe("format galat API", () => {
  let api: TestServer;

  before(async () => {
    const { app } = await import("../src/app.js");
    api = await startServer(app);
  });

  after(async () => {
    await stopServer(api.server);
  });

  it("route yang tidak ada menghasilkan 404, bukan 500", async () => {
    const res = await call(api.baseUrl, "/route-yang-tidak-ada");

    assert.equal(res.status, 404);
    assert.equal(res.body.error, "NOT_FOUND");
    assert.equal(res.body.requestId, res.headers.get("x-request-id"));
  });

  it("body JSON rusak menghasilkan 4xx VALIDATION", async () => {
    const res = await call(api.baseUrl, "/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{ bukan json",
    });

    assert.equal(res.status, 400);
    assert.equal(res.body.error, "VALIDATION");
  });

  it("input tidak valid menghasilkan 400 VALIDATION dengan request ID", async () => {
    const res = await call(
      api.baseUrl,
      "/auth/login",
      jsonPost({ email: "bukan-email", password: "" })
    );

    assert.equal(res.status, 400);
    assert.equal(res.body.error, "VALIDATION");
    assert.equal(res.body.requestId, res.headers.get("x-request-id"));
  });

  it("endpoint privat tanpa sesi menghasilkan 401", async () => {
    const res = await call(api.baseUrl, "/auth/me");

    assert.equal(res.status, 401);
    assert.equal(res.body.error, "UNAUTHENTICATED");
  });

  it("role yang tidak berhak menghasilkan 403", async () => {
    const { requestId } = await import("../src/logger.js");
    const { errorHandler } = await import("../src/lib/errors.js");
    const { requireRole } = await import("../src/middleware/auth.js");

    const app = express();
    app.use(requestId);
    app.use((_req, res, next) => {
      res.locals.user = {
        id: "u1",
        name: "Petugas Uji",
        email: "petugas@uji.test",
        role: "petugas",
        active: true,
        createdAt: new Date(),
      };
      next();
    });
    app.get("/khusus-admin", requireRole("admin"), (_req, res) => res.json({ ok: true }));
    app.use(errorHandler);

    const mini = await startServer(app);
    try {
      const res = await call(mini.baseUrl, "/khusus-admin");
      assert.equal(res.status, 403);
      assert.equal(res.body.error, "FORBIDDEN");
    } finally {
      await stopServer(mini.server);
    }
  });

  it("galat tak terduga menjadi 500 tanpa stack trace atau pesan internal", async () => {
    const { requestId } = await import("../src/logger.js");
    const { errorHandler } = await import("../src/lib/errors.js");

    const app = express();
    app.use(requestId);
    app.get("/boom", () => {
      throw new Error("rahasia internal: koneksi database putus");
    });
    app.use(errorHandler);

    const mini = await startServer(app);
    try {
      const res = await call(mini.baseUrl, "/boom");

      assert.equal(res.status, 500);
      assert.deepEqual(Object.keys(res.body).sort(), ["error", "requestId"]);
      assert.equal(res.body.error, "INTERNAL");
      assert.equal(res.body.requestId, res.headers.get("x-request-id"));
      assert.ok(!res.text.includes("rahasia internal"));
      assert.ok(!res.text.includes("stack"));
    } finally {
      await stopServer(mini.server);
    }
  });
});

describe("rate limit", () => {
  let api: TestServer;

  before(async () => {
    const { app } = await import("../src/app.js");
    api = await startServer(app);
  });

  after(async () => {
    await stopServer(api.server);
  });

  it("percobaan login berulang menghasilkan 429, bukan 500", async () => {
    const email = "rate-limit-test@smoke.test";
    let lastStatus = 0;
    let lastBody: any = null;

    // loginLimiter: maksimal 5 percobaan gagal per menit per email.
    for (let i = 0; i < 6; i += 1) {
      const res = await call(api.baseUrl, "/auth/login", jsonPost({ email }));
      lastStatus = res.status;
      lastBody = res.body;
    }

    assert.equal(lastStatus, 429);
    assert.equal(lastBody.error, "RATE_LIMITED");
    assert.ok(lastBody.requestId);
  });
});

describe("aturan kekuatan password", () => {
  it("menerima password yang memenuhi semua syarat", async () => {
    const { passwordSchema } = await import("../src/lib/validatePassword.js");
    assert.equal(passwordSchema.safeParse("Rahasia123").success, true);
  });

  it("menolak password pendek atau tanpa variasi karakter", async () => {
    const { passwordSchema } = await import("../src/lib/validatePassword.js");
    assert.equal(passwordSchema.safeParse("pendek1").success, false);
    assert.equal(passwordSchema.safeParse("rahasiabesar1").success, false);
    assert.equal(passwordSchema.safeParse("RAHASIABESAR1").success, false);
    assert.equal(passwordSchema.safeParse("RahasiaTanpaAngka").success, false);
  });
});
