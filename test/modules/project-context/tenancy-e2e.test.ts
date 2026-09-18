import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createRepository } from "../../../src/modules/project-context/repository.js";
import { resolveContext } from "../../../src/modules/project-context/context.js";
import { scopedCollection } from "../../../src/lib/scoped-collection.js";
import { newOrgId, newProjectId } from "../../../src/modules/project-context/entities.js";

const orgId = newOrgId();
const projId = newProjectId();

describe("header -> context -> scoped access", () => {
  it("resolves a project scope and applies it to a scoped read", async () => {
    const find = vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) });
    const db = {
      collection: (name: string) => {
        if (name === "organizations") return { findOne: async () => ({ id: orgId, name: "a", createdAt: "", updatedAt: "" }) };
        if (name === "projects") return { findOne: async () => ({ id: projId, organizationId: orgId, name: "p", createdAt: "", updatedAt: "" }) };
        return { find };
      },
    } as unknown as Db;

    const ctx = await resolveContext(createRepository(db), { organizationId: orgId, projectId: projId });
    scopedCollection(db, "knowledge_items", ctx).find({ type: "Decision" });

    expect(find).toHaveBeenCalledWith({
      type: "Decision",
      organizationId: orgId,
      projectId: { $in: [projId, null] },
    });
  });
});
