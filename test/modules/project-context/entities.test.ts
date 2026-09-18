import { describe, expect, it } from "vitest";
import {
  createOrgBodySchema,
  createProjectBodySchema,
  newOrgId,
  newProjectId,
  orgIdSchema,
  projectIdSchema,
} from "../../../src/modules/project-context/entities.js";

describe("id generators", () => {
  it("newOrgId is a valid org id", () => {
    expect(orgIdSchema.safeParse(newOrgId()).success).toBe(true);
  });
  it("newProjectId is a valid project id", () => {
    expect(projectIdSchema.safeParse(newProjectId()).success).toBe(true);
  });
  it("orgIdSchema rejects a project id", () => {
    expect(orgIdSchema.safeParse(newProjectId()).success).toBe(false);
  });
});

describe("body schemas", () => {
  it("trims and accepts a non-empty name", () => {
    expect(createOrgBodySchema.parse({ name: "  Acme  " })).toEqual({ name: "Acme" });
    expect(createProjectBodySchema.parse({ name: "svc" })).toEqual({ name: "svc" });
  });
  it("rejects an empty or whitespace name", () => {
    expect(createOrgBodySchema.safeParse({ name: "   " }).success).toBe(false);
    expect(createOrgBodySchema.safeParse({}).success).toBe(false);
  });
});
