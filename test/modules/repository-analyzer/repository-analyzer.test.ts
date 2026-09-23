import { describe, it, expect } from "vitest";
import {
  detectLanguages,
  detectApiStyles,
  detectEntryPoints,
  detectModules,
  detectCicd,
  detectInfrastructure,
  detectFrameworks,
  detectBuildSystem,
  detectTestFrameworks,
  detectDatabases,
  detectIntegrations,
  detectMonorepo,
  RepositoryAnalyzer,
} from "../../../src/modules/repository-analyzer/repository-analyzer.js";
import type { RepositoryInput, LLMAssistant } from "../../../src/modules/repository-analyzer/entities.js";
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

// ── detectFrameworks ───────────────────────────────────────────────────────
describe("detectFrameworks", () => {
  it("detects Fastify from package.json dependencies", () => {
    const manifests = {
      "package.json": JSON.stringify({ dependencies: { fastify: "5.0" } }),
    };
    expect(detectFrameworks(manifests)).toContain("Fastify");
  });

  it("detects React from devDependencies", () => {
    const manifests = {
      "package.json": JSON.stringify({ devDependencies: { react: "18.0" } }),
    };
    expect(detectFrameworks(manifests)).toContain("React");
  });

  it("detects FastAPI from requirements.txt", () => {
    const manifests = { "requirements.txt": "fastapi==0.110.0\nuvicorn\n" };
    expect(detectFrameworks(manifests)).toContain("FastAPI");
  });

  it("detects SQLAlchemy from requirements.txt", () => {
    const manifests = { "requirements.txt": "sqlalchemy==2.0.0\n" };
    expect(detectFrameworks(manifests)).toContain("SQLAlchemy");
  });

  it("detects Spring Boot from pom.xml", () => {
    const manifests = { "pom.xml": "<artifactId>spring-boot-starter-web</artifactId>" };
    expect(detectFrameworks(manifests)).toContain("Spring Boot");
  });

  it("detects Gin from go.mod", () => {
    const manifests = { "go.mod": "require github.com/gin-gonic/gin v1.9.0" };
    expect(detectFrameworks(manifests)).toContain("Gin");
  });

  it("returns empty for missing manifests", () => {
    expect(detectFrameworks({})).toEqual([]);
  });

  it("returns empty for invalid JSON in package.json without throwing", () => {
    const manifests = { "package.json": "not valid json" };
    expect(() => detectFrameworks(manifests)).not.toThrow();
    expect(detectFrameworks(manifests)).toEqual([]);
  });
});

// ── detectBuildSystem ──────────────────────────────────────────────────────
describe("detectBuildSystem", () => {
  it("returns npm when package.json exists", () => {
    const files = [f("package.json")];
    expect(detectBuildSystem(files, { "package.json": "{}" })).toBe("npm");
  });

  it("returns maven when pom.xml exists", () => {
    const files = [f("pom.xml")];
    expect(detectBuildSystem(files, {})).toBe("maven");
  });

  it("returns gradle when build.gradle exists", () => {
    const files = [f("build.gradle")];
    expect(detectBuildSystem(files, {})).toBe("gradle");
  });

  it("returns make when only Makefile exists", () => {
    const files = [f("Makefile")];
    expect(detectBuildSystem(files, {})).toBe("make");
  });

  it("returns go when only go.mod exists", () => {
    const files = [f("go.mod")];
    expect(detectBuildSystem(files, {})).toBe("go");
  });

  it("returns cargo when only Cargo.toml exists", () => {
    const files = [f("Cargo.toml")];
    expect(detectBuildSystem(files, {})).toBe("cargo");
  });

  it("returns null for empty repo", () => {
    expect(detectBuildSystem([], {})).toBeNull();
  });

  it("prefers npm over make when both present", () => {
    const files = [f("package.json"), f("Makefile")];
    expect(detectBuildSystem(files, {})).toBe("npm");
  });
});

// ── detectTestFrameworks ───────────────────────────────────────────────────
describe("detectTestFrameworks", () => {
  it("detects Vitest from devDependencies", () => {
    const manifests = { "package.json": JSON.stringify({ devDependencies: { vitest: "2.0" } }) };
    expect(detectTestFrameworks([], manifests)).toContain("Vitest");
  });

  it("detects Jest from devDependencies", () => {
    const manifests = { "package.json": JSON.stringify({ devDependencies: { jest: "29.0" } }) };
    expect(detectTestFrameworks([], manifests)).toContain("Jest");
  });

  it("detects pytest from pytest.ini file", () => {
    expect(detectTestFrameworks([f("pytest.ini")], {})).toContain("pytest");
  });

  it("detects JUnit from pom.xml content", () => {
    const manifests = { "pom.xml": "<artifactId>junit-jupiter</artifactId>" };
    expect(detectTestFrameworks([], manifests)).toContain("JUnit");
  });

  it("returns empty for no test signals", () => {
    expect(detectTestFrameworks([], {})).toEqual([]);
  });
});

