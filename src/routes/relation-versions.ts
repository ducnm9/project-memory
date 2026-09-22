import type { FastifyInstance, FastifyRequest } from "fastify";
import { relationIdSchema } from "../modules/knowledge-core/relation-entities.js";
import type { Relation } from "../modules/knowledge-core/relation-entities.js";
import { createRelationStore } from "../modules/knowledge-core/relation-repository.js";
import { createRelationVersionStore } from "../modules/knowledge-core/relation-version-repository.js";
import {
  InvalidTenantScopeError,
  RelationNotFoundError,
  UnauthorizedError,
  ValidationError,
} from "../lib/errors.js";
import type { ProjectContext } from "../modules/project-context/context.js";

const DIFF_EXCLUDE = new Set<string>(["version", "updatedAt"]);

function diffSnapshots(a: Relation, b: Relation): Record<string, { from: unknown; to: unknown }> {
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

function assertRelationId(id: string): void {
  if (!relationIdSchema.safeParse(id).success) throw new ValidationError("relation id is malformed");
}

function parseVersion(raw: string): number {
  const v = Number(raw);
  if (!Number.isInteger(v) || v < 1) throw new ValidationError("version must be an integer >= 1");
  return v;
}

export function registerRelationVersionRoutes(app: FastifyInstance): void {
  const BEARER = { config: { auth: "bearer" as const } };
  const store = () => createRelationStore(app.db);
  const vStore = () => createRelationVersionStore(app.db);

  app.get("/relations/:id/versions", BEARER, async (req) => {
    requireActor(req);
    const ctx = context(req);
    const { id } = req.params as { id: string };
    assertRelationId(id);

    const relation = await store().findById(ctx.organizationId, id);
    if (!relation) throw new RelationNotFoundError();

    return { versions: await vStore().listByRelation(ctx.organizationId, id) };
  });

  app.get("/relations/:id/versions/:v", BEARER, async (req) => {
    requireActor(req);
    const ctx = context(req);
    const { id, v } = req.params as { id: string; v: string };
    assertRelationId(id);
    const vNum = parseVersion(v);

    const relation = await store().findById(ctx.organizationId, id);
    if (!relation) throw new RelationNotFoundError();

    const version = await vStore().findByVersion(ctx.organizationId, id, vNum);
    if (!version) throw new RelationNotFoundError("version not found");
    return version;
  });

  app.get("/relations/:id/versions/:from/diff/:to", BEARER, async (req) => {
    requireActor(req);
    const ctx = context(req);
    const { id, from, to } = req.params as { id: string; from: string; to: string };
    assertRelationId(id);
    const fromNum = parseVersion(from);
    const toNum = parseVersion(to);

    const relation = await store().findById(ctx.organizationId, id);
    if (!relation) throw new RelationNotFoundError();

    const [vFrom, vTo] = await Promise.all([
      vStore().findByVersion(ctx.organizationId, id, fromNum),
      vStore().findByVersion(ctx.organizationId, id, toNum),
    ]);
    if (!vFrom || !vTo) throw new RelationNotFoundError("one or both versions not found");

    return { from: fromNum, to: toNum, changes: diffSnapshots(vFrom.snapshot, vTo.snapshot) };
  });
}
