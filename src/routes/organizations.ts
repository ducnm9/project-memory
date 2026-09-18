import type { FastifyInstance } from "fastify";
import { createRepository } from "../modules/project-context/repository.js";
import {
  createOrgBodySchema,
  createProjectBodySchema,
  orgIdSchema,
  projectIdSchema,
} from "../modules/project-context/entities.js";
import { InvalidTenantScopeError, TenantNotFoundError } from "../lib/errors.js";

function parseOrThrow<T>(
  schema: { safeParse(v: unknown): { success: boolean; data?: T } },
  value: unknown,
  msg: string,
): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new InvalidTenantScopeError(msg);
  return r.data as T;
}

export function registerOrganizationRoutes(app: FastifyInstance): void {
  const repo = () => createRepository(app.db);

  app.post("/organizations", async (req, reply) => {
    const { name } = parseOrThrow(createOrgBodySchema, req.body, "name is required");
    reply.status(201);
    return repo().createOrganization(name);
  });

  app.get("/organizations", async () => ({ organizations: await repo().listOrganizations() }));

  app.get("/organizations/:orgId", async (req) => {
    const { orgId } = req.params as { orgId: string };
    parseOrThrow(orgIdSchema, orgId, "organization id is malformed");
    const org = await repo().getOrganization(orgId);
    if (!org) throw new TenantNotFoundError();
    return org;
  });

  app.post("/organizations/:orgId/projects", async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    parseOrThrow(orgIdSchema, orgId, "organization id is malformed");
    const { name } = parseOrThrow(createProjectBodySchema, req.body, "name is required");
    if (!(await repo().getOrganization(orgId))) throw new TenantNotFoundError();
    reply.status(201);
    return repo().createProject(orgId, name);
  });

  app.get("/organizations/:orgId/projects", async (req) => {
    const { orgId } = req.params as { orgId: string };
    parseOrThrow(orgIdSchema, orgId, "organization id is malformed");
    if (!(await repo().getOrganization(orgId))) throw new TenantNotFoundError();
    return { projects: await repo().listProjects(orgId) };
  });

  app.get("/organizations/:orgId/projects/:projectId", async (req) => {
    const { orgId, projectId } = req.params as { orgId: string; projectId: string };
    parseOrThrow(orgIdSchema, orgId, "organization id is malformed");
    parseOrThrow(projectIdSchema, projectId, "project id is malformed");
    const project = await repo().getProject(orgId, projectId);
    if (!project) throw new TenantNotFoundError();
    return project;
  });
}
