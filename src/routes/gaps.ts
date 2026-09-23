import type { FastifyInstance, FastifyRequest } from "fastify";
import { createGapStore } from "../modules/knowledge-core/gap-repository.js";
import { gapIdSchema, gapStatusSchema, updateGapBodySchema } from "../modules/knowledge-core/gap-entities.js";
import { GapNotFoundError, InvalidTenantScopeError, ValidationError } from "../lib/errors.js";
import type { ProjectContext } from "../modules/project-context/context.js";

function context(req: FastifyRequest): ProjectContext {
  const ctx = req.projectContext;
  if (!ctx) throw new InvalidTenantScopeError("x-organization-id is missing or malformed");
  return ctx;
}

export function registerGapRoutes(app: FastifyInstance): void {
  const BEARER = { config: { auth: "bearer" as const } };
  const store = () => createGapStore(app.db);

  app.get("/gaps", BEARER, async (req) => {
    const ctx = context(req);
    const query = req.query as { projectId?: string; status?: string };

    if (!query.projectId) throw new ValidationError("projectId is required");

    let status: ReturnType<typeof gapStatusSchema.safeParse>["data"] | undefined;
    if (query.status !== undefined) {
      const parsed = gapStatusSchema.safeParse(query.status);
      if (!parsed.success) throw new ValidationError("status filter is invalid");
      status = parsed.data;
    }

    const gaps = await store().findByProject(ctx.organizationId, query.projectId, status);
    return { gaps };
  });

  app.get("/gaps/:id", BEARER, async (req) => {
    const ctx = context(req);
    const { id } = req.params as { id: string };

    const parsed = gapIdSchema.safeParse(id);
    if (!parsed.success) throw new ValidationError("gap id is malformed");

    const gap = await store().findById(ctx.organizationId, id);
    if (!gap) throw new GapNotFoundError();
    return gap;
  });

  app.patch("/gaps/:id", BEARER, async (req) => {
    const ctx = context(req);
    const { id } = req.params as { id: string };

    const idParsed = gapIdSchema.safeParse(id);
    if (!idParsed.success) throw new ValidationError("gap id is malformed");

    const bodyParsed = updateGapBodySchema.safeParse(req.body);
    if (!bodyParsed.success) throw new ValidationError("invalid gap patch");

    const updated = await store().update(ctx.organizationId, id, bodyParsed.data);
    if (!updated) throw new GapNotFoundError();
    return updated;
  });
}
