import { parseRepositoryUrl } from "./url.js";
import type { RepositoryStore } from "./repository.js";

export interface ResolvedRepository {
  repositoryId: string;
  projectId: string;
}

/**
 * Maps a repository URL to its bound project within one organization.
 * Organization-scoped by construction, and free of HTTP state, so the same
 * function backs the HTTP resolve route and the future MCP `project.resolve`.
 */
export async function resolveProjectByRepository(
  store: RepositoryStore,
  organizationId: string,
  repositoryUrl: string,
): Promise<ResolvedRepository | null> {
  const parsed = parseRepositoryUrl(repositoryUrl);
  if (!parsed) return null;

  const binding = await store.findActiveByUrl(organizationId, parsed.url);
  if (!binding) return null;

  return { repositoryId: binding.id, projectId: binding.projectId };
}
