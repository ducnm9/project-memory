import type { FastifyInstance, FastifyRequest } from "fastify";
import { createRepository as createProjectContextRepository } from "../modules/project-context/repository.js";
import { projectIdSchema } from "../modules/project-context/entities.js";
import type { ProjectContext } from "../modules/project-context/context.js";
import {
  createRelationBodySchema,
  relationIdSchema,
  relationPredicateSchema,
  relationStatusSchema,
  updateRelationBodySchema,
} from "../modules/knowledge-core/relation-entities.js";
import { createRelationStore, type RelationFilter } from "../modules/knowledge-core/relation-repository.js";
import { createRelationVersionStore } from "../modules/knowledge-core/relation-version-repository.js";
import { assertRelationTransition, INITIAL_RELATION_STATUS } from "../modules/knowledge-core/relation-lifecycle.js";
import { sourceIdSchema } from "../modules/knowledge-core/source-entities.js";
import { createSourceStore } from "../modules/knowledge-core/source-repository.js";
import {
  InvalidTenantScopeError,
  RelationNotFoundError,
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

function assertRelationId(id: string): void {
  if (!relationIdSchema.safeParse(id).success) throw new ValidationError("relation id is malformed");
}

export function registerRelationRoutes(app: FastifyInstance): void {
  const BEARER = { config: { auth: "bearer" as const } };
  const projects = () => createProjectContextRepository(app.db);
  const store = () => createRelationStore(app.db);
  const vStore = () => createRelationVersionStore(app.db);
  const sourceStore = () => createSourceStore(app.db);
  const auditStore = () => createAuditEventStore(app.db);

  function actorName(actor: { actorId: string; name?: string }): string {
    return actor.name ?? actor.actorId;
  }

  async function requireProject(organizationId: string, projectId: string): Promise<void> {
    if (!(await projects().getProject(organizationId, projectId))) throw new TenantNotFoundError();
  }

  app.post("/relations", BEARER, async (req, reply) => {
    const actor = requireActor(req);
    const ctx = context(req);

    const parsed = createRelationBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) throw new ValidationError("invalid relation body");
    const body = parsed.data;

    if (!projectIdSchema.safeParse(body.projectId).success) {
      throw new ValidationError("projectId is malformed");
    }
    await requireProject(ctx.organizationId, body.projectId);

    const relation = await store().create({
      organizationId: ctx.organizationId,
      projectId: body.projectId,
      subjectId: body.subjectId,
      predicate: body.predicate,
      objectId: body.objectId,
      status: INITIAL_RELATION_STATUS,
      ownerId: actor.actorId,
    });
    await vStore().append({
      organizationId: ctx.organizationId,
      relationId: relation.id,
      version: relation.version,
      snapshot: relation,
      changedBy: actor.actorId,
      changeSummary: "initial version",
    });
    await auditStore().append({
      organizationId: ctx.organizationId,
      eventType: "RELATION_CREATE",
      targetId: relation.id,
      targetType: "relation",
      actorId: actor.actorId,
      actorName: actorName(actor),
      newVersion: relation.version,
    });
    reply.status(201);
    return relation;
  });

  app.get("/relations/:id", BEARER, async (req) => {
    requireActor(req);
    const ctx = context(req);
    const { id } = req.params as { id: string };
    assertRelationId(id);
    const relation = await store().findById(ctx.organizationId, id);
    if (!relation) throw new RelationNotFoundError();
    return relation;
  });

  app.get("/relations", BEARER, async (req) => {
    requireActor(req);
    const ctx = context(req);
    const query = req.query as { projectId?: string; predicate?: string; status?: string };
    const filter: RelationFilter = {};

    if (query.projectId !== undefined) {
      if (!projectIdSchema.safeParse(query.projectId).success) {
        throw new ValidationError("projectId is malformed");
      }
      await requireProject(ctx.organizationId, query.projectId);
      filter.projectId = query.projectId;
    }
    if (query.predicate !== undefined) {
      const p = relationPredicateSchema.safeParse(query.predicate);
      if (!p.success) throw new ValidationError("predicate filter is invalid");
      filter.predicate = p.data;
    }
    if (query.status !== undefined) {
      const s = relationStatusSchema.safeParse(query.status);
      if (!s.success) throw new ValidationError("status filter is invalid");
      filter.status = s.data;
    }

    return { relations: await store().findByProject(ctx.organizationId, filter) };
  });

  app.patch("/relations/:id", BEARER, async (req) => {
    const actor = requireActor(req);
    const ctx = context(req);
    const { id } = req.params as { id: string };
    assertRelationId(id);

    const parsed = updateRelationBodySchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError("invalid relation patch");
    const rawPatch = parsed.data;
    const callerSummary = rawPatch.changeSummary;
    const patch = { ...rawPatch } as Record<string, unknown>;
    delete patch.changeSummary;
    if (Object.keys(patch).length === 0) {
      throw new ValidationError("patch must contain at least one field");
    }

    const existing = await store().findById(ctx.organizationId, id);
    if (!existing) throw new RelationNotFoundError();

    if (patch.status !== undefined && patch.status !== existing.status) {
      assertRelationTransition(existing.status, patch.status as typeof existing.status);
      // Stamp reviewer when the relation leaves PROPOSED (the decision edge).
      if (existing.status === "PROPOSED") {
        patch.reviewerId = actor.actorId;
      }
    }

    const updated = await store().update(ctx.organizationId, id, patch);
    if (!updated) throw new RelationNotFoundError();

    const changedFields = Object.keys(patch);
    const changeSummary = callerSummary ?? `changed: ${changedFields.join(", ")}`;

    await vStore().append({
      organizationId: ctx.organizationId,
      relationId: updated.id,
      version: updated.version,
      snapshot: updated,
      changedBy: actor.actorId,
      changeSummary,
    });
    await auditStore().append({
      organizationId: ctx.organizationId,
      eventType: "RELATION_UPDATE",
      targetId: updated.id,
      targetType: "relation",
      actorId: actor.actorId,
      actorName: actorName(actor),
      previousVersion: existing.version,
      newVersion: updated.version,
    });
    return updated;
  });

  app.post("/relations/:id/sources", BEARER, async (req) => {
    const actor = requireActor(req);
    const ctx = context(req);
    const { id } = req.params as { id: string };
    assertRelationId(id);

    const body = (req.body ?? {}) as { sourceId?: unknown };
    if (!sourceIdSchema.safeParse(body.sourceId).success) throw new ValidationError("sourceId is malformed");
    const sourceId = body.sourceId as string;

    const relation = await store().findById(ctx.organizationId, id);
    if (!relation) throw new RelationNotFoundError();

    const source = await sourceStore().findById(ctx.organizationId, sourceId);
    if (!source) throw new SourceNotFoundError();

    const current = relation.sourceIds ?? [];
    if (current.includes(sourceId)) return relation; // idempotent

    const updated = await store().setSourceIds(ctx.organizationId, id, [...current, sourceId]);
    if (!updated) throw new RelationNotFoundError();

    await vStore().append({
      organizationId: ctx.organizationId,
      relationId: updated.id,
      version: updated.version,
      snapshot: updated,
      changedBy: actor.actorId,
      changeSummary: `attached source ${sourceId}`,
    });
    return updated;
  });

  app.delete("/relations/:id/sources/:sourceId", BEARER, async (req) => {
    const actor = requireActor(req);
    const ctx = context(req);
    const { id, sourceId } = req.params as { id: string; sourceId: string };
    assertRelationId(id);
    if (!sourceIdSchema.safeParse(sourceId).success) throw new ValidationError("sourceId is malformed");

    const relation = await store().findById(ctx.organizationId, id);
    if (!relation) throw new RelationNotFoundError();

    const current = relation.sourceIds ?? [];
    if (!current.includes(sourceId)) throw new SourceNotFoundError();

    const updated = await store().setSourceIds(ctx.organizationId, id, current.filter((s) => s !== sourceId));
    if (!updated) throw new RelationNotFoundError();

    await vStore().append({
      organizationId: ctx.organizationId,
      relationId: updated.id,
      version: updated.version,
      snapshot: updated,
      changedBy: actor.actorId,
      changeSummary: `detached source ${sourceId}`,
    });
    return updated;
  });

  app.delete("/relations/:id", BEARER, async (req, reply) => {
    const actor = requireActor(req);
    const ctx = context(req);
    const { id } = req.params as { id: string };
    assertRelationId(id);

    const removed = await store().delete(ctx.organizationId, id);
    if (!removed) throw new RelationNotFoundError();
    await auditStore().append({
      organizationId: ctx.organizationId,
      eventType: "RELATION_DELETE",
      targetId: id,
      targetType: "relation",
      actorId: actor.actorId,
      actorName: actorName(actor),
    });
    reply.status(204);
    return null;
  });
}
