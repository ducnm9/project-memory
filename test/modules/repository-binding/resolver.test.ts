import { describe, expect, it, vi } from "vitest";
import { resolveProjectByRepository } from "../../../src/modules/repository-binding/resolver.js";
import type { RepositoryStore } from "../../../src/modules/repository-binding/repository.js";

function storeReturning(binding: unknown) {
  const findActiveByUrl = vi.fn().mockResolvedValue(binding);
  const store = {
    createRepository: vi.fn(),
    findActiveByUrl,
    listActiveByProject: vi.fn(),
    markUnbound: vi.fn(),
  } as unknown as RepositoryStore;
  return { store, findActiveByUrl };
}

describe("resolveProjectByRepository", () => {
  it("resolves a bound url to its project and repository", async () => {
    const { store } = storeReturning({ id: "repo_1", projectId: "proj_P", unboundAt: null });
    await expect(
      resolveProjectByRepository(store, "org_A", "https://github.com/acme/widgets.git"),
    ).resolves.toEqual({ repositoryId: "repo_1", projectId: "proj_P" });
  });

  it("normalizes the incoming url before lookup", async () => {
    const { store, findActiveByUrl } = storeReturning(null);
    await resolveProjectByRepository(store, "org_A", "git@github.com:acme/widgets.git");
    expect(findActiveByUrl).toHaveBeenCalledWith("org_A", "https://github.com/acme/widgets");
  });

  it("scopes the lookup to the organization", async () => {
    const { store, findActiveByUrl } = storeReturning(null);
    await resolveProjectByRepository(store, "org_OTHER", "https://github.com/acme/widgets");
    expect(findActiveByUrl).toHaveBeenCalledWith("org_OTHER", "https://github.com/acme/widgets");
  });

  it("returns null when the repository is not bound", async () => {
    const { store } = storeReturning(null);
    await expect(
      resolveProjectByRepository(store, "org_A", "https://github.com/acme/widgets"),
    ).resolves.toBeNull();
  });

  it("returns null for a malformed url without touching the store", async () => {
    const { store, findActiveByUrl } = storeReturning(null);
    await expect(resolveProjectByRepository(store, "org_A", "not a url")).resolves.toBeNull();
    expect(findActiveByUrl).not.toHaveBeenCalled();
  });
});
