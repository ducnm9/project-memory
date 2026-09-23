# Repository Analyzer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a `repository-analyzer` module that inspects a repository's file tree and manifest contents using pure heuristic detectors, producing a `ProjectSnapshot` of its technology stack.

**Architecture:** Single `src/modules/repository-analyzer/` module. Pure detector functions are exported individually for isolated testing. `RepositoryAnalyzer` class orchestrates manifest reading, calls detectors, and optionally invokes an injected `LLMAssistant` interface for module responsibility inference. No I/O outside of `RepositoryInput.readFile`.

**Tech Stack:** TypeScript 5.6, Node.js ≥ 20.19 (ESM), Vitest 2.1. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-23-repository-analyzer-design.md`

## Global Constraints

- ESM project (`"type": "module"` in package.json) — all imports must use `.js` extension
- All dates: ISO 8601 strings via `new Date().toISOString()`
- Test runner: `npm test` (runs `vitest run`); typecheck: `npm run typecheck`
- No new npm dependencies — stdlib and existing packages only
- Pure functions must not import or call anything with I/O side-effects
- `GitFileEntry` is imported from `../git-connector/index.js` — do not redefine it

---

### Task 1: Define types in `entities.ts`

**Files:**
- Create: `src/modules/repository-analyzer/entities.ts`

**Interfaces:**
- Produces: `RepositoryInput`, `LLMAssistant`, `ProjectModule`, `ProjectSnapshot` — used by all subsequent tasks

- [ ] **Step 1: Create `src/modules/repository-analyzer/entities.ts`**

```ts
import type { GitFileEntry } from "../git-connector/index.js";

export interface RepositoryInput {
  files: GitFileEntry[];
  readFile(path: string): Promise<string | null>;
}

export interface LLMAssistant {
  inferModuleResponsibility(
    name: string,
    sampleFiles: string[]
  ): Promise<string | null>;
}

export interface ProjectModule {
  name: string;
  path: string;
  responsibility?: string;
}

export interface ProjectSnapshot {
  analyzedAt: string;          // ISO 8601
  languages: string[];         // e.g. ["TypeScript", "Python"]
  frameworks: string[];        // e.g. ["Fastify", "React"]
  buildSystem: string | null;  // e.g. "npm" | "gradle" | null
  testFrameworks: string[];    // e.g. ["Vitest", "pytest"]
  databases: string[];         // e.g. ["MongoDB", "PostgreSQL"]
  apiStyles: string[];         // e.g. ["REST", "GraphQL", "gRPC"]
  entryPoints: string[];       // e.g. ["src/index.ts"]
  modules: ProjectModule[];
  cicd: string | null;         // e.g. "GitHub Actions" | null
  infrastructure: string[];    // e.g. ["Docker", "Terraform"]
  integrations: string[];      // e.g. ["stripe", "aws-sdk"]
  isMonorepo: boolean;
}
```

- [ ] **Step 2: Run typecheck to verify no errors**

```bash
npm run typecheck
```

Expected: exits 0, no errors.

- [ ] **Step 3: Commit**

```bash
git add src/modules/repository-analyzer/entities.ts
git commit -m "feat(repository-analyzer): add ProjectSnapshot and RepositoryInput types"
```

---

### Task 2: Path-based detector functions

These detectors work only from `GitFileEntry[]` — no file reads needed.

**Files:**
- Create: `src/modules/repository-analyzer/repository-analyzer.ts` (partial — detectors only, no class yet)
- Create: `test/modules/repository-analyzer/repository-analyzer.test.ts` (partial — detector tests only)

**Interfaces:**
- Consumes: `GitFileEntry` from `../git-connector/index.js`
- Produces (exported):
  - `detectLanguages(files: GitFileEntry[]): string[]`
  - `detectApiStyles(files: GitFileEntry[]): string[]`
  - `detectEntryPoints(files: GitFileEntry[]): string[]`
  - `detectModules(files: GitFileEntry[]): Array<{name: string; path: string}>`
  - `detectCicd(files: GitFileEntry[]): string | null`
  - `detectInfrastructure(files: GitFileEntry[]): string[]`

- [ ] **Step 1: Write failing tests**

Create `test/modules/repository-analyzer/repository-analyzer.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  detectLanguages,
  detectApiStyles,
  detectEntryPoints,
  detectModules,
  detectCicd,
  detectInfrastructure,
} from "../../src/modules/repository-analyzer/repository-analyzer.js";
import type { GitFileEntry } from "../../src/modules/git-connector/index.js";

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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- repository-analyzer
```

Expected: all tests fail with import errors or "not a function".

- [ ] **Step 3: Implement path-based detectors**

Create `src/modules/repository-analyzer/repository-analyzer.ts` with this content (class will be added in Task 4):

```ts
import { extname } from "node:path";
import type { GitFileEntry } from "../git-connector/index.js";
import type { LLMAssistant, ProjectModule, ProjectSnapshot, RepositoryInput } from "./entities.js";

