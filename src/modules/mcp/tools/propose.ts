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
  const type = args.type;
  const title = args.title;
  const orgId = args.orgId;
  const projectId = args.projectId;
  const content = args.content;

  if (!type || !title || !content || !orgId || !projectId) {
    throw new Error("type, title, content, orgId, and projectId are required");
  }
  if (typeof content !== "object" || content === null || Array.isArray(content)) {
    throw new Error("content must be an object");
  }

  const summary = typeof args.summary === "string" ? args.summary : (title as string);
  const sourceIds = Array.isArray(args.sourceIds) ? (args.sourceIds as string[]) : [];

  const dupDetector = new DuplicateDetector(db, config.embedding ?? undefined);
  const dupResult = await dupDetector.detect(
    orgId as string,
    projectId as string,
    type as string,
    title as string,
    summary,
    sourceIds,
  );
  if (dupResult?.duplicate) throw new Error(`Duplicate detected: ${dupResult.existingId}`);

  const contraDetector = new ContradictionDetector(db, config.llm ?? undefined, config.embedding ?? undefined);
  const contradictions = await contraDetector.detect(
    orgId as string,
    projectId as string,
    type as string,
    title as string,
    summary,
    content as Record<string, unknown>,
  );

  const store = createProposalStore(db);
  const proposal = await store.create({
    organizationId: orgId as string,
    projectId: projectId as string,
    type: type as KnowledgeType,
    title: title as string,
    summary,
    content: content as Record<string, unknown>,
    sourceIds,
    triggeredBy: "manual",
    proposedBy: "mcp-agent",
    knowledgeItemId: null,
    validationResults: [],
  });

  return {
    proposal,
    contradictions,
    duplicateWarning: dupResult?.duplicate === false ? dupResult : null,
  };
}
