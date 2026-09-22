import { ulid } from "ulid";
import { z } from "zod";

export const SOURCE_TYPES = [
  "repository_file",
  "git_commit",
  "github_pr",
  "github_issue",
  "jira_issue",
  "document",
  "human_input",
  "agent_proposal",
  "runtime_observation",
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export interface Source {
  id: string;
  organizationId: string;
  projectId: string;
  type: SourceType;
  locator: string;
  metadata: Record<string, unknown>;
  createdBy: string;
  createdAt: string;
}

// Crockford base32 (ULID alphabet): no I, L, O, U.
export const sourceIdSchema = z.string().regex(/^src_[0-9A-HJKMNP-TV-Z]{26}$/);
export const sourceTypeSchema = z.enum(SOURCE_TYPES);

const nonEmpty = z.string().trim().min(1);

export const createSourceBodySchema = z
  .object({
    projectId: nonEmpty,
    type: sourceTypeSchema,
    locator: nonEmpty,
    metadata: z.record(z.unknown()).default({}),
  })
  .strict();

export function newSourceId(): string {
  return `src_${ulid()}`;
}
