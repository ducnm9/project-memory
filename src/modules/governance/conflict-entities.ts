import { ulid } from "ulid";

export type ConflictResolution = "KEEP_EXISTING" | "ACCEPT_NEW" | "MERGE";
export type ConflictStatus = "OPEN" | "RESOLVED";

export interface ConflictRecord {
  id: string;
  organizationId: string;
  projectId: string;
  proposalId: string;
  conflictingKnowledgeId: string;
  explanation: string;
  status: ConflictStatus;
  resolution: ConflictResolution | null;
  mergedContent: Record<string, unknown> | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

export function newConflictId(): string {
  return `conf_${ulid()}`;
}