// ── detectDatabases ────────────────────────────────────────────────────────
describe("detectDatabases", () => {
  it("detects MongoDB from package.json", () => {
    const manifests = { "package.json": JSON.stringify({ dependencies: { mongodb: "7.0" } }) };
    expect(detectDatabases(manifests)).toContain("MongoDB");
  });

  it("detects PostgreSQL from pg package", () => {
    const manifests = { "package.json": JSON.stringify({ dependencies: { pg: "8.0" } }) };
    expect(detectDatabases(manifests)).toContain("PostgreSQL");
  });

  it("detects Redis from ioredis package", () => {
    const manifests = { "package.json": JSON.stringify({ dependencies: { ioredis: "5.0" } }) };
    expect(detectDatabases(manifests)).toContain("Redis");
  });

  it("detects PostgreSQL from requirements.txt", () => {
    const manifests = { "requirements.txt": "psycopg2==2.9.0\n" };
    expect(detectDatabases(manifests)).toContain("PostgreSQL");
  });

  it("returns empty for no database signals", () => {
    expect(detectDatabases({})).toEqual([]);
  });
});

// ── detectIntegrations ─────────────────────────────────────────────────────
describe("detectIntegrations", () => {
  it("detects stripe", () => {
    const manifests = { "package.json": JSON.stringify({ dependencies: { stripe: "14.0" } }) };
    expect(detectIntegrations(manifests)).toContain("stripe");
  });

  it("detects @aws-sdk/ scoped packages", () => {
    const manifests = { "package.json": JSON.stringify({ dependencies: { "@aws-sdk/client-s3": "3.0" } }) };
    expect(detectIntegrations(manifests)).toContain("aws-sdk");
  });

  it("detects openai", () => {
    const manifests = { "package.json": JSON.stringify({ dependencies: { openai: "4.0" } }) };
    expect(detectIntegrations(manifests)).toContain("openai");
  });

  it("detects sentry from requirements.txt", () => {
    const manifests = { "requirements.txt": "sentry-sdk==1.0.0\n" };
    expect(detectIntegrations(manifests)).toContain("sentry");
  });

  it("returns empty for no known integration signals", () => {
    expect(detectIntegrations({})).toEqual([]);
  });

  it("does not match stripe-mock as stripe integration", () => {
    const manifests = { "package.json": JSON.stringify({ dependencies: { "stripe-mock": "1.0" } }) };
    expect(detectIntegrations(manifests)).not.toContain("stripe");
  });
});

// ── detectMonorepo ─────────────────────────────────────────────────────────
describe("detectMonorepo", () => {
  it("returns true for multiple package.json in different dirs", () => {
    const files = [
      f("package.json"), f("packages/app/package.json"), f("packages/lib/package.json"),
    ];
    expect(detectMonorepo(files, {})).toBe(true);
  });

  it("returns true when pnpm-workspace.yaml exists", () => {
    expect(detectMonorepo([f("pnpm-workspace.yaml")], {})).toBe(true);
  });

  it("returns true when lerna.json exists", () => {
    expect(detectMonorepo([f("lerna.json")], {})).toBe(true);
  });

  it("returns true for multiple go.mod files", () => {
    const files = [f("go.mod"), f("internal/service/go.mod")];
    expect(detectMonorepo(files, {})).toBe(true);
  });

  it("returns false for single package.json", () => {
    const files = [f("package.json"), f("src/index.ts")];
    expect(detectMonorepo(files, {})).toBe(false);
  });

  it("returns false for empty repo", () => {
    expect(detectMonorepo([], {})).toBe(false);
  });
});

function makeInput(
  files: GitFileEntry[],
  fileContents: Record<string, string> = {}
): RepositoryInput {
  return {
    files,
    readFile: async (p) => fileContents[p] ?? null,
  };
}

