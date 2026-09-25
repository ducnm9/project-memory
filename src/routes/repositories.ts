import type { FastifyInstance, FastifyReply } from "fastify";
import { createRepository as createProjectContextRepository } from "../modules/project-context/repository.js";
import { orgIdSchema, projectIdSchema } from "../modules/project-context/entities.js";
import {
  connectRepositoryBodySchema,
  repositoryIdSchema,
  type Repository,
} from "../modules/repository-binding/entities.js";
import { createRepositoryStore } from "../modules/repository-binding/repository.js";
import { parseRepositoryUrl } from "../modules/repository-binding/url.js";
import { resolveProjectByRepository } from "../modules/repository-binding/resolver.js";
import {
  InvalidRepositoryUrlError,
  InvalidTenantScopeError,
  RepositoryConflictError,
  RepositoryNotFoundError,
  TenantNotFoundError,
  UnauthorizedError,
} from "../lib/errors.js";

const DUPLICATE_KEY = 11000;

function parseOrThrow<T>(
  schema: { safeParse(v: unknown): { success: boolean; data?: T } },
  value: unknown,
  msg: string,
): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new InvalidTenantScopeError(msg);
  return r.data as T;
}

function isDuplicateKeyError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: number }).code === DUPLICATE_KEY
  );
}

function respondToExisting(existing: Repository, projectId: string, reply: FastifyReply): Repository {
  if (existing.projectId !== projectId) throw new RepositoryConflictError();
  reply.status(200);
  return existing;
}

export function registerRepositoryRoutes(app: FastifyInstance): void {
  const BEARER = { config: { auth: "bearer" as const } };
  const projects = () => createProjectContextRepository(app.db);
  const store = () => createRepositoryStore(app.db);

  async function requireProject(orgId: string, projectId: string): Promise<void> {
    if (!(await projects().getProject(orgId, projectId))) throw new TenantNotFoundError();
  }

  app.post("/organizations/:orgId/projects/:projectId/repositories", BEARER, async (req, reply) => {
    const actor = req.actor;
    if (!actor) throw new UnauthorizedError("missing credentials");

    const { orgId, projectId } = req.params as { orgId: string; projectId: string };
    parseOrThrow(orgIdSchema, orgId, "organization id is malformed");
    parseOrThrow(projectIdSchema, projectId, "project id is malformed");
    const parsedBody = connectRepositoryBodySchema.safeParse(req.body);
    if (!parsedBody.success) throw new InvalidRepositoryUrlError();
    const body = parsedBody.data;

    await requireProject(orgId, projectId);

    const parsed = parseRepositoryUrl(body.repositoryUrl);
    if (!parsed) throw new InvalidRepositoryUrlError();

    const existing = await store().findActiveByUrl(orgId, parsed.url);
    if (existing) return respondToExisting(existing, projectId, reply);

    try {
      const repository = await store().createRepository({
        organizationId: orgId,
        projectId,
        url: parsed.url,
        host: parsed.host,
        path: parsed.path,
        connector: body.connector ?? parsed.connector,
        defaultBranch: body.defaultBranch ?? null,
        createdBy: actor.actorId,
      });
      reply.status(201);
      return repository;
    } catch (err) {
      if (!isDuplicateKeyError(err)) throw err;
      const raced = await store().findActiveByUrl(orgId, parsed.url);
      if (!raced) throw err;
      return respondToExisting(raced, projectId, reply);
    }
  });

  app.get("/organizations/:orgId/projects/:projectId/repositories", BEARER, async (req) => {
    const { orgId, projectId } = req.params as { orgId: string; projectId: string };
    parseOrThrow(orgIdSchema, orgId, "organization id is malformed");
    parseOrThrow(projectIdSchema, projectId, "project id is malformed");
    await requireProject(orgId, projectId);
    return { repositories: await store().listActiveByProject(orgId, projectId) };
  });

  app.get("/organizations/:orgId/repositories/resolve", BEARER, async (req) => {
    const { orgId } = req.params as { orgId: string };
    parseOrThrow(orgIdSchema, orgId, "organization id is malformed");

    const { repositoryUrl } = req.query as { repositoryUrl?: string };
    if (typeof repositoryUrl !== "string" || repositoryUrl.trim().length === 0) {
      throw new InvalidRepositoryUrlError();
    }
    if (!parseRepositoryUrl(repositoryUrl)) throw new InvalidRepositoryUrlError();

    const resolved = await resolveProjectByRepository(store(), orgId, repositoryUrl);
    if (!resolved) throw new RepositoryNotFoundError();
    return { organizationId: orgId, ...resolved };
  });

  app.delete(
    "/organizations/:orgId/projects/:projectId/repositories/:repositoryId",
    BEARER,
    async (req, reply) => {
      const { orgId, projectId, repositoryId } = req.params as {
        orgId: string;
        projectId: string;
        repositoryId: string;
      };
      parseOrThrow(orgIdSchema, orgId, "organization id is malformed");
      parseOrThrow(projectIdSchema, projectId, "project id is malformed");
      parseOrThrow(repositoryIdSchema, repositoryId, "repository id is malformed");

      const unbound = await store().markUnbound(orgId, projectId, repositoryId);
      if (!unbound) throw new RepositoryNotFoundError();
      reply.status(204);
      return null;
    },
  );

  app.post(
    "/organizations/:orgId/projects/:projectId/repositories/:repositoryId/sync",
    BEARER,
    async (req) => {
      const actor = req.actor;
      if (!actor) throw new UnauthorizedError("missing credentials");

      const { orgId, projectId, repositoryId } = req.params as {
        orgId: string;
        projectId: string;
        repositoryId: string;
      };
      parseOrThrow(orgIdSchema, orgId, "organization id is malformed");
      parseOrThrow(projectIdSchema, projectId, "project id is malformed");
      parseOrThrow(repositoryIdSchema, repositoryId, "repository id is malformed");

      const repoStore = store();
      const repo = await repoStore.findById(orgId, repositoryId);
      if (!repo) throw new RepositoryNotFoundError();

      const { createGitConnector } = await import("../modules/git-connector/git-connector.js");
      const { createCredentialStore } = await import("../modules/git-connector/credential-store.js");
      const encKey = Buffer.from(app.config.credentialEncryptionKey, "hex");
      const gitConfig = { workDir: "/tmp/pm-repos", maxFileSizeBytes: 1_048_576, defaultCommitLimit: 1 };
      const git = createGitConnector(createCredentialStore(app.db, encKey), encKey, gitConfig);
      await git.connect(repositoryId, repo.url);

      const { IncrementalSync } = await import("../modules/ingestion/incremental-sync.js");
      const { createKnowledgeItemStore } = await import("../modules/knowledge-core/repository.js");
      const { createSourceStore } = await import("../modules/knowledge-core/source-repository.js");
      const { createProposalStore } = await import("../modules/ingestion/proposal-repository.js");

      const syncService = new IncrementalSync(
        git,
        createKnowledgeItemStore(app.db),
        createSourceStore(app.db),
        createProposalStore(app.db),
        repoStore,
        app.db,
      );
      return syncService.sync(orgId, projectId, repositoryId);
    },
  );
}
