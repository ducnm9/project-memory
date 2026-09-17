import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { registerErrorHandler } from "../../src/plugins/error-handler.js";
import { ValidationError } from "../../src/lib/errors.js";

function buildTestApp() {
  const app = Fastify();
  registerErrorHandler(app);
  app.get("/known", async () => {
    throw new ValidationError("bad field");
  });
  app.get("/unknown", async () => {
    throw new Error("secret internals");
  });
  app.get(
    "/validated",
    { schema: { querystring: { type: "object", required: ["n"], properties: { n: { type: "integer" } } } } },
    async () => ({ ok: true }),
  );
  return app;
}

describe("registerErrorHandler", () => {
  it("maps AppError to its status and shape", async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: "GET", url: "/known" });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: { code: "VALIDATION_ERROR", message: "bad field" } });
    await app.close();
  });

  it("maps unknown errors to a generic 500 without leaking internals", async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: "GET", url: "/unknown" });
    expect(res.statusCode).toBe(500);
    const body = res.json();
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(body.error.message).not.toContain("secret internals");
    await app.close();
  });

  it("maps a native Fastify 400 to the client-error shape", async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: "GET", url: "/validated" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
    await app.close();
  });
});
