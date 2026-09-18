import { InvalidTenantScopeError, TenantNotFoundError } from "../../lib/errors.js";
import { orgIdSchema, projectIdSchema } from "./entities.js";
import type { ProjectContextRepository } from "./repository.js";

export interface ProjectContext {
  organizationId: string;
  projectId: string | null;
}

export interface ScopeHeaders {
  organizationId?: string;
  projectId?: string;
}

export async function resolveContext(
  repo: ProjectContextRepository,
  headers: ScopeHeaders,
): Promise<ProjectContext> {
  const orgParse = orgIdSchema.safeParse(headers.organizationId);
  if (!orgParse.success) {
    throw new InvalidTenantScopeError("x-organization-id is missing or malformed");
  }
  const organizationId = orgParse.data;

  if (!(await repo.getOrganization(organizationId))) {
    throw new TenantNotFoundError();
  }

  if (headers.projectId === undefined) {
    return { organizationId, projectId: null };
  }

  const projParse = projectIdSchema.safeParse(headers.projectId);
  if (!projParse.success) {
    throw new InvalidTenantScopeError("x-project-id is malformed");
  }
  const projectId = projParse.data;

  if (!(await repo.getProject(organizationId, projectId))) {
    throw new TenantNotFoundError();
  }

  return { organizationId, projectId };
}
