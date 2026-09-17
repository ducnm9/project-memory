import Fastify, { type FastifyInstance } from "fastify";
import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { registerHealthRoutes } from "../../src/routes/health.js";

function buildTestApp(db: Db): FastifyInstance {
  const app = Fastify({ logger: false });
  app.decorate("db", db);
  registerHealthRoutes(app);
  return app;
}

const okDb = () => ({ command: async () => ({ ok: 1 }) }) as unknown as Db;
const badDb = () =>
  ({
    command: async () => {
      throw new Error("unreachable");
    },
  }) as unknown as Db;

describe("health routes", () => {
  it("GET /health returns 200 ok", async () => {
    const app = buildTestApp(okDb());
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
    await app.close();
  });

  it("GET /ready returns 200 ready when the db ping succeeds", async () => {
    const app = buildTestApp(okDb());
    const res = await app.inject({ method: "GET", url: "/ready" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ready" });
    await app.close();
  });

  it("GET /ready returns 503 not ready when the db ping fails", async () => {
    const app = buildTestApp(badDb());
    const res = await app.inject({ method: "GET", url: "/ready" });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: "not ready" });
    await app.close();
  });
});
