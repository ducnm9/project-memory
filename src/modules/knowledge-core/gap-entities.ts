import { ulid } from "ulid";
import { z } from "zod";

export const GAP_STATUSES = ["OPEN", "IN_PROGRESS", "RESOLVED"] as const;
export type GapStatus = (typeof GAP_STATUSES)[number];

export interface KnowledgeGap {
  id: string;
  organizationId: string;
  projectId: string;
  question: string;
  occurrenceCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  attemptedSearches: Array<{ searchedAt: string; query: string }>;
  relatedKnowledgeIds: string[];
  ownerId: string | null;
  status: GapStatus;
}

// Crockford base32 (ULID alphabet): no I, L, O, U.
export const gapIdSchema = z.string().regex(/^gap_[0-9A-HJKMNP-TV-Z]{26}$/);
export const gapStatusSchema = z.enum(GAP_STATUSES);

export const updateGapBodySchema = z
  .object({
    ownerId: z.string().nullable().optional(),
    relatedKnowledgeIds: z.array(z.string()).optional(),
    status: gapStatusSchema.optional(),
  })
  .strict();

export function newGapId(): string {
  return `gap_${ulid()}`;
}
