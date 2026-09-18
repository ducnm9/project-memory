import Fastify, { type FastifyInstance } from "fastify";
import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { registerTenantContext } from "../../src/plugins/tenant-context.js";
import { registerErrorHandler } from "../../src/plugins/error-handler.js";
import { newOrgId } from "../../src/modules/project-context/entities.js";

const orgId = newOrgId();

function buildApp(db: Db): FastifyInstance {
  const app = Fastify({ logger: false });
  app.decorate("db", db);
  registerErrorHandler(app);
  registerTenantContext(app);
  app.get("/probe", async (req) => ({ ctx: req.projectContext ?? null }));
  return app;
}

// org exists, no projects
const dbOrgOnly = () =>
  ({
    collection: (name: string) =>
      name === "organizations"
        ? { findOne: async () => ({ id: orgId, name: "a", createdAt: "", updatedAt: "" }) }
        : { findOne: async () => null },
  }) as unknown as Db;

function buildAppWithActor(db: Db, actorOrgId: string): FastifyInstance {
  const app = Fastify({ logger: false });
  app.decorate("db", db);
  registerErrorHandler(app);
  app.addHook("onRequest", async (req) => {
    (req as unknown as { actor: unknown }).actor = {
      actorId: "tok_x", organizationId: actorOrgId, type: "service",
    };
  });
  registerTenantContext(app);
  app.get("/probe", async (req) => ({ ctx: req.projectContext ?? null }));
  return app;
}

function buildAppWithActorAtPath(db: Db, actorOrgId: string): FastifyInstance {
  const app = Fastify({ logger: false });
  app.decorate("db", db);
  registerErrorHandler(app);
  app.addHook("onRequest", async (req) => {
    (req as unknown as { actor: unknown }).actor = {
      actorId: "tok_x", organizationId: actorOrgId, type: "service",
    };
  });
  registerTenantContext(app);
  app.get("/org/:orgId/probe", async (req) => ({ ctx: req.projectContext ?? null }));
  return app;
}

describe("tenant-context plugin", () => {
  it("attaches org-shared context when only org header is present", async () => {
    const app = buildApp(dbOrgOnly());
    const res = await app.inject({ method: "GET", url: "/probe", headers: { "x-organization-id": orgId } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ctx: { organizationId: orgId, projectId: null } });
    await app.close();
  });

  it("is a no-op (no context) when no org header is present", async () => {
    const app = buildApp(dbOrgOnly());
    const res = await app.inject({ method: "GET", url: "/probe" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ctx: null });
    await app.close();
  });

  it("returns 400 for a malformed org header", async () => {
    const app = buildApp(dbOrgOnly());
    const res = await app.inject({ method: "GET", url: "/probe", headers: { "x-organization-id": "bad" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("INVALID_TENANT_SCOPE");
    await app.close();
  });

  it("returns a non-leaking 404 for an unknown org", async () => {
    const missing = () =>
      ({ collection: () => ({ findOne: async () => null }) }) as unknown as Db;
    const app = buildApp(missing());
    const res = await app.inject({ method: "GET", url: "/probe", headers: { "x-organization-id": orgId } });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: { code: "TENANT_NOT_FOUND", message: "organization or project not found" } });
    await app.close();
  });
});

describe("tenant-context org enforcement", () => {
  it("allows a request whose header org matches the actor org", async () => {
    const app = buildAppWithActor(dbOrgOnly(), orgId);
    const res = await app.inject({ method: "GET", url: "/probe", headers: { "x-organization-id": orgId } });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it("rejects with 403 when the header org differs from the actor org", async () => {
    const other = newOrgId();
    const app = buildAppWithActor(dbOrgOnly(), other);
    const res = await app.inject({ method: "GET", url: "/probe", headers: { "x-organization-id": orgId } });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN_SCOPE");
    await app.close();
  });
});

describe("tenant-context path-param org enforcement", () => {
  it("rejects with 403 when the path org differs from the actor org and no header is sent", async () => {
    const other = newOrgId();
    const app = buildAppWithActorAtPath(dbOrgOnly(), other);
    const res = await app.inject({ method: "GET", url: `/org/${orgId}/probe` });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN_SCOPE");
    await app.close();
  });

  it("allows a path org matching the actor org when no header is sent", async () => {
    const app = buildAppWithActorAtPath(dbOrgOnly(), orgId);
    const res = await app.inject({ method: "GET", url: `/org/${orgId}/probe` });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it("rejects with 403 when the header matches but the path org differs", async () => {
    const other = newOrgId();
    const app = buildAppWithActorAtPath(dbOrgOnly(), orgId);
    const res = await app.inject({
      method: "GET",
      url: `/org/${other}/probe`,
      headers: { "x-organization-id": orgId },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN_SCOPE");
    await app.close();
  });
});
