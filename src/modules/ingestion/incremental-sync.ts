import { createHash } from "node:crypto";
import type { Db } from "mongodb";
import type { GitConnector } from "../git-connector/git-connector.js";
import type { KnowledgeItemStore } from "../knowledge-core/repository.js";
import type { SourceStore } from "../knowledge-core/source-repository.js";
import type { ProposalStore } from "./proposal-repository.js";
import type { RepositoryStore } from "../repository-binding/repository.js";

export interface SyncResult {
  fromSha: string | null;
  toSha: string;
  changedFiles: string[];
  stalledItems: number;
  newProposals: number;
}

export class IncrementalSync {
  constructor(
    private readonly git: GitConnector,
    private readonly knowledgeStore: KnowledgeItemStore,
    private readonly sourceStore: SourceStore,
    private readonly proposalStore: ProposalStore,
    private readonly repoStore: RepositoryStore,
    private readonly db?: Db,
  ) {}

  async sync(orgId: string, projectId: string, repoId: string): Promise<SyncResult> {
    const repo = await this.repoStore.findById(orgId, repoId);
    if (!repo) throw new Error(`repository ${repoId} not found`);

    const commits = await this.git.readCommits(repoId, 1);
    if (commits.length === 0) {
      return { fromSha: repo.lastCommitSha, toSha: repo.lastCommitSha ?? "", changedFiles: [], stalledItems: 0, newProposals: 0 };
    }

    const headCommit = commits[0];
    const headSha = headCommit.hash;

    // Idempotent: already processed this SHA
    if (repo.lastCommitSha === headSha) {
      return { fromSha: headSha, toSha: headSha, changedFiles: [], stalledItems: 0, newProposals: 0 };
    }

    const changedFiles = headCommit.changedFiles;
    let stalledItems = 0;
    let newProposals = 0;

    if (changedFiles.length > 0 && repo.lastCommitSha !== null) {
      // Find sources matching changed files
      const sources = await this.sourceStore.findByProject(orgId, { projectId });
      const affectedSourceIds = sources
        .filter(s => s.type === "repository_file" && changedFiles.includes(s.locator))
        .map(s => s.id);

      if (affectedSourceIds.length > 0) {
        const allItems = await this.knowledgeStore.findByProject(orgId, { projectId, status: "PUBLISHED" });
        for (const item of allItems) {
          const affected = item.sourceIds.some(sid => affectedSourceIds.includes(sid));
          if (!affected) continue;
          await this.knowledgeStore.update(orgId, item.id, { status: "STALE" });
          stalledItems++;
        }
      }

      // Generate update proposals for changed module path prefixes
      const uniqueModulePaths = [...new Set(changedFiles.map(f => f.split("/").slice(0, 2).join("/")))];
      for (const modulePath of uniqueModulePaths) {
        const title = `Update: ${modulePath} changed`;
        const matchingFiles = changedFiles.filter(f => f.startsWith(modulePath));
        const summary = `Files changed in ${modulePath}: ${matchingFiles.join(", ")}`;
        const hash = createHash("sha256").update(`Architecture:${title}:${summary}`).digest("hex");
        if (await this.proposalStore.existsByHash(orgId, projectId, hash)) continue;
        await this.proposalStore.create({
          organizationId: orgId, projectId, type: "Architecture",
          title, summary, content: { changedFiles: matchingFiles },
          sourceIds: [], triggeredBy: "incremental",
          proposedBy: "system", knowledgeItemId: null, validationResults: [],
        });
        newProposals++;
      }
    }

    await this.repoStore.updateSyncState(orgId, repoId, headSha);

    if (this.db) {
      const { FreshnessChecker } = await import("../governance/freshness-checker.js");
      const { DEFAULT_TTL_DAYS } = await import("../governance/freshness-config.js");
      await new FreshnessChecker(this.db).check(orgId, projectId, { ttlDays: DEFAULT_TTL_DAYS });
    }

    return { fromSha: repo.lastCommitSha, toSha: headSha, changedFiles, stalledItems, newProposals };
  }
}
