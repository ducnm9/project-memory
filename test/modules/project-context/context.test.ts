import { describe, expect, it } from "vitest";
import { resolveContext } from "../../../src/modules/project-context/context.js";
import type { ProjectContextRepository } from "../../../src/modules/project-context/repository.js";
import {
  InvalidTenantScopeError,
  TenantNotFoundError,
} from "../../../src/lib/errors.js";
import { newOrgId, newProjectId } from "../../../src/modules/project-context/entities.js";

function repoStub(over: Partial<ProjectContextRepository> = {}): ProjectContextRepository {
  return {
    createOrganization: async () => { throw new Error("unused"); },
    getOrganization: async () => null,
    createProject: async () => { throw new Error("unused"); },
    getProject: async () => null,
    listProjects: async () => [],
    ...over,
  };
}

const orgId = newOrgId();
const projId = newProjectId();

describe("resolveContext", () => {
  it("throws InvalidTenantScopeError when org header is missing", async () => {
    await expect(resolveContext(repoStub(), {})).rejects.toBeInstanceOf(InvalidTenantScopeError);
  });

  it("throws InvalidTenantScopeError when org id is malformed", async () => {
    await expect(resolveContext(repoStub(), { organizationId: "bad" })).rejects.toBeInstanceOf(
      InvalidTenantScopeError,
    );
  });

  it("throws TenantNotFoundError when the org does not exist", async () => {
    const repo = repoStub({ getOrganization: async () => null });
    await expect(resolveContext(repo, { organizationId: orgId })).rejects.toBeInstanceOf(
      TenantNotFoundError,
    );
  });

  it("returns org-shared scope (projectId null) when no project header", async () => {
    const repo = repoStub({ getOrganization: async () => ({ id: orgId, name: "a", createdAt: "", updatedAt: "" }) });
    await expect(resolveContext(repo, { organizationId: orgId })).resolves.toEqual({
      organizationId: orgId,
      projectId: null,
    });
  });

  it("throws TenantNotFoundError when the project is absent or foreign", async () => {
    const repo = repoStub({
      getOrganization: async () => ({ id: orgId, name: "a", createdAt: "", updatedAt: "" }),
      getProject: async () => null,
    });
    await expect(
      resolveContext(repo, { organizationId: orgId, projectId: projId }),
    ).rejects.toBeInstanceOf(TenantNotFoundError);
  });

  it("resolves full project scope when both exist and match", async () => {
    const repo = repoStub({
      getOrganization: async () => ({ id: orgId, name: "a", createdAt: "", updatedAt: "" }),
      getProject: async () => ({ id: projId, organizationId: orgId, name: "p", createdAt: "", updatedAt: "" }),
    });
    await expect(
      resolveContext(repo, { organizationId: orgId, projectId: projId }),
    ).resolves.toEqual({ organizationId: orgId, projectId: projId });
  });
});
