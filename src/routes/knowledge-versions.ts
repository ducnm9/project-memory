import type { FastifyInstance, FastifyRequest } from "fastify";
import { knowledgeIdSchema } from "../modules/knowledge-core/entities.js";
import type { KnowledgeItem } from "../modules/knowledge-core/entities.js";
import { createKnowledgeItemStore } from "../modules/knowledge-core/repository.js";
import { createKnowledgeVersionStore } from "../modules/knowledge-core/version-repository.js";
import {
  InvalidTenantScopeError,
  KnowledgeNotFoundError,
  UnauthorizedError,
  ValidationError,
} from "../lib/errors.js";
import type { ProjectContext } from "../modules/project-context/context.js";

const DIFF_EXCLUDE = new Set<string>(["version", "updatedAt"]);

function diffSnapshots(
  a: KnowledgeItem,
  b: KnowledgeItem,
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  const from = a as unknown as Record<string, unknown>;
  const to = b as unknown as Record<string, unknown>;
  const keys = new Set([...Object.keys(from), ...Object.keys(to)]);
  for (const key of keys) {
    if (DIFF_EXCLUDE.has(key)) continue;
    if (JSON.stringify(from[key]) !== JSON.stringify(to[key])) {
      changes[key] = { from: from[key], to: to[key] };
    }
  }
  return changes;
}

function context(req: FastifyRequest): ProjectContext {
  const ctx = req.projectContext;
  if (!ctx) throw new InvalidTenantScopeError("x-organization-id is missing or malformed");
  return ctx;
}

function requireActor(req: FastifyRequest): void {
  if (!req.actor) throw new UnauthorizedError("missing credentials");
}

function assertKnowledgeId(id: string): void {
  if (!knowledgeIdSchema.safeParse(id).success) {
    throw new ValidationError("knowledge id is malformed");
  }
}

function parseVersion(raw: string): number {
  const v = Number(raw);
  if (!Number.isInteger(v) || v < 1) {
    throw new ValidationError("version must be an integer >= 1");
  }
  return v;
}

export function registerKnowledgeVersionRoutes(app: FastifyInstance): void {
  const BEARER = { config: { auth: "bearer" as const } };
  const store = () => createKnowledgeItemStore(app.db);
  const vStore = () => createKnowledgeVersionStore(app.db);

  app.get("/knowledge/:id/versions", BEARER, async (req) => {
    requireActor(req);
    const ctx = context(req);
    const { id } = req.params as { id: string };
    assertKnowledgeId(id);

    const item = await store().findById(ctx.organizationId, id);
    if (!item) throw new KnowledgeNotFoundError();

    return { versions: await vStore().listByKnowledge(ctx.organizationId, id) };
  });

  app.get("/knowledge/:id/versions/:v", BEARER, async (req) => {
    requireActor(req);
    const ctx = context(req);
    const { id, v } = req.params as { id: string; v: string };
    assertKnowledgeId(id);
    const vNum = parseVersion(v);

    const item = await store().findById(ctx.organizationId, id);
    if (!item) throw new KnowledgeNotFoundError();

    const version = await vStore().findByVersion(ctx.organizationId, id, vNum);
    if (!version) throw new KnowledgeNotFoundError("version not found");
    return version;
  });

  app.get("/knowledge/:id/versions/:from/diff/:to", BEARER, async (req) => {
    requireActor(req);
    const ctx = context(req);
    const { id, from, to } = req.params as { id: string; from: string; to: string };
    assertKnowledgeId(id);
    const fromNum = parseVersion(from);
    const toNum = parseVersion(to);

    const item = await store().findById(ctx.organizationId, id);
    if (!item) throw new KnowledgeNotFoundError();

    const [vFrom, vTo] = await Promise.all([
      vStore().findByVersion(ctx.organizationId, id, fromNum),
      vStore().findByVersion(ctx.organizationId, id, toNum),
    ]);
    if (!vFrom || !vTo) throw new KnowledgeNotFoundError("one or both versions not found");

    return {
      from: fromNum,
      to: toNum,
      changes: diffSnapshots(vFrom.snapshot, vTo.snapshot),
    };
  });
}
