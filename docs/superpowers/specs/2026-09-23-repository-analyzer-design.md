# Repository Analyzer — Design Spec

**Issue:** PM-021  
**Date:** 2026-09-23  
**Status:** Approved

---

## Overview

Implement a `repository-analyzer` module that takes a Git repository's file tree and file contents, applies heuristic detection rules, and produces a `ProjectSnapshot` describing the repository's technology stack and structural characteristics. No existing documentation is required — a bare Git repository is sufficient input.

LLM assistance (for ambiguous inference such as module responsibilities) is supported via an injected interface stub. The real LLM wiring is out of scope for this issue.

---

## Module structure

```
src/modules/repository-analyzer/
  entities.ts              # ProjectSnapshot, RepositoryInput, LLMAssistant
  repository-analyzer.ts   # RepositoryAnalyzer class + pure detector functions
  index.ts                 # barrel re-exports

test/modules/repository-analyzer/
  repository-analyzer.test.ts
```

No new top-level directories. Follows the same module layout as `git-connector/` and `knowledge-core/`.

---

## Entities (`entities.ts`)

### RepositoryInput

Decoupled from `GitConnector` — accepts any source of file tree + file content.

```ts
import type { GitFileEntry } from "../git-connector/index.js";

interface RepositoryInput {
  files: GitFileEntry[];
  readFile(path: string): Promise<string | null>;
}
```

Call site when used with `GitConnector`:

```ts
await analyzer.analyze({
  files: await connector.listFiles(repoId),
  readFile: (p) => connector.readFile(repoId, p),
});
```

### LLMAssistant (stub interface)

One method only. The real implementation is wired in a future issue.

```ts
interface LLMAssistant {
  inferModuleResponsibility(
    name: string,
    sampleFiles: string[]
  ): Promise<string | null>;
}
```

### ProjectSnapshot

Output type. `projectId` is intentionally absent — the caller (ingestion pipeline) assigns it. Internal dependency graph is deferred to PM-022.

```ts
interface ProjectSnapshot {
  analyzedAt: string;            // ISO 8601 timestamp
  languages: string[];           // e.g. ["TypeScript", "Python"]
  frameworks: string[];          // e.g. ["Fastify", "React", "FastAPI"]
  buildSystem: string | null;    // e.g. "npm" | "gradle" | "make" | null
  testFrameworks: string[];      // e.g. ["Vitest", "Jest", "pytest"]
  databases: string[];           // e.g. ["MongoDB", "PostgreSQL"]
  apiStyles: string[];           // e.g. ["REST", "GraphQL", "gRPC"]
  entryPoints: string[];         // e.g. ["src/index.ts", "cmd/main.go"]
  modules: Array<{
    name: string;
    path: string;
    responsibility?: string;     // LLM-inferred; undefined if LLM unavailable
  }>;
  cicd: string | null;           // e.g. "GitHub Actions" | "Jenkins" | null
  infrastructure: string[];      // e.g. ["Docker", "Terraform", "Kubernetes"]
  integrations: string[];        // e.g. ["stripe", "aws-sdk", "twilio"]
  isMonorepo: boolean;
}
```

---

## RepositoryAnalyzer (`repository-analyzer.ts`)

### Class

```ts
class RepositoryAnalyzer {
  constructor(private llm: LLMAssistant | null = null) {}
  async analyze(input: RepositoryInput): Promise<ProjectSnapshot>;
}
```

`analyze()` orchestrates the detection pipeline:

1. Reads all relevant manifest files once (package.json, requirements.txt, go.mod, pom.xml, build.gradle, Cargo.toml, etc.) — at most one `readFile` call per manifest path.
2. Calls pure detector functions (see below), passing paths and pre-read manifests.
3. If `this.llm` is non-null, calls `inferModuleResponsibility` for top-level source directories.
4. Returns a `ProjectSnapshot`. Never throws — graceful degrade on any `readFile` returning `null`.

### Pure detector functions

All detectors are module-level functions, not class methods. This makes them independently testable.

