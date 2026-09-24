import type { Db } from "mongodb";
import type { AppConfig } from "../../../config/index.js";
import { createProposalStore } from "../../governance/proposal-store.js";
import { DuplicateDetector } from "../../governance/duplicate-detector.js";
import { ContradictionDetector } from "../../governance/contradiction-detector.js";
import type { KnowledgeType } from "../../knowledge-core/entities.js";

export async function proposeKnowledge(
  args: Record<string, unknown>,
  db: Db,
  config: AppConfig,
): Promise<unknown> {
  const { type, title, content, orgId, projectId } = args as Record<string, string>;
  if (!type || !title || !content) throw new Error("type, title, and content are required");

  const summary = typeof args.summary === "string" ? args.summary : title;
  const sourceIds = Array.isArray(args.sourceIds) ? (args.sourceIds as string[]) : [];

  const dupDetector = new DuplicateDetector(db, config.embedding ?? undefined);
  const dupResult = await dupDetector.detect(orgId, projectId, type, title, summary, sourceIds);
  if (dupResult?.duplicate) throw new Error(`Duplicate detected: ${dupResult.existingId}`);

  const contraDetector = new ContradictionDetector(db, config.llm ?? undefined, config.embedding ?? undefined);
  const contradictions = await contraDetector.detect(orgId, projectId, type, title, summary, content as unknown as Record<string, unknown>);

  const store = createProposalStore(db);
  const proposal = await store.create({
    organizationId: orgId,
    projectId,
    type: type as KnowledgeType,
    title,
    summary,
    content: content as unknown as Record<string, unknown>,
    sourceIds,
    triggeredBy: "manual",
    proposedBy: "mcp-agent",
    knowledgeItemId: null,
    validationResults: [],
  });

  return { proposal, contradictions };
}
