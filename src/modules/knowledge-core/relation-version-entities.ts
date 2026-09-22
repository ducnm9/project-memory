import { ulid } from "ulid";
import { z } from "zod";
import type { Relation } from "./relation-entities.js";

export interface RelationVersion {
  id: string;
  organizationId: string;
  relationId: string;
  version: number;
  snapshot: Relation;
  changedBy: string;
  changedAt: string;
  changeSummary: string;
}

// Crockford base32 (ULID alphabet): no I, L, O, U.
export const relationVersionIdSchema = z.string().regex(/^rver_[0-9A-HJKMNP-TV-Z]{26}$/);

export function newRelationVersionId(): string {
  return `rver_${ulid()}`;
}
