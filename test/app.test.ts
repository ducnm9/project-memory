import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config/index.js";

function fakeDb(): Db {
  return { command: async () => ({ ok: 1 }) } as unknown as Db;
}

function testConfig() {
  return loadConfig({
    LOG_LEVEL: "silent",
    MONGODB_URI: "mongodb://localhost:27017",
    MONGODB_DB_NAME: "pm",
    AUTH_ADMIN_KEY: "admin-secret",
    AUTH_TOKEN_PEPPER: "pepper",
  });
}

function authDb(): Db {
  return {
    command: async () => ({ ok: 1 }),
    collection: () => ({
      find: () => ({ toArray: async () => [] }),
      findOne: async () => null,
    }),
  } as unknown as Db;
}

function buildTestApp() {
  return buildApp({ config: testConfig(), db: authDb() });
}

describe("buildApp", () => {
  it("assembles an app that serves health routes", async () => {
    const app = buildApp({ config: testConfig(), db: fakeDb() });
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
    await app.close();
  });

  it("decorates the instance with the db", async () => {
    const db = fakeDb();
    const app = buildApp({ config: testConfig(), db });
    expect(app.db).toBe(db);
    await app.close();
  });

  it("wires the error handler for unknown errors", async () => {
    const app = buildApp({ config: testConfig(), db: fakeDb() });
    app.get("/boom", { config: { auth: "public" } }, async () => {
      throw new Error("should not leak");
    });
    const res = await app.inject({ method: "GET", url: "/boom" });
    expect(res.statusCode).toBe(500);
    expect(res.json().error.code).toBe("INTERNAL_ERROR");
    await app.close();
  });
});

describe("buildApp tenancy wiring", () => {
  it("exposes POST /organizations", async () => {
    const insertOne = vi.fn().mockResolvedValue({});
    const db = {
      command: async () => ({ ok: 1 }),
      collection: () => ({ insertOne }),
    } as unknown as Db;
    const app = buildApp({ config: testConfig(), db });
    const res = await app.inject({
      method: "POST",
      url: "/organizations",
      headers: { "x-admin-key": "admin-secret" },
      payload: { name: "Acme" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().id).toMatch(/^org_/);
    await app.close();
  });

  it("serves /health without credentials (public)", async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it("rejects GET /organizations without a bearer token (401)", async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: "GET", url: "/organizations" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("rejects POST /organizations without the admin key (401)", async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: "POST", url: "/organizations", payload: { name: "Acme" } });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});
