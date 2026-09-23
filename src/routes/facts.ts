import type { FastifyInstance, FastifyRequest } from "fastify";
import { createRepository as createProjectContextRepository } from "../modules/project-context/repository.js";
import { projectIdSchema } from "../modules/project-context/entities.js";
import type { ProjectContext } from "../modules/project-context/context.js";
import {
  createFactBodySchema,
  factIdSchema,
  factStatusSchema,
  updateFactBodySchema,
} from "../modules/knowledge-core/fact-entities.js";
import { createFactStore, type FactFilter } from "../modules/knowledge-core/fact-repository.js";
import { createFactVersionStore } from "../modules/knowledge-core/fact-version-repository.js";
import { assertFactTransition, INITIAL_FACT_STATUS } from "../modules/knowledge-core/fact-lifecycle.js";
import { sourceIdSchema } from "../modules/knowledge-core/source-entities.js";
import { createSourceStore } from "../modules/knowledge-core/source-repository.js";
import {
  FactNotFoundError,
  InvalidTenantScopeError,
  SourceNotFoundError,
  TenantNotFoundError,
  UnauthorizedError,
  ValidationError,
} from "../lib/errors.js";
import { createAuditEventStore } from "../modules/governance/audit-repository.js";

function context(req: FastifyRequest): ProjectContext {
  const ctx = req.projectContext;
  if (!ctx) throw new InvalidTenantScopeError("x-organization-id is missing or malformed");
  return ctx;
}

function requireActor(req: FastifyRequest): { actorId: string } {
  const actor = req.actor;
  if (!actor) throw new UnauthorizedError("missing credentials");
  return actor;
}

function assertFactId(id: string): void {
  if (!factIdSchema.safeParse(id).success) throw new ValidationError("fact id is malformed");
}

