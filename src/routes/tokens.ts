import type { FastifyInstance } from "fastify";
import { createTokenRepository } from "../modules/auth/repository.js";
import { createTokenBodySchema, tokenIdSchema } from "../modules/auth/entities.js";
import { orgIdSchema } from "../modules/project-context/entities.js";
import { createRepository } from "../modules/project-context/repository.js";
import { InvalidTenantScopeError, TenantNotFoundError } from "../lib/errors.js";

const ADMIN = { config: { auth: "admin" as const } };

function parseOrThrow<T>(
  schema: { safeParse(v: unknown): { success: boolean; data?: T } },
  value: unknown,
  msg: string,
): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new InvalidTenantScopeError(msg);
  return r.data as T;
}

export function registerTokenRoutes(app: FastifyInstance, pepper: string): void {
  const tokens = () => createTokenRepository(app.db, pepper);
  const orgs = () => createRepository(app.db);

  async function requireOrg(orgId: string): Promise<void> {
    parseOrThrow(orgIdSchema, orgId, "organization id is malformed");
    if (!(await orgs().getOrganization(orgId))) throw new TenantNotFoundError();
  }

  app.post("/organizations/:orgId/tokens", ADMIN, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    await requireOrg(orgId);
    const { name } = parseOrThrow(createTokenBodySchema, req.body, "name is required");
    const { token, secret } = await tokens().createToken(orgId, name);
    reply.status(201);
    return { id: token.id, name: token.name, prefix: token.prefix, secret };
  });

  app.get("/organizations/:orgId/tokens", ADMIN, async (req) => {
    const { orgId } = req.params as { orgId: string };
    await requireOrg(orgId);
    return { tokens: await tokens().listTokens(orgId) };
  });

  app.delete("/organizations/:orgId/tokens/:tokenId", ADMIN, async (req, reply) => {
    const { orgId, tokenId } = req.params as { orgId: string; tokenId: string };
    await requireOrg(orgId);
    parseOrThrow(tokenIdSchema, tokenId, "token id is malformed");
    const revoked = await tokens().revokeToken(orgId, tokenId);
    if (!revoked) throw new TenantNotFoundError();
    reply.status(204);
    return null;
  });
}
