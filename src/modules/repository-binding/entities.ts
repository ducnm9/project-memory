import { ulid } from "ulid";
import { z } from "zod";

export const REPOSITORY_CONNECTORS = ["github", "gitlab", "bitbucket", "git"] as const;
export type RepositoryConnector = (typeof REPOSITORY_CONNECTORS)[number];

export interface Repository {
  id: string;
  organizationId: string;
  projectId: string;
  url: string;
  host: string;
  path: string;
  connector: RepositoryConnector;
  defaultBranch: string | null;
  createdAt: string;
  createdBy: string;
  unboundAt: string | null;
}

// Crockford base32 (ULID alphabet): no I, L, O, U.
export const repositoryIdSchema = z.string().regex(/^repo_[0-9A-HJKMNP-TV-Z]{26}$/);

export const connectorSchema = z.enum(REPOSITORY_CONNECTORS);

const nonEmpty = z.string().trim().min(1);

export const connectRepositoryBodySchema = z.object({
  repositoryUrl: nonEmpty,
  defaultBranch: nonEmpty.optional(),
  connector: connectorSchema.optional(),
});

export function newRepositoryId(): string {
  return `repo_${ulid()}`;
}
