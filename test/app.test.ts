import { describe, expect, it } from "vitest";
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
  });
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
    app.get("/boom", async () => {
      throw new Error("should not leak");
    });
    const res = await app.inject({ method: "GET", url: "/boom" });
    expect(res.statusCode).toBe(500);
    expect(res.json().error.code).toBe("INTERNAL_ERROR");
    await app.close();
  });
});
