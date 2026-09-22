import { ulid } from "ulid";
import { z } from "zod";

export const RELATION_PREDICATES = [
  "depends_on", "implemented_by", "defined_by", "related_to",
  "supersedes", "contradicts", "derived_from", "documents",
  "fixes", "impacts", "owned_by",
] as const;
export type RelationPredicate = (typeof RELATION_PREDICATES)[number];

export const RELATION_STATUSES = ["PROPOSED", "ACCEPTED", "REJECTED", "DEPRECATED"] as const;
export type RelationStatus = (typeof RELATION_STATUSES)[number];

export interface Relation {
  id: string;
  organizationId: string;
  projectId: string;
  subjectId: string;
  predicate: RelationPredicate;
  objectId: string;
  status: RelationStatus;
  version: number;
  ownerId: string;
  reviewerId: string | null;
  sourceIds: string[];
  createdAt: string;
  updatedAt: string;
  lastVerifiedAt: string | null;
}

// Crockford base32 (ULID alphabet): no I, L, O, U.
export const relationIdSchema = z.string().regex(/^rel_[0-9A-HJKMNP-TV-Z]{26}$/);
export const relationPredicateSchema = z.enum(RELATION_PREDICATES);
export const relationStatusSchema = z.enum(RELATION_STATUSES);

const nonEmpty = z.string().trim().min(1);

export const createRelationBodySchema = z
  .object({
    projectId: nonEmpty,
    subjectId: nonEmpty,
    predicate: relationPredicateSchema,
    objectId: nonEmpty,
  })
  .strict();

export const updateRelationBodySchema = z
  .object({
    subjectId: nonEmpty.optional(),
    predicate: relationPredicateSchema.optional(),
    objectId: nonEmpty.optional(),
    status: relationStatusSchema.optional(),
    changeSummary: z.string().trim().min(1).optional(),
  })
  .strict();

export function newRelationId(): string {
  return `rel_${ulid()}`;
}
