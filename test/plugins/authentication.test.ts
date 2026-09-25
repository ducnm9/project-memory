import Fastify, { type FastifyInstance } from "fastify";
import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { registerAuthentication } from "../../src/plugins/authentication.js";
import { registerErrorHandler } from "../../src/plugins/error-handler.js";
import type { AppConfig } from "../../src/config/index.js";

const config = { authAdminKey: "admin-secret", authTokenPepper: "pepper" } as AppConfig;

// A token whose hash matches hashSecret("pmk_good", "pepper").
function dbWithToken(match: boolean): Db {
  return {
    collection: () => ({
      findOne: async (filter: { hashedSecret: string; revokedAt: null }) =>
        match && filter.revokedAt === null
          ? { id: "tok_x", organizationId: "org_1", name: "n", prefix: "pmk_x", hashedSecret: filter.hashedSecret, createdAt: "", revokedAt: null, role: "READER" }
          : null,
    }),
  } as unknown as Db;
}

function buildApp(db: Db): FastifyInstance {
  const app = Fastify({ logger: false });
  app.decorate("db", db);
  registerErrorHandler(app);
  registerAuthentication(app, config);
  app.get("/pub", { config: { auth: "public" } }, async () => ({ ok: true }));
  app.get("/adm", { config: { auth: "admin" } }, async () => ({ ok: true }));
  app.get("/bear", { config: { auth: "bearer" } }, async (req) => ({ actor: req.actor ?? null }));
  app.get("/def", async (req) => ({ actor: req.actor ?? null })); // no config → default bearer
  return app;
}

describe("authentication plugin", () => {
  it("public routes skip auth and set no actor", async () => {
    const app = buildApp(dbWithToken(true));
    const res = await app.inject({ method: "GET", url: "/pub" });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it("admin route rejects a missing/wrong admin key with 401", async () => {
    const app = buildApp(dbWithToken(true));
    const res = await app.inject({ method: "GET", url: "/adm", headers: { "x-admin-key": "wrong" } });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHORIZED");
    await app.close();
  });

  it("admin route accepts the correct admin key", async () => {
    const app = buildApp(dbWithToken(true));
    const res = await app.inject({ method: "GET", url: "/adm", headers: { "x-admin-key": "admin-secret" } });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it("bearer route rejects a missing token with 401", async () => {
    const app = buildApp(dbWithToken(true));
    const res = await app.inject({ method: "GET", url: "/bear" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("bearer route sets request.actor for a valid token", async () => {
    const app = buildApp(dbWithToken(true));
    const res = await app.inject({ method: "GET", url: "/bear", headers: { authorization: "Bearer pmk_good" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().actor).toEqual({ actorId: "tok_x", organizationId: "org_1", type: "service", role: "READER" });
    await app.close();
  });

  it("bearer route rejects an unknown token with 401", async () => {
    const app = buildApp(dbWithToken(false));
    const res = await app.inject({ method: "GET", url: "/bear", headers: { authorization: "Bearer pmk_bad" } });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("defaults to bearer when no config.auth is declared", async () => {
    const app = buildApp(dbWithToken(true));
    const res = await app.inject({ method: "GET", url: "/def" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});
