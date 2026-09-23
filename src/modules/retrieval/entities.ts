import { ulid } from "ulid";
import type { KnowledgeType, KnowledgeStatus } from "../knowledge-core/entities.js";

export interface SearchRecord {
  id: string; // "srec_" + ULID
  knowledgeId: string;
  organizationId: string;
  projectId: string;
  type: KnowledgeType;
  status: KnowledgeStatus;
  title: string;
  searchText: string; // concatenated text fields for full-text index
  tags: string[];
  ownerId: string;
  lastVerifiedAt: string | null;
  updatedAt: string;
}

export function newSearchRecordId(): string {
  return `srec_${ulid()}`;
}
