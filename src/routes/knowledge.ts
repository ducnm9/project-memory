import type { FastifyInstance, FastifyRequest } from "fastify";
import { createRepository as createProjectContextRepository } from "../modules/project-context/repository.js";
import { projectIdSchema } from "../modules/project-context/entities.js";
import type { ProjectContext } from "../modules/project-context/context.js";
import {
  createKnowledgeItemBodySchema,
  knowledgeIdSchema,
  knowledgeStatusSchema,
  knowledgeTypeSchema,
  updateKnowledgeItemBodySchema,
} from "../modules/knowledge-core/entities.js";
import {
  createKnowledgeItemStore,
  type KnowledgeItemFilter,
} from "../modules/knowledge-core/repository.js";
import { assertTransition, isInitialStatus } from "../modules/knowledge-core/lifecycle.js";
import {
  InvalidKnowledgeTypeError,
  InvalidStatusTransitionError,
  InvalidTenantScopeError,
  KnowledgeNotFoundError,
  TenantNotFoundError,
  UnauthorizedError,
  ValidationError,
} from "../lib/errors.js";

function context(req: FastifyRequest): ProjectContext {
  const ctx = req.projectContext;
  if (!ctx) throw new InvalidTenantScopeError("x-organization-id is missing or malformed");
  return ctx;
}

function parseOrThrow<T>(
  schema: { safeParse(v: unknown): { success: boolean; data?: T } },
  value: unknown,
  message: string,
): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new ValidationError(message);
  return result.data as T;
}

export function registerKnowledgeRoutes(app: FastifyInstance): void {
  const BEARER = { config: { auth: "bearer" as const } };
  const projects = () => createProjectContextRepository(app.db);
  const store = () => createKnowledgeItemStore(app.db);

  async function requireProject(organizationId: string, projectId: string): Promise<void> {
    if (!(await projects().getProject(organizationId, projectId))) throw new TenantNotFoundError();
  }

  app.post("/knowledge", BEARER, async (req, reply) => {
    const actor = req.actor;
    if (!actor) throw new UnauthorizedError("missing credentials");
    const ctx = context(req);

    const raw = (req.body ?? {}) as { type?: unknown; status?: unknown };

    if (!knowledgeTypeSchema.safeParse(raw.type).success) {
      throw new InvalidKnowledgeTypeError();
    }
    if (raw.status !== undefined) {
      const status = knowledgeStatusSchema.safeParse(raw.status);
      if (!status.success || !isInitialStatus(status.data)) {
        throw new InvalidStatusTransitionError("none", String(raw.status));
      }
    }

    const parsed = createKnowledgeItemBodySchema.safeParse(raw);
    if (!parsed.success) throw new ValidationError("invalid knowledge item body");
    const body = parsed.data;

    if (!projectIdSchema.safeParse(body.projectId).success) {
      throw new ValidationError("projectId is malformed");
    }

    await requireProject(ctx.organizationId, body.projectId);

    const item = await store().create({
      organizationId: ctx.organizationId,
      projectId: body.projectId,
      type: body.type,
      title: body.title,
      summary: body.summary,
      content: body.content,
      status: body.status ?? "DISCOVERED",
      ownerId: actor.actorId,
    });
    reply.status(201);
    return item;
  });

  app.get("/knowledge/:id", BEARER, async (req) => {
    const ctx = context(req);
    const { id } = req.params as { id: string };
    parseOrThrow(knowledgeIdSchema, id, "knowledge id is malformed");

    const item = await store().findById(ctx.organizationId, id);
    if (!item) throw new KnowledgeNotFoundError();
    return item;
  });

  app.get("/knowledge", BEARER, async (req) => {
    const ctx = context(req);
    const query = req.query as { projectId?: string; type?: string; status?: string };
    const filter: KnowledgeItemFilter = {};

    if (query.projectId !== undefined) {
      const projectId = parseOrThrow(projectIdSchema, query.projectId, "projectId is malformed");
      await requireProject(ctx.organizationId, projectId);
      filter.projectId = projectId;
    }
    if (query.type !== undefined) {
      filter.type = parseOrThrow(knowledgeTypeSchema, query.type, "type filter is invalid");
    }
    if (query.status !== undefined) {
      filter.status = parseOrThrow(knowledgeStatusSchema, query.status, "status filter is invalid");
    }

    return { items: await store().findByProject(ctx.organizationId, filter) };
  });

  app.patch("/knowledge/:id", BEARER, async (req) => {
    const ctx = context(req);
    const { id } = req.params as { id: string };
    parseOrThrow(knowledgeIdSchema, id, "knowledge id is malformed");

    const parsed = updateKnowledgeItemBodySchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError("invalid knowledge item patch");
    const patch = parsed.data;
    if (Object.keys(patch).length === 0) {
      throw new ValidationError("patch must contain at least one field");
    }

    const existing = await store().findById(ctx.organizationId, id);
    if (!existing) throw new KnowledgeNotFoundError();

    if (patch.status !== undefined && patch.status !== existing.status) {
      assertTransition(existing.status, patch.status);
    }

    const updated = await store().update(ctx.organizationId, id, patch);
    if (!updated) throw new KnowledgeNotFoundError();
    return updated;
  });

  app.delete("/knowledge/:id", BEARER, async (req, reply) => {
    const ctx = context(req);
    const { id } = req.params as { id: string };
    parseOrThrow(knowledgeIdSchema, id, "knowledge id is malformed");

    const removed = await store().delete(ctx.organizationId, id);
    if (!removed) throw new KnowledgeNotFoundError();
    reply.status(204);
    return null;
  });
}