// ── RepositoryAnalyzer ─────────────────────────────────────────────────────
describe("RepositoryAnalyzer", () => {
  describe("Node/TypeScript repo (acceptance criteria)", () => {
    it("correctly identifies language, framework, test system, and CI", async () => {
      const analyzer = new RepositoryAnalyzer();
      const input = makeInput(
        [
          f("package.json"),
          f("src/index.ts"),
          f("src/server.ts"),
          f("vitest.config.ts"),
          f(".github/workflows/ci.yml"),
          f("src", "directory"),
        ],
        {
          "package.json": JSON.stringify({
            dependencies: { fastify: "5.0" },
            devDependencies: { vitest: "2.0", typescript: "5.0" },
          }),
        }
      );
      const snapshot = await analyzer.analyze(input);
      expect(snapshot.languages).toContain("TypeScript");
      expect(snapshot.frameworks).toContain("Fastify");
      expect(snapshot.testFrameworks).toContain("Vitest");
      expect(snapshot.buildSystem).toBe("npm");
      expect(snapshot.cicd).toBe("GitHub Actions");
      expect(snapshot.analyzedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  describe("Python/FastAPI repo (acceptance criteria)", () => {
    it("correctly identifies language, framework, test system, and infra", async () => {
      const analyzer = new RepositoryAnalyzer();
      const input = makeInput(
        [
          f("requirements.txt"),
          f("app/main.py"),
          f("pytest.ini"),
          f("Dockerfile"),
        ],
        { "requirements.txt": "fastapi==0.110.0\nuvicorn==0.27.0\nsqlalchemy==2.0.0\n" }
      );
      const snapshot = await analyzer.analyze(input);
      expect(snapshot.languages).toContain("Python");
      expect(snapshot.frameworks).toContain("FastAPI");
      expect(snapshot.frameworks).toContain("SQLAlchemy");
      expect(snapshot.testFrameworks).toContain("pytest");
      expect(snapshot.infrastructure).toContain("Docker");
    });
  });

  describe("Java/Maven repo (acceptance criteria)", () => {
    it("correctly identifies language, framework, test system", async () => {
      const analyzer = new RepositoryAnalyzer();
      const input = makeInput(
        [
          f("pom.xml"),
          f("src/main/java/com/example/App.java"),
          f("src/test/java/com/example/AppTest.java"),
        ],
        { "pom.xml": "<project><artifactId>spring-boot-starter-web</artifactId><artifactId>junit-jupiter</artifactId></project>" }
      );
      const snapshot = await analyzer.analyze(input);
      expect(snapshot.languages).toContain("Java");
      expect(snapshot.frameworks).toContain("Spring Boot");
      expect(snapshot.testFrameworks).toContain("JUnit");
      expect(snapshot.buildSystem).toBe("maven");
    });
  });

  describe("edge cases", () => {
    it("returns empty snapshot for empty repo without throwing", async () => {
      const analyzer = new RepositoryAnalyzer();
      const snapshot = await analyzer.analyze(makeInput([]));
      expect(snapshot.languages).toEqual([]);
      expect(snapshot.frameworks).toEqual([]);
      expect(snapshot.buildSystem).toBeNull();
      expect(snapshot.isMonorepo).toBe(false);
    });

    it("handles readFile always returning null without throwing", async () => {
      const analyzer = new RepositoryAnalyzer();
      const input = makeInput([f("package.json")]);
      await expect(analyzer.analyze(input)).resolves.toBeDefined();
    });

    it("detects monorepo with two package.json files", async () => {
      const analyzer = new RepositoryAnalyzer();
      const input = makeInput([
        f("package.json"),
        f("packages/app/package.json"),
        f("packages/lib/package.json"),
      ]);
      const snapshot = await analyzer.analyze(input);
      expect(snapshot.isMonorepo).toBe(true);
    });

    it("calls LLM for module responsibility when injected", async () => {
      const mockLlm: LLMAssistant = {
        inferModuleResponsibility: async (name) => `Handles ${name} logic`,
      };
      const analyzer = new RepositoryAnalyzer(mockLlm);
      const input = makeInput([
        f("src", "directory"),
        f("src/auth", "directory"),
        f("src/auth/index.ts"),
      ]);
      const snapshot = await analyzer.analyze(input);
      const authModule = snapshot.modules.find(m => m.name === "auth");
      expect(authModule?.responsibility).toBe("Handles auth logic");
    });

    it("does not fail when LLM throws", async () => {
      const faultyLlm: LLMAssistant = {
        inferModuleResponsibility: async () => { throw new Error("LLM unavailable"); },
      };
      const analyzer = new RepositoryAnalyzer(faultyLlm);
      const input = makeInput([
        f("src", "directory"),
        f("src/auth", "directory"),
      ]);
      const snapshot = await analyzer.analyze(input);
      expect(snapshot.modules[0].responsibility).toBeUndefined();
    });

    it("detects GraphQL from graphql dep when no .graphql files present", async () => {
      const analyzer = new RepositoryAnalyzer();
      const input = makeInput(
        [f("src/index.ts")],
        { "package.json": JSON.stringify({ dependencies: { graphql: "16.0", "@apollo/server": "4.0" } }) }
      );
      const snapshot = await analyzer.analyze(input);
      expect(snapshot.apiStyles).toContain("GraphQL");
    });
  });
});