| Function | Primary input | Reads file? |
|---|---|---|
| `detectLanguages(files)` | `GitFileEntry[]` | No — extension frequency count |
| `detectFrameworks(manifests)` | parsed manifest contents | No — already read |
| `detectBuildSystem(files, manifests)` | paths + manifests | No |
| `detectTestFrameworks(files, manifests)` | paths + manifests | No |
| `detectDatabases(manifests)` | manifest contents | No |
| `detectApiStyles(files)` | `GitFileEntry[]` | No — path matching (.proto, .graphql, routes/) |
| `detectEntryPoints(files)` | `GitFileEntry[]` | No — known file names |
| `detectModules(files)` | `GitFileEntry[]` | No — top-level dirs |
| `detectCicd(files)` | `GitFileEntry[]` | No — path matching |
| `detectInfrastructure(files)` | `GitFileEntry[]` | No — path matching |
| `detectIntegrations(manifests)` | parsed manifests | No |
| `detectMonorepo(files, manifests)` | paths + manifests | No |

Each function returns a typed partial of `ProjectSnapshot` or a single field. All functions are pure (no I/O side-effects).

### Detection heuristics

**Languages** — count files by extension; extensions mapping:

| Extensions | Language |
|---|---|
| `.ts`, `.tsx` | TypeScript |
| `.js`, `.mjs`, `.cjs` | JavaScript |
| `.py` | Python |
| `.java` | Java |
| `.go` | Go |
| `.rs` | Rust |
| `.rb` | Ruby |
| `.cs` | C# |

Include a language if it has ≥ 1 file (sorted by frequency descending).

**Frameworks** — keyword search in manifest dependency keys:

| Manifest | Keywords → Framework |
|---|---|
| `package.json` `dependencies`/`devDependencies` | `fastify` → Fastify, `express` → Express, `react` → React, `next` → Next.js, `vue` → Vue, `nestjs/core` → NestJS |
| `requirements.txt` | `fastapi` → FastAPI, `django` → Django, `flask` → Flask, `sqlalchemy` → SQLAlchemy |
| `pom.xml` / `build.gradle` | `spring-boot` → Spring Boot, `quarkus` → Quarkus |
| `go.mod` | `gin-gonic/gin` → Gin, `labstack/echo` → Echo, `gofiber/fiber` → Fiber |

**Build system** — first match wins:

| Signal | Value |
|---|---|
| `package.json` exists | `"npm"` |
| `pom.xml` exists | `"maven"` |
| `build.gradle` exists | `"gradle"` |
| `Makefile` exists (no above) | `"make"` |
| `go.mod` exists (no above) | `"go"` |
| `Cargo.toml` exists | `"cargo"` |
| none | `null` |

**Test frameworks** — package.json devDependencies + config files:

| Signal | Framework |
|---|---|
| `vitest` in deps | Vitest |
| `jest` in deps | Jest |
| `mocha` in deps | Mocha |
| `pytest.ini` / `pyproject.toml` with `[tool.pytest]` | pytest |
| `junit` in pom.xml/build.gradle | JUnit |

**Databases** — package.json deps + requirements.txt:

| Keyword | Database |
|---|---|
| `mongodb`, `mongoose` | MongoDB |
| `pg`, `postgres`, `postgresql` | PostgreSQL |
| `mysql`, `mysql2` | MySQL |
| `redis`, `ioredis` | Redis |
| `sqlite`, `better-sqlite3` | SQLite |
| `typeorm`, `sequelize`, `prisma` | (also tag ORM name) |

**API styles** — path matching:

| Signal | Style |
|---|---|
| `*.proto` files | gRPC |
| `*.graphql` / `*.gql` files or `graphql` in deps | GraphQL |
| Controller files matching `*controller*`, `*router*`, `routes/` directory | REST |

**Entry points** — known file names (in order of precedence):

`src/index.ts`, `src/index.js`, `src/main.ts`, `src/main.js`, `src/server.ts`, `src/app.ts`, `index.ts`, `index.js`, `main.go`, `cmd/main.go`, `app.py`, `main.py`, `manage.py`

**Modules** — top-level directories under `src/` (or repo root if no `src/`). Filter out: `node_modules`, `.git`, `dist`, `build`, `coverage`, `.github`.

**CI/CD** — path matching:

| Path | Value |
|---|---|
| `.github/workflows/` | `"GitHub Actions"` |
| `Jenkinsfile` | `"Jenkins"` |
| `.gitlab-ci.yml` | `"GitLab CI"` |
| `.circleci/` | `"CircleCI"` |
| `bitbucket-pipelines.yml` | `"Bitbucket Pipelines"` |

**Infrastructure** — path matching:

