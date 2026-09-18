import { describe, expect, it } from "vitest";
import {
  newRepositoryId,
  repositoryIdSchema,
  connectRepositoryBodySchema,
} from "../../../src/modules/repository-binding/entities.js";

describe("newRepositoryId", () => {
  it("produces a repo_-prefixed id that passes repositoryIdSchema", () => {
    const id = newRepositoryId();
    expect(id).toMatch(/^repo_/);
    expect(repositoryIdSchema.safeParse(id).success).toBe(true);
  });
});

describe("repositoryIdSchema", () => {
  it("rejects a malformed id", () => {
    expect(repositoryIdSchema.safeParse("repo_bad").success).toBe(false);
    expect(repositoryIdSchema.safeParse("proj_x").success).toBe(false);
  });
});

describe("connectRepositoryBodySchema", () => {
  it("accepts a url and trims it", () => {
    const r = connectRepositoryBodySchema.safeParse({ repositoryUrl: "  https://github.com/acme/x  " });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.repositoryUrl).toBe("https://github.com/acme/x");
  });

  it("rejects a missing or empty url", () => {
    expect(connectRepositoryBodySchema.safeParse({}).success).toBe(false);
    expect(connectRepositoryBodySchema.safeParse({ repositoryUrl: " " }).success).toBe(false);
  });

  it("rejects an unknown connector", () => {
    const r = connectRepositoryBodySchema.safeParse({ repositoryUrl: "https://x/y", connector: "svn" });
    expect(r.success).toBe(false);
  });

  it("accepts an optional branch and connector", () => {
    const r = connectRepositoryBodySchema.safeParse({
      repositoryUrl: "https://x/y", defaultBranch: "main", connector: "gitlab",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.defaultBranch).toBe("main");
      expect(r.data.connector).toBe("gitlab");
    }
  });
});
