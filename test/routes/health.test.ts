import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { registerHealthRoutes } from "../../src/routes/health.js";

function buildTestApp() {
  const app = Fastify();
  registerHealthRoutes(app);
  return app;
}

describe("health routes", () => {
  it("GET /health returns 200 ok", async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
    await app.close();
  });

  it("GET /ready returns 200 ready", async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: "GET", url: "/ready" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ready" });
    await app.close();
  });
});
