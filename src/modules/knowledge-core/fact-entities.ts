import { ulid } from "ulid";
import { z } from "zod";

export const FACT_STATUSES = ["PROPOSED", "ACCEPTED", "REJECTED", "DEPRECATED"] as const;
export type FactStatus = (typeof FACT_STATUSES)[number];

export interface Fact {
  id: string;
  organizationId: string;
  projectId: string;
  subjectId: string;
  predicate: string;
  objectId: string;
  status: FactStatus;
  version: number;
  ownerId: string;
  sourceIds: string[];
  createdAt: string;
  updatedAt: string;
  lastVerifiedAt: string | null;
}

// Crockford base32 (ULID alphabet): no I, L, O, U.
export const factIdSchema = z.string().regex(/^fact_[0-9A-HJKMNP-TV-Z]{26}$/);
export const factStatusSchema = z.enum(FACT_STATUSES);

const nonEmpty = z.string().trim().min(1);

export const createFactBodySchema = z
  .object({
    projectId: nonEmpty,
    subjectId: nonEmpty,
    predicate: nonEmpty,
    objectId: nonEmpty,
  })
  .strict();

export const updateFactBodySchema = z
  .object({
    subjectId: nonEmpty.optional(),
    predicate: nonEmpty.optional(),
    objectId: nonEmpty.optional(),
    status: factStatusSchema.optional(),
    changeSummary: z.string().trim().min(1).optional(),
  })
  .strict();

export function newFactId(): string {
  return `fact_${ulid()}`;
}