export function registerFactRoutes(app: FastifyInstance): void {
  const BEARER = { config: { auth: "bearer" as const } };
  const projects = () => createProjectContextRepository(app.db);
  const store = () => createFactStore(app.db);
  const vStore = () => createFactVersionStore(app.db);
  const sourceStore = () => createSourceStore(app.db);
  const auditStore = () => createAuditEventStore(app.db);

  function actorName(actor: { actorId: string; name?: string }): string {
    return actor.name ?? actor.actorId;
  }

  async function requireProject(organizationId: string, projectId: string): Promise<void> {
    if (!(await projects().getProject(organizationId, projectId))) throw new TenantNotFoundError();
  }

  app.post("/facts", BEARER, async (req, reply) => {
    const actor = requireActor(req);
    const ctx = context(req);

    const parsed = createFactBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) throw new ValidationError("invalid fact body");
    const body = parsed.data;

    if (!projectIdSchema.safeParse(body.projectId).success) {
      throw new ValidationError("projectId is malformed");
    }
    await requireProject(ctx.organizationId, body.projectId);

    const fact = await store().create({
      organizationId: ctx.organizationId,
      projectId: body.projectId,
      subjectId: body.subjectId,
      predicate: body.predicate,
      objectId: body.objectId,
      status: INITIAL_FACT_STATUS,
      ownerId: actor.actorId,
    });
    await vStore().append({
      organizationId: ctx.organizationId,
      factId: fact.id,
      version: fact.version,
      snapshot: fact,
      changedBy: actor.actorId,
      changeSummary: "initial version",
    });
    await auditStore().append({
      organizationId: ctx.organizationId,
      eventType: "CREATE",
      targetId: fact.id,
      targetType: "fact",
      actorId: actor.actorId,
      actorName: actorName(actor),
      newVersion: fact.version,
    });
    reply.status(201);
    return fact;
  });

  app.get("/facts/:id", BEARER, async (req) => {
    requireActor(req);
    const ctx = context(req);
    const { id } = req.params as { id: string };
    assertFactId(id);
    const fact = await store().findById(ctx.organizationId, id);
    if (!fact) throw new FactNotFoundError();
    return fact;
  });

  app.get("/facts", BEARER, async (req) => {
    requireActor(req);
    const ctx = context(req);
    const query = req.query as { projectId?: string; predicate?: string; status?: string };
    const filter: FactFilter = {};

    if (query.projectId !== undefined) {
      if (!projectIdSchema.safeParse(query.projectId).success) {
        throw new ValidationError("projectId is malformed");
      }
      await requireProject(ctx.organizationId, query.projectId);
      filter.projectId = query.projectId;
    }
    if (query.predicate !== undefined) {
      if (query.predicate.trim().length === 0) throw new ValidationError("predicate filter is invalid");
      filter.predicate = query.predicate;
    }
    if (query.status !== undefined) {
      const s = factStatusSchema.safeParse(query.status);
      if (!s.success) throw new ValidationError("status filter is invalid");
      filter.status = s.data;
    }

    return { facts: await store().findByProject(ctx.organizationId, filter) };
  });

  app.patch("/facts/:id", BEARER, async (req) => {
    const actor = requireActor(req);
    const ctx = context(req);
    const { id } = req.params as { id: string };
    assertFactId(id);

    const parsed = updateFactBodySchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError("invalid fact patch");
    const rawPatch = parsed.data;
    const callerSummary = rawPatch.changeSummary;
    const patch = { ...rawPatch };
    delete (patch as Record<string, unknown>).changeSummary;
    if (Object.keys(patch).length === 0) {
      throw new ValidationError("patch must contain at least one field");
    }

    const existing = await store().findById(ctx.organizationId, id);
    if (!existing) throw new FactNotFoundError();

    if (patch.status !== undefined && patch.status !== existing.status) {
      assertFactTransition(existing.status, patch.status);
    }

    const updated = await store().update(ctx.organizationId, id, patch);
    if (!updated) throw new FactNotFoundError();

    const changedFields = Object.keys(patch);
    const changeSummary = callerSummary ?? `changed: ${changedFields.join(", ")}`;

    await vStore().append({
      organizationId: ctx.organizationId,
      factId: updated.id,
      version: updated.version,
      snapshot: updated,
      changedBy: actor.actorId,
      changeSummary,
    });
    await auditStore().append({
      organizationId: ctx.organizationId,
      eventType: "UPDATE",
      targetId: updated.id,
      targetType: "fact",
      actorId: actor.actorId,
      actorName: actorName(actor),
      previousVersion: existing.version,
      newVersion: updated.version,
    });
    return updated;
  });

  app.post("/facts/:id/sources", BEARER, async (req) => {
    const actor = requireActor(req);
    const ctx = context(req);
    const { id } = req.params as { id: string };
    assertFactId(id);

    const body = (req.body ?? {}) as { sourceId?: unknown };
    if (!sourceIdSchema.safeParse(body.sourceId).success) throw new ValidationError("sourceId is malformed");
    const sourceId = body.sourceId as string;

    const fact = await store().findById(ctx.organizationId, id);
    if (!fact) throw new FactNotFoundError();

    const source = await sourceStore().findById(ctx.organizationId, sourceId);
    if (!source) throw new SourceNotFoundError();

    const current = fact.sourceIds ?? [];
    if (current.includes(sourceId)) return fact; // idempotent

    const updated = await store().setSourceIds(ctx.organizationId, id, [...current, sourceId]);
    if (!updated) throw new FactNotFoundError();

    await vStore().append({
      organizationId: ctx.organizationId,
      factId: updated.id,
      version: updated.version,
      snapshot: updated,
      changedBy: actor.actorId,
      changeSummary: `attached source ${sourceId}`,
    });
    return updated;
  });

  app.delete("/facts/:id/sources/:sourceId", BEARER, async (req) => {
    const actor = requireActor(req);
    const ctx = context(req);
    const { id, sourceId } = req.params as { id: string; sourceId: string };
    assertFactId(id);
    if (!sourceIdSchema.safeParse(sourceId).success) throw new ValidationError("sourceId is malformed");

    const fact = await store().findById(ctx.organizationId, id);
    if (!fact) throw new FactNotFoundError();

    const current = fact.sourceIds ?? [];
    if (!current.includes(sourceId)) throw new SourceNotFoundError();

    const updated = await store().setSourceIds(ctx.organizationId, id, current.filter((s) => s !== sourceId));
    if (!updated) throw new FactNotFoundError();

    await vStore().append({
      organizationId: ctx.organizationId,
      factId: updated.id,
      version: updated.version,
      snapshot: updated,
      changedBy: actor.actorId,
      changeSummary: `detached source ${sourceId}`,
    });
    return updated;
  });

  app.delete("/facts/:id", BEARER, async (req, reply) => {
    requireActor(req);
    const ctx = context(req);
    const { id } = req.params as { id: string };
    assertFactId(id);

    const removed = await store().delete(ctx.organizationId, id);
    if (!removed) throw new FactNotFoundError();
    reply.status(204);
    return null;
  });
}
