import { ulid } from "ulid";
import { z } from "zod";

export const KNOWLEDGE_TYPES = [
  "Decision",
  "Concept",
  "Procedure",
  "Troubleshooting",
  "Investigation",
  "Architecture",
  "Fact",
] as const;
export type KnowledgeType = (typeof KNOWLEDGE_TYPES)[number];

export const KNOWLEDGE_STATUSES = [
  "DISCOVERED",
  "PROPOSED",
  "VALIDATING",
  "ACCEPTED",
  "PUBLISHED",
  "UPDATED",
  "STALE",
  "DEPRECATED",
  "REJECTED",
] as const;
export type KnowledgeStatus = (typeof KNOWLEDGE_STATUSES)[number];

export interface KnowledgeItem {
  id: string;
  organizationId: string;
  projectId: string;
  type: KnowledgeType;
  title: string;
  summary: string;
  content: Record<string, unknown>;
  status: KnowledgeStatus;
  version: number;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  lastVerifiedAt: string | null;
}

// Crockford base32 (ULID alphabet): no I, L, O, U.
export const knowledgeIdSchema = z.string().regex(/^know_[0-9A-HJKMNP-TV-Z]{26}$/);

export const knowledgeTypeSchema = z.enum(KNOWLEDGE_TYPES);
export const knowledgeStatusSchema = z.enum(KNOWLEDGE_STATUSES);

const nonEmpty = z.string().trim().min(1);

export const createKnowledgeItemBodySchema = z
  .object({
    projectId: nonEmpty,
    type: knowledgeTypeSchema,
    title: nonEmpty,
    summary: nonEmpty,
    content: z.record(z.unknown()).default({}),
    status: knowledgeStatusSchema.optional(),
  })
  .strict();

export const updateKnowledgeItemBodySchema = z
  .object({
    title: nonEmpty.optional(),
    summary: nonEmpty.optional(),
    content: z.record(z.unknown()).optional(),
    status: knowledgeStatusSchema.optional(),
    changeSummary: z.string().trim().min(1).optional(),
  })
  .strict();

export function newKnowledgeItemId(): string {
  return `know_${ulid()}`;
}