// ── Language detection ────────────────────────────────────────────────────

const EXT_TO_LANG: Record<string, string> = {
  ".ts": "TypeScript", ".tsx": "TypeScript",
  ".js": "JavaScript", ".mjs": "JavaScript", ".cjs": "JavaScript",
  ".py": "Python",
  ".java": "Java",
  ".go": "Go",
  ".rs": "Rust",
  ".rb": "Ruby",
  ".cs": "C#",
};

export function detectLanguages(files: GitFileEntry[]): string[] {
  const counts = new Map<string, number>();
  for (const f of files) {
    if (f.type !== "file") continue;
    const lang = EXT_TO_LANG[extname(f.path)];
    if (lang) counts.set(lang, (counts.get(lang) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([lang]) => lang);
}

// ── API style detection ───────────────────────────────────────────────────

export function detectApiStyles(files: GitFileEntry[]): string[] {
  const styles = new Set<string>();
  const paths = files.filter(f => f.type === "file").map(f => f.path);
  if (paths.some(p => p.endsWith(".proto"))) styles.add("gRPC");
  if (paths.some(p => p.endsWith(".graphql") || p.endsWith(".gql"))) styles.add("GraphQL");
  if (paths.some(p => /controller|router|\/routes\//i.test(p))) styles.add("REST");
  return [...styles];
}

// ── Entry point detection ─────────────────────────────────────────────────

const KNOWN_ENTRY_POINTS = [
  "src/index.ts", "src/index.js", "src/main.ts", "src/main.js",
  "src/server.ts", "src/app.ts", "index.ts", "index.js",
  "main.go", "cmd/main.go", "app.py", "main.py", "manage.py",
];

export function detectEntryPoints(files: GitFileEntry[]): string[] {
  const filePaths = new Set(files.filter(f => f.type === "file").map(f => f.path));
  return KNOWN_ENTRY_POINTS.filter(p => filePaths.has(p));
}

// ── Module detection ──────────────────────────────────────────────────────

const IGNORED_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "coverage", ".github",
]);

export function detectModules(files: GitFileEntry[]): Array<{name: string; path: string}> {
  const hasSrc = files.some(f => f.path === "src" || f.path.startsWith("src/"));
  return files
    .filter(f => {
      if (f.type !== "directory") return false;
      const parts = f.path.split("/");
      if (IGNORED_DIRS.has(parts[0])) return false;
      if (hasSrc) return parts.length === 2 && parts[0] === "src";
      return parts.length === 1;
    })
    .map(f => ({ name: f.path.split("/").pop()!, path: f.path }));
}

// ── CI/CD detection ───────────────────────────────────────────────────────

export function detectCicd(files: GitFileEntry[]): string | null {
  const paths = files.map(f => f.path);
  if (paths.some(p => p.startsWith(".github/workflows/"))) return "GitHub Actions";
  if (paths.includes("Jenkinsfile")) return "Jenkins";
  if (paths.includes(".gitlab-ci.yml")) return "GitLab CI";
  if (paths.some(p => p.startsWith(".circleci/"))) return "CircleCI";
  if (paths.includes("bitbucket-pipelines.yml")) return "Bitbucket Pipelines";
  return null;
}

// ── Infrastructure detection ──────────────────────────────────────────────

export function detectInfrastructure(files: GitFileEntry[]): string[] {
  const paths = files.filter(f => f.type === "file").map(f => f.path);
  const infra = new Set<string>();
  if (paths.some(p => p === "Dockerfile" || p.startsWith("docker-compose"))) infra.add("Docker");
  if (paths.some(p => p.endsWith(".tf"))) infra.add("Terraform");
  if (paths.some(p => p.startsWith("k8s/") || p.startsWith("kubernetes/"))) infra.add("Kubernetes");
  if (paths.includes("serverless.yml")) infra.add("Serverless Framework");
  if (paths.includes("cdk.json")) infra.add("AWS CDK");
  return [...infra];
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- repository-analyzer
```

Expected: all detector tests pass.

- [ ] **Step 5: Run typecheck**

```bash
npm run typecheck
```

Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add src/modules/repository-analyzer/repository-analyzer.ts \
        test/modules/repository-analyzer/repository-analyzer.test.ts
git commit -m "feat(repository-analyzer): add path-based detector functions"
```

---

### Task 3: Manifest-based detector functions

**Files:**
- Modify: `src/modules/repository-analyzer/repository-analyzer.ts` (append functions)
- Modify: `test/modules/repository-analyzer/repository-analyzer.test.ts` (append tests)

**Interfaces:**
- Consumes: `manifests: Record<string, string | null>` (pre-read manifest contents keyed by relative path)
- Produces (exported):
  - `detectFrameworks(manifests: Record<string, string | null>): string[]`
  - `detectBuildSystem(files: GitFileEntry[], manifests: Record<string, string | null>): string | null`
  - `detectTestFrameworks(files: GitFileEntry[], manifests: Record<string, string | null>): string[]`
  - `detectDatabases(manifests: Record<string, string | null>): string[]`
  - `detectIntegrations(manifests: Record<string, string | null>): string[]`
  - `detectMonorepo(files: GitFileEntry[], manifests: Record<string, string | null>): boolean`

- [ ] **Step 1: Append failing tests to the test file**

Append to `test/modules/repository-analyzer/repository-analyzer.test.ts`:

```ts
import {
  detectFrameworks,
  detectBuildSystem,
  detectTestFrameworks,
  detectDatabases,
  detectIntegrations,
  detectMonorepo,
} from "../../src/modules/repository-analyzer/repository-analyzer.js";

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
```

- [ ] **Step 2: Run tests to verify new ones fail**

```bash
npm test -- repository-analyzer
```

Expected: new tests fail with import errors; prior tests still pass.

- [ ] **Step 3: Append manifest-based detectors to `repository-analyzer.ts`**

Append to `src/modules/repository-analyzer/repository-analyzer.ts`:

```ts
// ── Manifest-based detectors ──────────────────────────────────────────────

type Manifests = Record<string, string | null>;

function parsePkgJson(manifests: Manifests): Record<string, string> {
  const raw = manifests["package.json"];
  if (!raw) return {};
  try {
    const pkg = JSON.parse(raw) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    return { ...pkg.dependencies, ...pkg.devDependencies };
  } catch {
    return {};
  }
}

const PKG_FRAMEWORK_MAP: Array<[string, string]> = [
  ["fastify", "Fastify"], ["express", "Express"], ["react", "React"],
  ["next", "Next.js"], ["vue", "Vue"], ["@nestjs/core", "NestJS"],
];

const PYTHON_FRAMEWORK_MAP: Array<[string, string]> = [
  ["fastapi", "FastAPI"], ["django", "Django"], ["flask", "Flask"],
  ["sqlalchemy", "SQLAlchemy"],
];

const GO_FRAMEWORK_MAP: Array<[string, string]> = [
  ["gin-gonic/gin", "Gin"], ["labstack/echo", "Echo"], ["gofiber/fiber", "Fiber"],
];

export function detectFrameworks(manifests: Manifests): string[] {
  const out = new Set<string>();
  const deps = parsePkgJson(manifests);
  for (const [key, name] of PKG_FRAMEWORK_MAP) {
    if (key in deps) out.add(name);
  }
  const reqs = manifests["requirements.txt"];
  if (reqs) {
    const lower = reqs.toLowerCase();
    for (const [key, name] of PYTHON_FRAMEWORK_MAP) {
      if (lower.includes(key)) out.add(name);
    }
  }
  const goMod = manifests["go.mod"];
  if (goMod) {
    for (const [key, name] of GO_FRAMEWORK_MAP) {
      if (goMod.includes(key)) out.add(name);
    }
  }
  const jvmManifest = manifests["pom.xml"] ?? manifests["build.gradle"];
  if (jvmManifest) {
    if (jvmManifest.includes("spring-boot")) out.add("Spring Boot");
    if (jvmManifest.includes("quarkus")) out.add("Quarkus");
  }
  return [...out];
}

const BUILD_PRECEDENCE: Array<[string, string]> = [
  ["package.json", "npm"], ["pom.xml", "maven"], ["build.gradle", "gradle"],
  ["Makefile", "make"], ["go.mod", "go"], ["Cargo.toml", "cargo"],
];

export function detectBuildSystem(files: GitFileEntry[], _manifests: Manifests): string | null {
  const filePaths = new Set(files.map(f => f.path));
  for (const [name, system] of BUILD_PRECEDENCE) {
    if (filePaths.has(name)) return system;
  }
  return null;
}

export function detectTestFrameworks(files: GitFileEntry[], manifests: Manifests): string[] {
  const out = new Set<string>();
  const deps = parsePkgJson(manifests);
  if ("vitest" in deps) out.add("Vitest");
  if ("jest" in deps) out.add("Jest");
  if ("mocha" in deps) out.add("Mocha");
  const filePaths = files.map(f => f.path);
  if (filePaths.some(p => p === "pytest.ini" || p === "setup.cfg")) out.add("pytest");
  const pyproject = manifests["pyproject.toml"];
  if (pyproject?.includes("[tool.pytest")) out.add("pytest");
  const jvmManifest = manifests["pom.xml"] ?? manifests["build.gradle"];
  if (jvmManifest?.includes("junit")) out.add("JUnit");
  return [...out];
}

const PKG_DB_MAP: Array<[string, string]> = [
  ["mongodb", "MongoDB"], ["mongoose", "MongoDB"],
  ["pg", "PostgreSQL"], ["postgres", "PostgreSQL"], ["postgresql", "PostgreSQL"],
  ["mysql", "MySQL"], ["mysql2", "MySQL"],
  ["redis", "Redis"], ["ioredis", "Redis"],
  ["sqlite", "SQLite"], ["better-sqlite3", "SQLite"],
];

const PYTHON_DB_MAP: Array<[string, string]> = [
  ["psycopg2", "PostgreSQL"], ["asyncpg", "PostgreSQL"],
  ["pymongo", "MongoDB"],
  ["redis", "Redis"],
  ["mysql-connector", "MySQL"], ["pymysql", "MySQL"],
];

export function detectDatabases(manifests: Manifests): string[] {
  const out = new Set<string>();
  const deps = parsePkgJson(manifests);
  for (const [key, name] of PKG_DB_MAP) {
    if (key in deps) out.add(name);
  }
  const reqs = manifests["requirements.txt"];
  if (reqs) {
    const lower = reqs.toLowerCase();
    for (const [key, name] of PYTHON_DB_MAP) {
      if (lower.includes(key)) out.add(name);
    }
  }
  return [...out];
}

const INTEGRATION_KEYWORDS: Array<[string, string]> = [
  ["stripe", "stripe"], ["twilio", "twilio"],
  ["@sendgrid/", "sendgrid"], ["sendgrid", "sendgrid"],
  ["aws-sdk", "aws-sdk"], ["@aws-sdk/", "aws-sdk"],
  ["firebase", "firebase"], ["supabase", "supabase"],
  ["auth0", "auth0"], ["datadog", "datadog"],
  ["sentry", "sentry"], ["openai", "openai"],
  ["anthropic", "anthropic"], ["langchain", "langchain"],
];

export function detectIntegrations(manifests: Manifests): string[] {
  const out = new Set<string>();
  const deps = parsePkgJson(manifests);
  for (const [key, label] of INTEGRATION_KEYWORDS) {
    if (Object.keys(deps).some(d => d.startsWith(key) || d === key)) out.add(label);
  }
  const reqs = manifests["requirements.txt"];
  if (reqs) {
    const lower = reqs.toLowerCase();
    for (const [key, label] of INTEGRATION_KEYWORDS) {
      if (lower.includes(key.replace("@", "").replace("/", "-"))) out.add(label);
    }
  }
  return [...out];
}

const MONOREPO_SIGNALS = ["pnpm-workspace.yaml", "lerna.json"];
const MULTI_ROOT_FILES = ["package.json", "pom.xml", "go.mod"];

export function detectMonorepo(files: GitFileEntry[], _manifests: Manifests): boolean {
  const filePaths = files.filter(f => f.type === "file").map(f => f.path);
  if (MONOREPO_SIGNALS.some(s => filePaths.includes(s))) return true;
  for (const name of MULTI_ROOT_FILES) {
    const matches = filePaths.filter(p => p === name || p.endsWith(`/${name}`));
    if (matches.length > 1) return true;
  }
  return false;
}
```

- [ ] **Step 4: Run all tests**

```bash
npm test -- repository-analyzer
```

Expected: all tests pass.

- [ ] **Step 5: Run typecheck**

```bash
npm run typecheck
```

Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add src/modules/repository-analyzer/repository-analyzer.ts \
        test/modules/repository-analyzer/repository-analyzer.test.ts
git commit -m "feat(repository-analyzer): add manifest-based detector functions"
```

---

### Task 4: RepositoryAnalyzer class + integration tests

**Files:**
- Modify: `src/modules/repository-analyzer/repository-analyzer.ts` (append class)
- Modify: `test/modules/repository-analyzer/repository-analyzer.test.ts` (append integration tests)

**Interfaces:**
- Consumes: all detector functions from Tasks 2–3; `RepositoryInput`, `LLMAssistant`, `ProjectSnapshot` from `entities.ts`
- Produces: `RepositoryAnalyzer` class with `analyze(input: RepositoryInput): Promise<ProjectSnapshot>`

- [ ] **Step 1: Append integration tests to the test file**

Append to `test/modules/repository-analyzer/repository-analyzer.test.ts`:

```ts
import { RepositoryAnalyzer } from "../../src/modules/repository-analyzer/repository-analyzer.js";
import type { RepositoryInput, LLMAssistant } from "../../src/modules/repository-analyzer/entities.js";

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
  });
});
```

- [ ] **Step 2: Run tests to verify new ones fail**

```bash
npm test -- repository-analyzer
```

Expected: integration tests fail ("RepositoryAnalyzer is not a constructor"); prior tests still pass.

- [ ] **Step 3: Append RepositoryAnalyzer class to `repository-analyzer.ts`**

Append to `src/modules/repository-analyzer/repository-analyzer.ts`:

```ts
const MANIFEST_PATHS = [
  "package.json", "requirements.txt", "go.mod", "pom.xml",
  "build.gradle", "Cargo.toml", "pyproject.toml",
];

