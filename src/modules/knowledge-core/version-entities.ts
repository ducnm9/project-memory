import { ulid } from "ulid";
import { z } from "zod";
import type { KnowledgeItem } from "./entities.js";

export interface KnowledgeVersion {
  id: string;
  organizationId: string;
  knowledgeId: string;
  version: number;
  snapshot: KnowledgeItem;
  changedBy: string;
  changedAt: string;
  changeSummary: string;
}

// Crockford base32 (ULID alphabet): no I, L, O, U.
export const knowledgeVersionIdSchema = z
  .string()
  .regex(/^kver_[0-9A-HJKMNP-TV-Z]{26}$/);

export function newKnowledgeVersionId(): string {
  return `kver_${ulid()}`;
}
