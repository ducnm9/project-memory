import type { FastifyInstance, FastifyRequest } from "fastify";
import { createRepository as createProjectContextRepository } from "../modules/project-context/repository.js";
import { projectIdSchema } from "../modules/project-context/entities.js";
import type { ProjectContext } from "../modules/project-context/context.js";
import {
  createSourceBodySchema,
  sourceIdSchema,
  sourceTypeSchema,
  type SourceType,
} from "../modules/knowledge-core/source-entities.js";
import { createSourceStore, type SourceFilter } from "../modules/knowledge-core/source-repository.js";
import {
  InvalidTenantScopeError,
  SourceNotFoundError,
  TenantNotFoundError,
  UnauthorizedError,
  ValidationError,
} from "../lib/errors.js";

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

export function registerSourceRoutes(app: FastifyInstance): void {
  const BEARER = { config: { auth: "bearer" as const } };
  const projects = () => createProjectContextRepository(app.db);
  const store = () => createSourceStore(app.db);

  async function requireProject(organizationId: string, projectId: string): Promise<void> {
    if (!(await projects().getProject(organizationId, projectId))) throw new TenantNotFoundError();
  }

  app.post("/sources", BEARER, async (req, reply) => {
    const actor = requireActor(req);
    const ctx = context(req);

    const parsed = createSourceBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) throw new ValidationError("invalid source body");
    const body = parsed.data;

    if (!projectIdSchema.safeParse(body.projectId).success) {
      throw new ValidationError("projectId is malformed");
    }
    await requireProject(ctx.organizationId, body.projectId);

    const source = await store().create({
      organizationId: ctx.organizationId,
      projectId: body.projectId,
      type: body.type,
      locator: body.locator,
      metadata: body.metadata,
      createdBy: actor.actorId,
    });
    reply.status(201);
    return source;
  });

  app.get("/sources/:id", BEARER, async (req) => {
    requireActor(req);
    const ctx = context(req);
    const { id } = req.params as { id: string };
    if (!sourceIdSchema.safeParse(id).success) throw new ValidationError("source id is malformed");

    const source = await store().findById(ctx.organizationId, id);
    if (!source) throw new SourceNotFoundError();
    return source;
  });

  app.get("/sources", BEARER, async (req) => {
    requireActor(req);
    const ctx = context(req);
    const query = req.query as { projectId?: string; type?: string };
    const filter: SourceFilter = {};

    if (query.projectId !== undefined) {
      if (!projectIdSchema.safeParse(query.projectId).success) {
        throw new ValidationError("projectId is malformed");
      }
      await requireProject(ctx.organizationId, query.projectId);
      filter.projectId = query.projectId;
    }
    if (query.type !== undefined) {
      const t = sourceTypeSchema.safeParse(query.type);
      if (!t.success) throw new ValidationError("type filter is invalid");
      filter.type = t.data as SourceType;
    }

    return { sources: await store().findByProject(ctx.organizationId, filter) };
  });

  app.delete("/sources/:id", BEARER, async (req, reply) => {
    requireActor(req);
    const ctx = context(req);
    const { id } = req.params as { id: string };
    if (!sourceIdSchema.safeParse(id).success) throw new ValidationError("source id is malformed");

    const removed = await store().delete(ctx.organizationId, id);
    if (!removed) throw new SourceNotFoundError();
    reply.status(204);
    return null;
  });
}
