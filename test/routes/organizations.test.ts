import Fastify, { type FastifyInstance } from "fastify";
import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { registerOrganizationRoutes } from "../../src/routes/organizations.js";
import { registerErrorHandler } from "../../src/plugins/error-handler.js";
import { newOrgId } from "../../src/modules/project-context/entities.js";

const orgId = newOrgId();

function buildApp(handlers: Record<string, Record<string, unknown>>): FastifyInstance {
  const app = Fastify({ logger: false });
  const db = { collection: (n: string) => handlers[n] } as unknown as Db;
  app.decorate("db", db);
  registerErrorHandler(app);
  registerOrganizationRoutes(app);
  return app;
}

describe("POST /organizations", () => {
  it("creates and returns 201 with a generated id", async () => {
    const insertOne = vi.fn().mockResolvedValue({});
    const app = buildApp({ organizations: { insertOne } });
    const res = await app.inject({ method: "POST", url: "/organizations", payload: { name: "Acme" } });
    expect(res.statusCode).toBe(201);
    expect(res.json().id).toMatch(/^org_/);
    expect(res.json().name).toBe("Acme");
    await app.close();
  });

  it("rejects an empty name with 400", async () => {
    const app = buildApp({ organizations: { insertOne: vi.fn() } });
    const res = await app.inject({ method: "POST", url: "/organizations", payload: { name: " " } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("INVALID_TENANT_SCOPE");
    await app.close();
  });
});

describe("GET /organizations/:orgId", () => {
  it("returns 404 (non-leaking) for an unknown org", async () => {
    const app = buildApp({ organizations: { findOne: vi.fn().mockResolvedValue(null) } });
    const res = await app.inject({ method: "GET", url: `/organizations/${orgId}` });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: { code: "TENANT_NOT_FOUND", message: "organization or project not found" } });
    await app.close();
  });

  it("returns 400 for a malformed org id in the path", async () => {
    const app = buildApp({ organizations: { findOne: vi.fn() } });
    const res = await app.inject({ method: "GET", url: "/organizations/bad" });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

describe("POST /organizations/:orgId/projects", () => {
  it("returns 404 when the parent org is missing", async () => {
    const app = buildApp({
      organizations: { findOne: vi.fn().mockResolvedValue(null) },
      projects: { insertOne: vi.fn() },
    });
    const res = await app.inject({ method: "POST", url: `/organizations/${orgId}/projects`, payload: { name: "p" } });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("creates a project (201) under an existing org", async () => {
    const app = buildApp({
      organizations: { findOne: vi.fn().mockResolvedValue({ id: orgId, name: "a", createdAt: "", updatedAt: "" }) },
      projects: { insertOne: vi.fn().mockResolvedValue({}) },
    });
    const res = await app.inject({ method: "POST", url: `/organizations/${orgId}/projects`, payload: { name: "p" } });
    expect(res.statusCode).toBe(201);
    expect(res.json().id).toMatch(/^proj_/);
    expect(res.json().organizationId).toBe(orgId);
    await app.close();
  });
});
