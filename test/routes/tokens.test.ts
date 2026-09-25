import Fastify, { type FastifyInstance } from "fastify";
import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { registerTokenRoutes } from "../../src/routes/tokens.js";
import { registerErrorHandler } from "../../src/plugins/error-handler.js";
import { newOrgId } from "../../src/modules/project-context/entities.js";

const orgId = newOrgId();

function buildApp(handlers: Record<string, Record<string, unknown>>): FastifyInstance {
  const app = Fastify({ logger: false });
  app.decorate("db", { collection: (n: string) => handlers[n] } as unknown as Db);
  registerErrorHandler(app);
  registerTokenRoutes(app, "pepper");
  return app;
}

const orgExists = { findOne: vi.fn().mockResolvedValue({ id: orgId, name: "a", createdAt: "", updatedAt: "" }) };

describe("POST /organizations/:orgId/tokens", () => {
  it("creates a token and returns the plaintext secret once", async () => {
    const app = buildApp({
      organizations: orgExists,
      service_tokens: { insertOne: vi.fn().mockResolvedValue({}) },
    });
    const res = await app.inject({ method: "POST", url: `/organizations/${orgId}/tokens`, payload: { name: "kiro-ci" } });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.secret).toMatch(/^pmk_/);
    expect(body.prefix).toMatch(/^pmk_/);
    expect(body.name).toBe("kiro-ci");
    expect(body.hashedSecret).toBeUndefined();
    await app.close();
  });

  it("returns 404 when the org does not exist", async () => {
    const app = buildApp({
      organizations: { findOne: vi.fn().mockResolvedValue(null) },
      service_tokens: { insertOne: vi.fn() },
    });
    const res = await app.inject({ method: "POST", url: `/organizations/${orgId}/tokens`, payload: { name: "x" } });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("returns 400 for an empty name", async () => {
    const app = buildApp({ organizations: orgExists, service_tokens: { insertOne: vi.fn() } });
    const res = await app.inject({ method: "POST", url: `/organizations/${orgId}/tokens`, payload: { name: " " } });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("accepts role and forwards it to createToken", async () => {
    const insertOne = vi.fn().mockResolvedValue({});
    const app = buildApp({ organizations: orgExists, service_tokens: { insertOne } });
    const res = await app.inject({ method: "POST", url: `/organizations/${orgId}/tokens`, payload: { name: "ci", role: "ADMIN" } });
    expect(res.statusCode).toBe(201);
    const inserted = insertOne.mock.calls[0][0];
    expect(inserted.role).toBe("ADMIN");
    await app.close();
  });

  it("defaults role to READER when omitted", async () => {
    const insertOne = vi.fn().mockResolvedValue({});
    const app = buildApp({ organizations: orgExists, service_tokens: { insertOne } });
    const res = await app.inject({ method: "POST", url: `/organizations/${orgId}/tokens`, payload: { name: "ci" } });
    expect(res.statusCode).toBe(201);
    const inserted = insertOne.mock.calls[0][0];
    expect(inserted.role).toBe("READER");
    await app.close();
  });

  it("returns 400 for an invalid role value", async () => {
    const app = buildApp({ organizations: orgExists, service_tokens: { insertOne: vi.fn() } });
    const res = await app.inject({ method: "POST", url: `/organizations/${orgId}/tokens`, payload: { name: "ci", role: "SUPERUSER" } });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

describe("GET /organizations/:orgId/tokens", () => {
  it("lists tokens without secrets", async () => {
    const toArray = vi.fn().mockResolvedValue([{ id: "tok_x", organizationId: orgId, name: "n", prefix: "pmk_x", createdAt: "", revokedAt: null }]);
    const app = buildApp({ organizations: orgExists, service_tokens: { find: vi.fn().mockReturnValue({ toArray }) } });
    const res = await app.inject({ method: "GET", url: `/organizations/${orgId}/tokens` });
    expect(res.statusCode).toBe(200);
    expect(res.json().tokens[0].hashedSecret).toBeUndefined();
    await app.close();
  });
});

describe("DELETE /organizations/:orgId/tokens/:tokenId", () => {
  it("returns 204 when a token is revoked", async () => {
    const app = buildApp({ organizations: orgExists, service_tokens: { updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }) } });
    const res = await app.inject({ method: "DELETE", url: `/organizations/${orgId}/tokens/tok_01ARZ3NDEKTSV4RRFFQ69G5FAV` });
    expect(res.statusCode).toBe(204);
    await app.close();
  });

  it("returns 404 when nothing was revoked", async () => {
    const app = buildApp({ organizations: orgExists, service_tokens: { updateOne: vi.fn().mockResolvedValue({ matchedCount: 0 }) } });
    const res = await app.inject({ method: "DELETE", url: `/organizations/${orgId}/tokens/tok_01ARZ3NDEKTSV4RRFFQ69G5FAV` });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("returns 400 for a malformed token id", async () => {
    const app = buildApp({ organizations: orgExists, service_tokens: { updateOne: vi.fn() } });
    const res = await app.inject({ method: "DELETE", url: `/organizations/${orgId}/tokens/bad` });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
