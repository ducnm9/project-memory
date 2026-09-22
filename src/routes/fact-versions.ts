import type { FastifyInstance, FastifyRequest } from "fastify";
import { factIdSchema } from "../modules/knowledge-core/fact-entities.js";
import type { Fact } from "../modules/knowledge-core/fact-entities.js";
import { createFactStore } from "../modules/knowledge-core/fact-repository.js";
import { createFactVersionStore } from "../modules/knowledge-core/fact-version-repository.js";
import {
  FactNotFoundError,
  InvalidTenantScopeError,
  UnauthorizedError,
  ValidationError,
} from "../lib/errors.js";
import type { ProjectContext } from "../modules/project-context/context.js";

const DIFF_EXCLUDE = new Set<string>(["version", "updatedAt"]);

function diffSnapshots(a: Fact, b: Fact): Record<string, { from: unknown; to: unknown }> {
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

function assertFactId(id: string): void {
  if (!factIdSchema.safeParse(id).success) throw new ValidationError("fact id is malformed");
}

function parseVersion(raw: string): number {
  const v = Number(raw);
  if (!Number.isInteger(v) || v < 1) throw new ValidationError("version must be an integer >= 1");
  return v;
}

export function registerFactVersionRoutes(app: FastifyInstance): void {
  const BEARER = { config: { auth: "bearer" as const } };
  const store = () => createFactStore(app.db);
  const vStore = () => createFactVersionStore(app.db);

  app.get("/facts/:id/versions", BEARER, async (req) => {
    requireActor(req);
    const ctx = context(req);
    const { id } = req.params as { id: string };
    assertFactId(id);

    const fact = await store().findById(ctx.organizationId, id);
    if (!fact) throw new FactNotFoundError();

    return { versions: await vStore().listByFact(ctx.organizationId, id) };
  });

  app.get("/facts/:id/versions/:v", BEARER, async (req) => {
    requireActor(req);
    const ctx = context(req);
    const { id, v } = req.params as { id: string; v: string };
    assertFactId(id);
    const vNum = parseVersion(v);

    const fact = await store().findById(ctx.organizationId, id);
    if (!fact) throw new FactNotFoundError();

    const version = await vStore().findByVersion(ctx.organizationId, id, vNum);
    if (!version) throw new FactNotFoundError("version not found");
    return version;
  });

  app.get("/facts/:id/versions/:from/diff/:to", BEARER, async (req) => {
    requireActor(req);
    const ctx = context(req);
    const { id, from, to } = req.params as { id: string; from: string; to: string };
    assertFactId(id);
    const fromNum = parseVersion(from);
    const toNum = parseVersion(to);

    const fact = await store().findById(ctx.organizationId, id);
    if (!fact) throw new FactNotFoundError();

    const [vFrom, vTo] = await Promise.all([
      vStore().findByVersion(ctx.organizationId, id, fromNum),
      vStore().findByVersion(ctx.organizationId, id, toNum),
    ]);
    if (!vFrom || !vTo) throw new FactNotFoundError("one or both versions not found");

    return { from: fromNum, to: toNum, changes: diffSnapshots(vFrom.snapshot, vTo.snapshot) };
  });
}