| Signal | Label |
|---|---|
| `Dockerfile` or `docker-compose*` | Docker |
| `*.tf` files | Terraform |
| `*.yaml`/`*.yml` in `k8s/`, `kubernetes/`, or containing `kind: Deployment` | Kubernetes |
| `serverless.yml` | Serverless Framework |
| `cdk.json` or `lib/*.stack.ts` | AWS CDK |

**Integrations** — package.json deps / requirements.txt keyword scan for known third-party service SDKs:

`stripe`, `twilio`, `sendgrid`, `@sendgrid/`, `aws-sdk`, `@aws-sdk/`, `firebase`, `supabase`, `auth0`, `datadog`, `sentry`, `openai`, `anthropic`, `langchain`

**Monorepo** — `isMonorepo: true` if any of:
- More than one `package.json` found in different directories
- More than one `pom.xml` found
- More than one `go.mod` found
- `pnpm-workspace.yaml` or `lerna.json` exists

---

## Error handling

- `readFile` returns `null` → skip that manifest, continue detection without it. No throw.
- Empty repository (no files) → return snapshot with all arrays empty, `buildSystem: null`, `isMonorepo: false`.
- LLM throws or returns `null` → `responsibility` field is `undefined`. Does not fail `analyze()`.

---

## Testing strategy

### Unit tests (`repository-analyzer.test.ts`)

All tests use plain `RepositoryInput` objects — no mocks of external classes needed.

**Acceptance criteria repos (from issue):**

```ts
// Node/TypeScript repo
{
  files: [
    { path: "package.json", size: 500, type: "file" },
    { path: "src/index.ts", size: 1000, type: "file" },
    { path: "src/server.ts", size: 800, type: "file" },
    { path: "vitest.config.ts", size: 200, type: "file" },
    { path: ".github/workflows/ci.yml", size: 300, type: "file" },
  ],
  readFile: async (p) =>
    p === "package.json"
      ? JSON.stringify({ dependencies: { fastify: "5.0" }, devDependencies: { vitest: "2.0", typescript: "5.0" } })
      : null,
}
// Expected: languages: ["TypeScript"], frameworks: ["Fastify"], testFrameworks: ["Vitest"],
//           buildSystem: "npm", cicd: "GitHub Actions"
```

```ts
// Python/FastAPI repo
{
  files: [
    { path: "requirements.txt", size: 200, type: "file" },
    { path: "app/main.py", size: 1500, type: "file" },
    { path: "pytest.ini", size: 50, type: "file" },
    { path: "Dockerfile", size: 300, type: "file" },
  ],
  readFile: async (p) =>
    p === "requirements.txt" ? "fastapi==0.110.0\nuvicorn==0.27.0\nsqlalchemy==2.0.0\n" : null,
}
// Expected: languages: ["Python"], frameworks: ["FastAPI", "SQLAlchemy"], testFrameworks: ["pytest"],
//           buildSystem: null, infrastructure: ["Docker"]
```

```ts
// Java/Maven repo
{
  files: [
    { path: "pom.xml", size: 3000, type: "file" },
    { path: "src/main/java/com/example/App.java", size: 800, type: "file" },
    { path: "src/test/java/com/example/AppTest.java", size: 400, type: "file" },
  ],
  readFile: async (p) =>
    p === "pom.xml"
      ? "<project>...spring-boot-starter-web...junit-jupiter...</project>"
      : null,
}
// Expected: languages: ["Java"], frameworks: ["Spring Boot"], testFrameworks: ["JUnit"],
//           buildSystem: "maven"
```

**Additional cases:**

- Monorepo: two `package.json` in different dirs → `isMonorepo: true`
- Empty repo: no files → all arrays empty, `isMonorepo: false`
- `readFile` always returns `null` → graceful degrade, no throw
- gRPC repo: `.proto` files present → `apiStyles: ["gRPC"]`
- GraphQL repo: `.graphql` files → `apiStyles: ["GraphQL"]`
- LLM provided: verify `inferModuleResponsibility` called with top-level dir name; result appears in `modules[].responsibility`
- LLM throws: snapshot still returned, `responsibility` undefined

---

## Out of scope for this issue

- HTTP routes exposing `ProjectSnapshot`
- Persisting `ProjectSnapshot` to MongoDB (PM-022)
- Internal dependency graph (`dependencies[]` field — PM-022)
- Real LLM wiring (future issue after PM-021)
- Incremental ingestion pipeline (PM-020 epic)
