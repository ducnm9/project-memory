import type { FastifyInstance, FastifyRequest } from "fastify";
import { createRepository } from "../modules/project-context/repository.js";
import { resolveContext, type ProjectContext } from "../modules/project-context/context.js";

declare module "fastify" {
  interface FastifyRequest {
    projectContext?: ProjectContext;
  }
}

function header(req: FastifyRequest, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}

export function registerTenantContext(app: FastifyInstance): void {
  app.addHook("onRequest", async (req) => {
    const organizationId = header(req, "x-organization-id");
    if (organizationId === undefined) return; // no-op; path-scoped routes handle their own ids
    const repo = createRepository(app.db);
    req.projectContext = await resolveContext(repo, {
      organizationId,
      projectId: header(req, "x-project-id"),
    });
  });
}
