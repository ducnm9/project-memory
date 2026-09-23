import { ulid } from "ulid";
import type { KnowledgeType } from "../knowledge-core/entities.js";

export const PROPOSAL_STATUSES = ["PROPOSED", "APPROVED", "REJECTED"] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export interface KnowledgeProposal {
  id: string;
  organizationId: string;
  projectId: string;
  status: ProposalStatus;
  type: KnowledgeType;
  title: string;
  summary: string;
  content: Record<string, unknown>;
  sourceIds: string[];
  contentHash: string; // SHA-256(type + ":" + title + ":" + summary)
  triggeredBy: "bootstrap" | "incremental" | "manual";
  createdAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  knowledgeItemId: string | null;
}

export function newProposalId(): string {
  return `prop_${ulid()}`;
}
