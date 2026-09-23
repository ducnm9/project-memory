import { describe, it, expect, vi } from "vitest";
import { IncrementalSync } from "../../../src/modules/ingestion/incremental-sync.js";
import { createKnowledgeItemStore } from "../../../src/modules/knowledge-core/repository.js";
import { createSourceStore } from "../../../src/modules/knowledge-core/source-repository.js";
import { createProposalStore } from "../../../src/modules/ingestion/proposal-repository.js";
import { createRepositoryStore } from "../../../src/modules/repository-binding/repository.js";
import { createFakeDb, type Collections } from "../../support/fake-db.js";
import { newKnowledgeItemId } from "../../../src/modules/knowledge-core/entities.js";
import { newRepositoryId } from "../../../src/modules/repository-binding/entities.js";
import type { GitConnector } from "../../../src/modules/git-connector/git-connector.js";

const orgId = "org_1";
const projectId = "proj_1";
const repoId = newRepositoryId();
const sha1 = "abc123";
const sha2 = "def456";

function makeGit(changedFiles: string[], headSha: string): GitConnector {
  return {
    connect: vi.fn(),
    listFiles: vi.fn(),
    readFile: vi.fn(),
    disconnect: vi.fn(),
    readCommits: vi.fn().mockResolvedValue([
      { hash: headSha, author: { name: "dev", email: "d@d.com" }, timestamp: new Date().toISOString(), message: "update", changedFiles },
    ]),
  } as unknown as GitConnector;
}

const seeded = (extra: Collections = {}): Collections => ({
  repositories: [{
    id: repoId, organizationId: orgId, projectId,
    url: "https://github.com/test/repo", host: "github.com", path: "test/repo",
    connector: "github", defaultBranch: "main", createdAt: "", createdBy: "tok_1", unboundAt: null,
    lastCommitSha: null, lastSyncedAt: null,
  }],
  knowledge_items: [],
  sources: [],
  proposals: [],
  ...extra,
});

describe("IncrementalSync", () => {
  it("returns toSha and empty arrays when no changes", async () => {
    const { db } = createFakeDb(seeded());
    const git = makeGit([], sha1);
    const sync = new IncrementalSync(
      git,
      createKnowledgeItemStore(db),
      createSourceStore(db),
      createProposalStore(db),
      createRepositoryStore(db),
    );
    const result = await sync.sync(orgId, projectId, repoId);
    expect(result.toSha).toBe(sha1);
    expect(result.changedFiles).toHaveLength(0);
    expect(result.stalledItems).toBe(0);
    expect(result.newProposals).toBe(0);
  });

  it("marks PUBLISHED KnowledgeItems as STALE when their source file changes", async () => {
    const knowId = newKnowledgeItemId();
    const { db, rows } = createFakeDb(seeded({
      knowledge_items: [{
        id: knowId, organizationId: orgId, projectId, type: "Architecture",
        title: "API module", summary: "s", content: {}, status: "PUBLISHED",
        version: 1, ownerId: "tok_1", createdAt: "", updatedAt: "", lastVerifiedAt: null,
        sourceIds: ["src_abc"],
      }],
      sources: [{
        id: "src_abc", organizationId: orgId, projectId, type: "repository_file",
        locator: "src/api/index.ts", metadata: {}, createdBy: "tok_1", createdAt: "",
      }],
    }));
    // Set lastCommitSha so this is NOT a first sync (enables stale logic)
    const repo = (rows.repositories as Array<Record<string, unknown>>).find(r => r.id === repoId);
    if (repo) repo.lastCommitSha = sha1;

    const git = makeGit(["src/api/index.ts"], sha2);
    const sync = new IncrementalSync(
      git,
      createKnowledgeItemStore(db),
      createSourceStore(db),
      createProposalStore(db),
      createRepositoryStore(db),
    );
    const result = await sync.sync(orgId, projectId, repoId);
    expect(result.stalledItems).toBe(1);
    const item = rows.knowledge_items.find(k => (k as {id:string}).id === knowId) as {status:string};
    expect(item.status).toBe("STALE");
  });

  it("is idempotent: re-running with same HEAD SHA is a no-op", async () => {
    const { db } = createFakeDb(seeded({
      repositories: [{
        id: repoId, organizationId: orgId, projectId,
        url: "https://github.com/test/repo", host: "github.com", path: "test/repo",
        connector: "github", defaultBranch: "main", createdAt: "", createdBy: "tok_1", unboundAt: null,
        lastCommitSha: sha1, lastSyncedAt: new Date().toISOString(),
      }],
      knowledge_items: [],
      sources: [],
      proposals: [],
    }));
    const git = makeGit(["src/api/index.ts"], sha1); // same SHA as lastCommitSha
    const sync = new IncrementalSync(
      git,
      createKnowledgeItemStore(db),
      createSourceStore(db),
      createProposalStore(db),
      createRepositoryStore(db),
    );
    const result = await sync.sync(orgId, projectId, repoId);
    expect(result.changedFiles).toHaveLength(0);
    expect(result.stalledItems).toBe(0);
  });
});
