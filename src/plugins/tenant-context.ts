import type { FastifyInstance, FastifyRequest } from "fastify";
import { createRepository } from "../modules/project-context/repository.js";
import { resolveContext, type ProjectContext } from "../modules/project-context/context.js";
import { ForbiddenScopeError } from "../lib/errors.js";

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
    const headerOrgId = header(req, "x-organization-id");
    const pathOrgId = (req.params as { orgId?: string } | undefined)?.orgId;

    // PM-005: every organization this request claims — header or path param —
    // must match the authenticated actor. Path-parameter routes carry their
    // scope in :orgId, so checking the header alone leaves them unenforced.
    if (req.actor) {
      for (const claimed of [headerOrgId, pathOrgId]) {
        if (claimed !== undefined && req.actor.organizationId !== claimed) {
          throw new ForbiddenScopeError("token not permitted for this organization");
        }
      }
    }

    if (headerOrgId === undefined) return; // no header → no context; path routes check existence themselves

    const repo = createRepository(app.db);
    req.projectContext = await resolveContext(repo, {
      organizationId: headerOrgId,
      projectId: header(req, "x-project-id"),
    });
  });
}
