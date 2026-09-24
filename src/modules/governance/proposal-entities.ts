import { ulid } from "ulid";
import type { KnowledgeType } from "../knowledge-core/entities.js";

export const PROPOSAL_STATUSES = [
  "PROPOSED", "VALIDATING", "ACCEPTED", "PUBLISHED", "REJECTED", "CHANGES_REQUESTED",
] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export interface ValidationResult {
  checkType: "structural" | "duplicate" | "contradiction";
  status: "PASS" | "FAIL" | "WARN";
  message: string;
  details?: unknown;
}

export interface Proposal {
  id: string;
  organizationId: string;
  projectId: string;
  knowledgeItemId: string | null;
  type: KnowledgeType;
  title: string;
  summary: string;
  content: Record<string, unknown>;
  status: ProposalStatus;
  proposedBy: string;
  proposedAt: string;
  validationResults: ValidationResult[];
  reviewedBy: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  changesFeedback: string | null;
  sourceIds: string[];
  contentHash: string;
  triggeredBy: "bootstrap" | "incremental" | "manual";
  createdAt: string;
  updatedAt: string;
}

export function newProposalId(): string {
  return `prop_${ulid()}`;
}
