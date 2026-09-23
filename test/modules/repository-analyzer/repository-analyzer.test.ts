import { describe, it, expect } from "vitest";
import {
  detectLanguages,
  detectApiStyles,
  detectEntryPoints,
  detectModules,
  detectCicd,
  detectInfrastructure,
} from "../../../src/modules/repository-analyzer/repository-analyzer.js";
import type { GitFileEntry } from "../../../src/modules/git-connector/index.js";

const f = (path: string, type: "file" | "directory" = "file"): GitFileEntry => ({
  path, size: 100, type,
});

// ── detectLanguages ────────────────────────────────────────────────────────
describe("detectLanguages", () => {
  it("counts extensions and sorts by frequency", () => {
    const files = [f("a.ts"), f("b.ts"), f("c.py")];
    expect(detectLanguages(files)).toEqual(["TypeScript", "Python"]);
  });

  it("ignores directories", () => {
    const files = [f("src", "directory"), f("src/index.ts")];
    expect(detectLanguages(files)).toEqual(["TypeScript"]);
  });

  it("deduplicates language names (.ts and .tsx both → TypeScript)", () => {
    const files = [f("a.ts"), f("b.tsx")];
    expect(detectLanguages(files)).toEqual(["TypeScript"]);
  });

  it("returns empty for no recognized extensions", () => {
    expect(detectLanguages([f("README.md")])).toEqual([]);
  });

  it("returns empty for empty input", () => {
    expect(detectLanguages([])).toEqual([]);
  });
});

// ── detectApiStyles ────────────────────────────────────────────────────────
describe("detectApiStyles", () => {
  it("detects gRPC from .proto files", () => {
    expect(detectApiStyles([f("proto/service.proto")])).toContain("gRPC");
  });

  it("detects GraphQL from .graphql files", () => {
    expect(detectApiStyles([f("schema.graphql")])).toContain("GraphQL");
  });

  it("detects GraphQL from .gql files", () => {
    expect(detectApiStyles([f("schema.gql")])).toContain("GraphQL");
  });

  it("detects REST from routes/ directory path", () => {
    expect(detectApiStyles([f("src/routes/users.ts")])).toContain("REST");
  });

  it("detects REST from controller file name", () => {
    expect(detectApiStyles([f("src/user.controller.ts")])).toContain("REST");
  });

  it("returns empty for plain source files", () => {
    expect(detectApiStyles([f("src/index.ts")])).toEqual([]);
  });
});

// ── detectEntryPoints ─────────────────────────────────────────────────────
describe("detectEntryPoints", () => {
  it("finds known entry points present in file list", () => {
    const files = [f("src/index.ts"), f("src/app.ts"), f("src/utils.ts")];
    const result = detectEntryPoints(files);
    expect(result).toContain("src/index.ts");
    expect(result).toContain("src/app.ts");
    expect(result).not.toContain("src/utils.ts");
  });

  it("finds Go entry point", () => {
    expect(detectEntryPoints([f("cmd/main.go")])).toContain("cmd/main.go");
  });

  it("finds Python manage.py", () => {
    expect(detectEntryPoints([f("manage.py")])).toContain("manage.py");
  });

  it("returns empty when no known entry points present", () => {
    expect(detectEntryPoints([f("src/utils.ts")])).toEqual([]);
  });
});

// ── detectModules ──────────────────────────────────────────────────────────
describe("detectModules", () => {
  it("returns top-level directories under src/", () => {
    const files = [
      f("src", "directory"),
      f("src/auth", "directory"),
      f("src/users", "directory"),
      f("src/auth/index.ts"),
    ];
    const result = detectModules(files);
    expect(result.map(m => m.name)).toContain("auth");
    expect(result.map(m => m.name)).toContain("users");
  });

  it("ignores node_modules, .git, dist, build, coverage, .github", () => {
    const files = [
      f("node_modules", "directory"),
      f(".git", "directory"),
      f("dist", "directory"),
      f("src/auth", "directory"),
    ];
    const result = detectModules(files);
    expect(result.map(m => m.name)).toEqual(["auth"]);
  });

  it("returns top-level dirs when no src/ exists", () => {
    const files = [
      f("cmd", "directory"),
      f("internal", "directory"),
      f("cmd/main.go"),
    ];
    const result = detectModules(files);
    expect(result.map(m => m.name)).toContain("cmd");
    expect(result.map(m => m.name)).toContain("internal");
  });

  it("returns empty for empty input", () => {
    expect(detectModules([])).toEqual([]);
  });
});

// ── detectCicd ─────────────────────────────────────────────────────────────
describe("detectCicd", () => {
  it("detects GitHub Actions", () => {
    expect(detectCicd([f(".github/workflows/ci.yml")])).toBe("GitHub Actions");
  });

  it("detects Jenkins", () => {
    expect(detectCicd([f("Jenkinsfile")])).toBe("Jenkins");
  });

  it("detects GitLab CI", () => {
    expect(detectCicd([f(".gitlab-ci.yml")])).toBe("GitLab CI");
  });

  it("detects CircleCI", () => {
    expect(detectCicd([f(".circleci/config.yml")])).toBe("CircleCI");
  });

  it("detects Bitbucket Pipelines", () => {
    expect(detectCicd([f("bitbucket-pipelines.yml")])).toBe("Bitbucket Pipelines");
  });

  it("returns null for no CI config", () => {
    expect(detectCicd([f("src/index.ts")])).toBeNull();
  });
});

// ── detectInfrastructure ───────────────────────────────────────────────────
describe("detectInfrastructure", () => {
  it("detects Docker from Dockerfile", () => {
    expect(detectInfrastructure([f("Dockerfile")])).toContain("Docker");
  });

  it("detects Docker from docker-compose.yml", () => {
    expect(detectInfrastructure([f("docker-compose.yml")])).toContain("Docker");
  });

  it("detects Terraform from .tf files", () => {
    expect(detectInfrastructure([f("infra/main.tf")])).toContain("Terraform");
  });

  it("detects Kubernetes from k8s/ directory files", () => {
    expect(detectInfrastructure([f("k8s/deployment.yaml")])).toContain("Kubernetes");
  });

  it("detects Serverless Framework", () => {
    expect(detectInfrastructure([f("serverless.yml")])).toContain("Serverless Framework");
  });

  it("detects AWS CDK from cdk.json", () => {
    expect(detectInfrastructure([f("cdk.json")])).toContain("AWS CDK");
  });

  it("returns empty for plain source files", () => {
    expect(detectInfrastructure([f("src/index.ts")])).toEqual([]);
  });
});
