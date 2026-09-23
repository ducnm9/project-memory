import type { FastifyInstance } from "fastify";
import { createRepository as createProjectRepo } from "../modules/project-context/repository.js";
import { createRepositoryStore } from "../modules/repository-binding/repository.js";
import { createProjectSnapshotStore } from "../modules/repository-analyzer/snapshot-repository.js";
import { createProposalStore } from "../modules/ingestion/proposal-repository.js";
import { BootstrapProposalGenerator } from "../modules/ingestion/bootstrap-proposal-generator.js";
import { RepositoryAnalyzer } from "../modules/repository-analyzer/index.js";
import { createLLMModel, createLLMAssistant } from "../lib/llm.js";
import { orgIdSchema, projectIdSchema } from "../modules/project-context/entities.js";
import {
  NotFoundError,
  RepositoryNotFoundError,
  TenantNotFoundError,
  UnauthorizedError,
  ValidationError,
} from "../lib/errors.js";

// config is declared on FastifyInstance in src/app.ts

function parseOrThrow<T>(schema: { safeParse(v: unknown): { success: boolean; data?: T } }, value: unknown, message: string): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new ValidationError(message);
  return r.data as T;
}

export function registerBootstrapRoutes(app: FastifyInstance): void {
  const BEARER = { config: { auth: "bearer" as const } };

  app.post(
    "/organizations/:orgId/projects/:projectId/bootstrap",
    BEARER,
    async (req, reply) => {
      const actor = req.actor;
      if (!actor) throw new UnauthorizedError("missing credentials");

      const { orgId, projectId } = req.params as { orgId: string; projectId: string };
      parseOrThrow(orgIdSchema, orgId, "organization id is malformed");
      parseOrThrow(projectIdSchema, projectId, "project id is malformed");

      const projects = createProjectRepo(app.db);
      if (!(await projects.getProject(orgId, projectId))) throw new TenantNotFoundError();

      const repoStore = createRepositoryStore(app.db);
      const repos = await repoStore.listActiveByProject(orgId, projectId);
      if (repos.length === 0) throw new RepositoryNotFoundError("no repository bound to this project");

      const repo = repos[0];

      // Lazy import to avoid requiring a real git repo in tests
      const { createGitConnector } = await import("../modules/git-connector/git-connector.js");
      const { createCredentialStore } = await import("../modules/git-connector/credential-store.js");
      const encKey = Buffer.from(app.config.credentialEncryptionKey, "hex");
      const credStore = createCredentialStore(app.db, encKey);
      const gitConfig = { workDir: "/tmp/pm-repos", maxFileSizeBytes: 1_048_576, defaultCommitLimit: 100 };
      const git = createGitConnector(credStore, encKey, gitConfig);

      await git.connect(repo.id, repo.url);
      const files = await git.listFiles(repo.id);
      const readFile = (p: string) => git.readFile(repo.id, p);

      const llmAssistant = createLLMAssistant(app.config);
      const analyzer = new RepositoryAnalyzer(llmAssistant);
      const snapshot = await analyzer.analyze({ files, readFile });

      const snapshotStore = createProjectSnapshotStore(app.db);
      const stored = await snapshotStore.save(orgId, projectId, snapshot);

      const proposalStore = createProposalStore(app.db);
      const generator = new BootstrapProposalGenerator(proposalStore);
      const llmModel = createLLMModel(app.config);
      const { created, skipped } = await generator.generate(orgId, projectId, snapshot, llmModel);

      reply.status(201);
      return { snapshot: stored, proposals: created, created: created.length, skipped };
    },
  );

  app.get(
    "/organizations/:orgId/projects/:projectId/snapshot",
    BEARER,
    async (req) => {
      const { orgId, projectId } = req.params as { orgId: string; projectId: string };
      parseOrThrow(orgIdSchema, orgId, "organization id is malformed");
      parseOrThrow(projectIdSchema, projectId, "project id is malformed");

      const snapshotStore = createProjectSnapshotStore(app.db);
      const snap = await snapshotStore.findCurrent(orgId, projectId);
      if (!snap) throw new NotFoundError("no snapshot found — run bootstrap first");
      return snap;
    },
  );
}