export class RepositoryAnalyzer {
  constructor(private readonly llm: LLMAssistant | null = null) {}

  async analyze(input: RepositoryInput): Promise<ProjectSnapshot> {
    // Read all manifests in parallel; null on any failure
    const manifests: Record<string, string | null> = {};
    await Promise.all(
      MANIFEST_PATHS.map(async (p) => {
        manifests[p] = await input.readFile(p).catch(() => null);
      })
    );

    const rawModules = detectModules(input.files);
    const modules = await this.resolveModules(rawModules, input.files);

    return {
      analyzedAt: new Date().toISOString(),
      languages: detectLanguages(input.files),
      frameworks: detectFrameworks(manifests),
      buildSystem: detectBuildSystem(input.files, manifests),
      testFrameworks: detectTestFrameworks(input.files, manifests),
      databases: detectDatabases(manifests),
      apiStyles: detectApiStyles(input.files),
      entryPoints: detectEntryPoints(input.files),
      modules,
      cicd: detectCicd(input.files),
      infrastructure: detectInfrastructure(input.files),
      integrations: detectIntegrations(manifests),
      isMonorepo: detectMonorepo(input.files, manifests),
    };
  }

  private async resolveModules(
    rawModules: Array<{name: string; path: string}>,
    files: GitFileEntry[]
  ): Promise<ProjectModule[]> {
    if (!this.llm) return rawModules;
    const allPaths = files.filter(f => f.type === "file").map(f => f.path);
    return Promise.all(
      rawModules.map(async (m) => {
        const sampleFiles = allPaths
          .filter(p => p.startsWith(m.path + "/"))
          .slice(0, 10);
        const responsibility = await this.llm!
          .inferModuleResponsibility(m.name, sampleFiles)
          .catch(() => null);
        return { ...m, responsibility: responsibility ?? undefined };
      })
    );
  }
}
```

- [ ] **Step 4: Run all tests**

```bash
npm test -- repository-analyzer
```

Expected: all tests pass.

- [ ] **Step 5: Run typecheck**

```bash
npm run typecheck
```

Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add src/modules/repository-analyzer/repository-analyzer.ts \
        test/modules/repository-analyzer/repository-analyzer.test.ts
git commit -m "feat(repository-analyzer): add RepositoryAnalyzer class with integration tests"
```

---

### Task 5: Barrel exports and final verification

**Files:**
- Create: `src/modules/repository-analyzer/index.ts`

**Interfaces:**
- Produces: public API of the module — consumers import from `"../repository-analyzer/index.js"`

- [ ] **Step 1: Create `src/modules/repository-analyzer/index.ts`**

```ts
export type {
  RepositoryInput,
  LLMAssistant,
  ProjectModule,
  ProjectSnapshot,
} from "./entities.js";

export { RepositoryAnalyzer } from "./repository-analyzer.js";
```

- [ ] **Step 2: Run full test suite**

```bash
npm test
```

Expected: all tests pass, no regressions.

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```

Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add src/modules/repository-analyzer/index.ts
git commit -m "feat(repository-analyzer): add barrel exports (PM-021 complete)"
```
