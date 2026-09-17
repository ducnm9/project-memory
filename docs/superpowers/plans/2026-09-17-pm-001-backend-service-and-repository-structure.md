# PM-001 Backend Service and Repository Structure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a runnable, tested TypeScript/Fastify backend service skeleton and repository structure that later Project Memory milestones extend.

**Architecture:** A single-package Node service at the repo root. `buildApp(config)` assembles a Fastify instance (plugins + routes) without listening; `server.ts` loads validated config, calls `buildApp`, listens, and handles graceful shutdown. No database or business logic — only health endpoints, config, logging, error handling, tests, tooling, and README-only subsystem seams.

**Tech Stack:** TypeScript (strict, NodeNext, ES2022), Fastify, Zod, Vitest (+ v8 coverage), ESLint + typescript-eslint, Prettier, tsx, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-17-pm-001-backend-service-and-repository-structure-design.md`

## Global Constraints

- Language/runtime: TypeScript on Node.js. TypeScript `strict: true`, `module`/`moduleResolution` `NodeNext`, `target` `ES2022`, `outDir` `dist/`.
- Web framework: Fastify. HTTP tested via `app.inject()` — never bind a real port in tests.
- Config validation: Zod. Config is loaded once, validated, and exposed as a frozen typed `AppConfig`. Fail fast on invalid values.
- Scope: pure skeleton. NO database connection, NO tenancy, NO auth, NO subsystem implementation. `modules/*` are README-only.
- App-assembly seam: `buildApp(config)` returns a `FastifyInstance` and does NOT call `listen`. Only `server.ts` listens.
- Error contract: every error response has the shape `{ error: { code, message } }`. Internal details never leak to clients; unknown errors return HTTP 500 with a generic message and are logged server-side in full.
- Config variables (all optional with defaults, but validated when present): `PORT` (default `3000`, positive integer), `HOST` (default `0.0.0.0`), `NODE_ENV` (`development` | `production` | `test`, default `development`), `LOG_LEVEL` (valid Pino level, default `info`).
- Dependencies pinned to exact versions (no `^`/`~`).
- Existing repo behavior must be preserved: the JSON pre-commit validation and the `validate-specs.yml` workflow keep working unchanged.
- Commit frequently — each task ends with a commit.

---

### Task 1: Project tooling and configuration

Establishes the Node project, TypeScript, linting, formatting, and the Vitest test runner. Deliverable: `npm ci` works and an empty test run succeeds, proving the toolchain is wired.

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `eslint.config.js`
- Create: `.prettierrc`
- Create: `vitest.config.ts`
- Create: `.env.example`
- Test: `test/smoke.test.ts` (temporary, removed in this task's final step)

**Interfaces:**
- Consumes: nothing (first task).
- Produces: npm scripts `dev`, `build`, `start`, `test`, `test:watch`, `lint`, `format`, `typecheck`, `check`. A working `vitest` config that discovers tests under `test/`.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "project-memory-backend",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/server.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint .",
    "format": "prettier --write .",
    "typecheck": "tsc --noEmit",
    "check": "npm run lint && npm run typecheck && npm run test"
  },
  "dependencies": {
    "fastify": "5.1.0",
    "zod": "3.23.8"
  },
  "devDependencies": {
    "@types/node": "20.14.15",
    "@vitest/coverage-v8": "2.1.8",
    "eslint": "9.13.0",
    "prettier": "3.3.3",
    "tsx": "4.19.2",
    "typescript": "5.6.3",
    "typescript-eslint": "8.12.2",
    "vitest": "2.1.8"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": ".",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src/**/*.ts", "test/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Create `eslint.config.js`**

```js
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "coverage/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
    },
  },
);
```

Note: `typescript-eslint`'s flat-config helper pulls in `@eslint/js` as a peer. Add it if `npm ci` reports it missing:

```bash
npm install --save-dev --save-exact @eslint/js@9.13.0
```

- [ ] **Step 4: Create `.prettierrc`**

```json
{
  "semi": true,
  "singleQuote": false,
  "trailingComma": "all",
  "printWidth": 100
}
```

- [ ] **Step 5: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
    },
  },
});
```

- [ ] **Step 6: Create `.env.example`**

```bash
# HTTP listen port (positive integer). Default: 3000
PORT=3000
# Bind address. Default: 0.0.0.0
HOST=0.0.0.0
# One of: development | production | test. Default: development
NODE_ENV=development
# Pino log level (e.g. info, debug, warn, error). Default: info
LOG_LEVEL=info
```

- [ ] **Step 7: Create a temporary smoke test `test/smoke.test.ts`**

```ts
import { describe, expect, it } from "vitest";

describe("toolchain", () => {
  it("runs a test", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 8: Install dependencies and run the smoke test**

Run: `npm install && npm run test`
Expected: PASS — one passing test, proving Vitest and the toolchain work.

- [ ] **Step 9: Verify lint and typecheck run**

Run: `npm run lint && npm run typecheck`
Expected: both exit 0 (no errors). If `@eslint/js` is reported missing, install it per Step 3's note and re-run.

- [ ] **Step 10: Remove the temporary smoke test**

```bash
rm test/smoke.test.ts
```

- [ ] **Step 11: Commit**

```bash
git add package.json package-lock.json tsconfig.json eslint.config.js .prettierrc vitest.config.ts .env.example
git commit -m "chore(pm-001): scaffold TypeScript/Fastify project tooling"
```

---

### Task 2: Error vocabulary (`lib/errors.ts`)

The shared error classes every later unit builds on. Pure, no framework dependency.

**Files:**
- Create: `src/lib/errors.ts`
- Test: `test/lib/errors.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `class AppError extends Error` with `readonly statusCode: number`, `readonly code: string`; constructor `(message: string, statusCode: number, code: string)`.
  - `class ValidationError extends AppError` — `statusCode` `400`, `code` `"VALIDATION_ERROR"`; constructor `(message: string)`.
  - `class NotFoundError extends AppError` — `statusCode` `404`, `code` `"NOT_FOUND"`; constructor `(message: string)`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { AppError, NotFoundError, ValidationError } from "../../src/lib/errors.js";

describe("AppError", () => {
  it("carries statusCode and code", () => {
    const err = new AppError("boom", 418, "TEAPOT");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("boom");
    expect(err.statusCode).toBe(418);
    expect(err.code).toBe("TEAPOT");
  });

  it("ValidationError maps to 400 / VALIDATION_ERROR", () => {
    const err = new ValidationError("bad input");
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.message).toBe("bad input");
  });

  it("NotFoundError maps to 404 / NOT_FOUND", () => {
    const err = new NotFoundError("missing");
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(404);
    expect(err.code).toBe("NOT_FOUND");
    expect(err.message).toBe("missing");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- test/lib/errors.test.ts`
Expected: FAIL — cannot find module `../../src/lib/errors.js`.

- [ ] **Step 3: Write minimal implementation `src/lib/errors.ts`**

```ts
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(message: string, statusCode: number, code: string) {
    super(message);
    this.name = new.target.name;
    this.statusCode = statusCode;
    this.code = code;
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 400, "VALIDATION_ERROR");
  }
}

export class NotFoundError extends AppError {
  constructor(message: string) {
    super(message, 404, "NOT_FOUND");
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- test/lib/errors.test.ts`
Expected: PASS — all three tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/errors.ts test/lib/errors.test.ts
git commit -m "feat(pm-001): add AppError vocabulary"
```

---

### Task 3: Config loading and validation (`config/index.ts`)

Loads env vars, validates with Zod, returns a frozen typed `AppConfig`. Fails fast on invalid values.

**Files:**
- Create: `src/config/index.ts`
- Test: `test/config/index.test.ts`

**Interfaces:**
- Consumes: nothing (reads from an injected env record).
- Produces:
  - `interface AppConfig { port: number; host: string; nodeEnv: "development" | "production" | "test"; logLevel: string; }`
  - `function loadConfig(env?: NodeJS.ProcessEnv): Readonly<AppConfig>` — defaults to `process.env`; throws `Error` with a clear message when a present value is invalid.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config/index.js";

describe("loadConfig", () => {
  it("applies defaults when env is empty", () => {
    const cfg = loadConfig({});
    expect(cfg.port).toBe(3000);
    expect(cfg.host).toBe("0.0.0.0");
    expect(cfg.nodeEnv).toBe("development");
    expect(cfg.logLevel).toBe("info");
  });

  it("reads and coerces provided values", () => {
    const cfg = loadConfig({ PORT: "8080", NODE_ENV: "production", LOG_LEVEL: "debug" });
    expect(cfg.port).toBe(8080);
    expect(cfg.nodeEnv).toBe("production");
    expect(cfg.logLevel).toBe("debug");
  });

  it("returns a frozen object", () => {
    const cfg = loadConfig({});
    expect(Object.isFrozen(cfg)).toBe(true);
  });

  it("fails fast on non-numeric PORT", () => {
    expect(() => loadConfig({ PORT: "abc" })).toThrow(/PORT/);
  });

  it("fails fast on out-of-enum NODE_ENV", () => {
    expect(() => loadConfig({ NODE_ENV: "staging" })).toThrow(/NODE_ENV/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- test/config/index.test.ts`
Expected: FAIL — cannot find module `../../src/config/index.js`.

- [ ] **Step 3: Write minimal implementation `src/config/index.ts`**

```ts
import { z } from "zod";

export interface AppConfig {
  port: number;
  host: string;
  nodeEnv: "development" | "production" | "test";
  logLevel: string;
}

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().min(1).default("0.0.0.0"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
});

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Readonly<AppConfig> {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid configuration: ${detail}`);
  }
  const data = parsed.data;
  return Object.freeze({
    port: data.PORT,
    host: data.HOST,
    nodeEnv: data.NODE_ENV,
    logLevel: data.LOG_LEVEL,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- test/config/index.test.ts`
Expected: PASS — all five tests green.

- [ ] **Step 5: Commit**

```bash
git add src/config/index.ts test/config/index.test.ts
git commit -m "feat(pm-001): add Zod-validated config loader"
```

---

### Task 4: Error-handler plugin (`plugins/error-handler.ts`)

Maps thrown errors to the consistent `{ error: { code, message } }` shape. `AppError` subclasses use their status/code; everything else becomes a generic 500.

**Files:**
- Create: `src/plugins/error-handler.ts`
- Test: `test/plugins/error-handler.test.ts`

**Interfaces:**
- Consumes: `AppError` from `src/lib/errors.ts`.
- Produces: `function registerErrorHandler(app: FastifyInstance): void` — calls `app.setErrorHandler(...)`.

- [ ] **Step 1: Write the failing test**

```ts
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { registerErrorHandler } from "../../src/plugins/error-handler.js";
import { ValidationError } from "../../src/lib/errors.js";

function buildTestApp() {
  const app = Fastify();
  registerErrorHandler(app);
  app.get("/known", async () => {
    throw new ValidationError("bad field");
  });
  app.get("/unknown", async () => {
    throw new Error("secret internals");
  });
  return app;
}

describe("registerErrorHandler", () => {
  it("maps AppError to its status and shape", async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: "GET", url: "/known" });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: { code: "VALIDATION_ERROR", message: "bad field" } });
    await app.close();
  });

  it("maps unknown errors to a generic 500 without leaking internals", async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: "GET", url: "/unknown" });
    expect(res.statusCode).toBe(500);
    const body = res.json();
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(body.error.message).not.toContain("secret internals");
    await app.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- test/plugins/error-handler.test.ts`
Expected: FAIL — cannot find module `../../src/plugins/error-handler.js`.

- [ ] **Step 3: Write minimal implementation `src/plugins/error-handler.ts`**

```ts
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { AppError } from "../lib/errors.js";

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: unknown, _req: FastifyRequest, reply: FastifyReply) => {
    if (error instanceof AppError) {
      reply.status(error.statusCode).send({
        error: { code: error.code, message: error.message },
      });
      return;
    }

    // Fastify's built-in validation errors carry a numeric statusCode of 400.
    const maybe = error as { statusCode?: number; message?: string };
    if (maybe.statusCode === 400) {
      reply.status(400).send({
        error: { code: "VALIDATION_ERROR", message: maybe.message ?? "Bad Request" },
      });
      return;
    }

    app.log.error(error);
    reply.status(500).send({
      error: { code: "INTERNAL_ERROR", message: "Internal Server Error" },
    });
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- test/plugins/error-handler.test.ts`
Expected: PASS — both tests green.

- [ ] **Step 5: Commit**

```bash
git add src/plugins/error-handler.ts test/plugins/error-handler.test.ts
git commit -m "feat(pm-001): add error-handler plugin"
```

---

### Task 5: Health routes (`routes/health.ts`)

Registers `GET /health` (liveness) and `GET /ready` (readiness). Readiness returns ready with no external checks in PM-001.

**Files:**
- Create: `src/routes/health.ts`
- Test: `test/routes/health.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `function registerHealthRoutes(app: FastifyInstance): void` — registers `GET /health` → `200 { status: "ok" }` and `GET /ready` → `200 { status: "ready" }`.

- [ ] **Step 1: Write the failing test**

```ts
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { registerHealthRoutes } from "../../src/routes/health.js";

function buildTestApp() {
  const app = Fastify();
  registerHealthRoutes(app);
  return app;
}

describe("health routes", () => {
  it("GET /health returns 200 ok", async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
    await app.close();
  });

  it("GET /ready returns 200 ready", async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: "GET", url: "/ready" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ready" });
    await app.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- test/routes/health.test.ts`
Expected: FAIL — cannot find module `../../src/routes/health.js`.

- [ ] **Step 3: Write minimal implementation `src/routes/health.ts`**

```ts
import type { FastifyInstance } from "fastify";

export function registerHealthRoutes(app: FastifyInstance): void {
  app.get("/health", async () => ({ status: "ok" }));
  // Readiness aggregates dependency checks. PM-001 has none, so it is always
  // ready. PM-002 adds a DB ping here and returns 503 on failure.
  app.get("/ready", async () => ({ status: "ready" }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- test/routes/health.test.ts`
Expected: PASS — both tests green.

- [ ] **Step 5: Commit**

```bash
git add src/routes/health.ts test/routes/health.test.ts
git commit -m "feat(pm-001): add health and readiness routes"
```

---

### Task 6: App assembly (`app.ts`)

`buildApp(config)` creates the Fastify instance with the configured logger, registers the error handler and health routes, and returns the instance without listening. Logging config is folded into this task since it is a single option on the Fastify constructor.

**Files:**
- Create: `src/app.ts`
- Test: `test/app.test.ts`

**Interfaces:**
- Consumes: `AppConfig` from `src/config/index.ts`; `registerErrorHandler` from `src/plugins/error-handler.ts`; `registerHealthRoutes` from `src/routes/health.ts`.
- Produces: `function buildApp(config: AppConfig): FastifyInstance` — a configured, non-listening instance.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config/index.js";

describe("buildApp", () => {
  it("assembles an app that serves health routes", async () => {
    const app = buildApp(loadConfig({ LOG_LEVEL: "silent" }));
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
    await app.close();
  });

  it("wires the error handler for unknown errors", async () => {
    const app = buildApp(loadConfig({ LOG_LEVEL: "silent" }));
    app.get("/boom", async () => {
      throw new Error("should not leak");
    });
    const res = await app.inject({ method: "GET", url: "/boom" });
    expect(res.statusCode).toBe(500);
    expect(res.json().error.code).toBe("INTERNAL_ERROR");
    await app.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- test/app.test.ts`
Expected: FAIL — cannot find module `../src/app.js`.

- [ ] **Step 3: Write minimal implementation `src/app.ts`**

```ts
import Fastify, { type FastifyInstance } from "fastify";
import type { AppConfig } from "./config/index.js";
import { registerErrorHandler } from "./plugins/error-handler.js";
import { registerHealthRoutes } from "./routes/health.js";

export function buildApp(config: AppConfig): FastifyInstance {
  const app = Fastify({
    logger: { level: config.logLevel },
  });

  registerErrorHandler(app);
  registerHealthRoutes(app);

  return app;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- test/app.test.ts`
Expected: PASS — both tests green.

- [ ] **Step 5: Commit**

```bash
git add src/app.ts test/app.test.ts
git commit -m "feat(pm-001): add buildApp assembly"
```

---

### Task 7: Server entrypoint (`server.ts`)

Loads config, builds the app, listens, and wires graceful shutdown. This is the process entrypoint; it is not unit-tested via inject (no logic beyond wiring), but is verified by starting the built service and hitting an endpoint.

**Files:**
- Create: `src/server.ts`

**Interfaces:**
- Consumes: `loadConfig` from `src/config/index.ts`; `buildApp` from `src/app.ts`.
- Produces: an executable entrypoint (`node dist/server.js`). No exported symbols relied on by other tasks.

- [ ] **Step 1: Write implementation `src/server.ts`**

```ts
import { buildApp } from "./app.js";
import { loadConfig } from "./config/index.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const app = buildApp(config);

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`received ${signal}, shutting down`);
    await app.close();
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  try {
    await app.listen({ port: config.port, host: config.host });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main().catch((err) => {
  // Config validation or unexpected startup failure.
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Build the project**

Run: `npm run build`
Expected: exit 0, `dist/server.js` exists.

- [ ] **Step 3: Start the service and verify /health responds**

Run:
```bash
LOG_LEVEL=silent PORT=3000 node dist/server.js &
SERVER_PID=$!
sleep 1
curl -sf http://127.0.0.1:3000/health
echo
curl -sf http://127.0.0.1:3000/ready
echo
kill $SERVER_PID
```
Expected: prints `{"status":"ok"}` then `{"status":"ready"}`, and the process is killed cleanly.

- [ ] **Step 4: Run the full check gate**

Run: `npm run check`
Expected: lint, typecheck, and all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/server.ts
git commit -m "feat(pm-001): add server entrypoint with graceful shutdown"
```

---

### Task 8: Subsystem seams (`modules/*/README.md`)

Creates the README-only subsystem boundaries that establish the repository-structure convention. No runtime code.

**Files:**
- Create: `src/modules/project-context/README.md`
- Create: `src/modules/knowledge-core/README.md`
- Create: `src/modules/retrieval/README.md`
- Create: `src/modules/governance/README.md`
- Create: `src/modules/ingestion/README.md`

**Interfaces:**
- Consumes: nothing.
- Produces: directory structure only; not imported by `app.ts`.

- [ ] **Step 1: Create `src/modules/project-context/README.md`**

```markdown
# Project Context

Resolves and holds project/organization scope for a request. Every retrieval
and write is scoped to a project.

**Status:** Not implemented in PM-001. Introduced by PM-003 (tenancy) and
PM-005 (repository-to-project binding). No runtime code here yet.
```

- [ ] **Step 2: Create `src/modules/knowledge-core/README.md`**

```markdown
# Knowledge Core

Canonical knowledge items, facts, relations, versions, provenance, and audit.

**Status:** Not implemented in PM-001. Introduced by Epic 2 (PM-010+). No
runtime code here yet.
```

- [ ] **Step 3: Create `src/modules/retrieval/README.md`**

```markdown
# Retrieval

Full-text, vector, and metadata retrieval with reranking and relation
expansion.

**Status:** Not implemented in PM-001. Introduced by Epic 4 (PM-030+). No
runtime code here yet.
```

- [ ] **Step 4: Create `src/modules/governance/README.md`**

```markdown
# Governance

Structural validation, duplicate/contradiction detection, freshness, and the
proposal/approval lifecycle.

**Status:** Not implemented in PM-001. Introduced by Epic 5 (PM-040+). No
runtime code here yet.
```

- [ ] **Step 5: Create `src/modules/ingestion/README.md`**

```markdown
# Ingestion

Sources knowledge from Git, GitHub, Jira, docs, and agents into the pipeline.

**Status:** Not implemented in PM-001. Introduced by Epic 3 (PM-020+) and
Epic 7 (PM-060+). No runtime code here yet.
```

- [ ] **Step 6: Commit**

```bash
git add src/modules
git commit -m "docs(pm-001): add subsystem seam READMEs"
```

---

### Task 9: CI workflow (`.github/workflows/backend.yml`)

Adds a GitHub Actions workflow that runs lint, typecheck, and test on backend paths. Path-scoped so it does not overlap the existing `validate-specs.yml`.

**Files:**
- Create: `.github/workflows/backend.yml`

**Interfaces:**
- Consumes: the `npm` scripts from Task 1.
- Produces: a CI job named `backend`.

- [ ] **Step 1: Create `.github/workflows/backend.yml`**

```yaml
name: Backend

on:
  push:
    paths:
      - "src/**"
      - "test/**"
      - "package.json"
      - "package-lock.json"
      - "tsconfig.json"
      - "eslint.config.js"
      - "vitest.config.ts"
      - ".github/workflows/backend.yml"
  pull_request:
    paths:
      - "src/**"
      - "test/**"
      - "package.json"
      - "package-lock.json"
      - "tsconfig.json"
      - "eslint.config.js"
      - "vitest.config.ts"
      - ".github/workflows/backend.yml"

jobs:
  backend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm run test
```

- [ ] **Step 2: Validate the workflow YAML parses**

Run:
```bash
python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/backend.yml')); print('valid yaml')"
```
Expected: prints `valid yaml`.

- [ ] **Step 3: Confirm the existing specs workflow is untouched**

Run: `git status --short .github/workflows/`
Expected: only `backend.yml` is new (`??`); `validate-specs.yml` is unmodified.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/backend.yml
git commit -m "ci(pm-001): add backend lint/typecheck/test workflow"
```

---

### Task 10: Extend the pre-commit hook

Extends the existing Python-based JSON-validating pre-commit hook to also run lint and typecheck **only when TypeScript files are staged**. The existing JSON validation is preserved exactly.

**Files:**
- Modify: `scripts/hooks/pre-commit`

**Interfaces:**
- Consumes: the `npm` scripts from Task 1.
- Produces: no code symbols; a hook behavior change.

- [ ] **Step 1: Read the current hook to preserve its behavior**

Run: `cat scripts/hooks/pre-commit`
Expected: the existing script ends with `echo "pre-commit: JSON hợp lệ."`. Confirm the JSON steps before appending.

- [ ] **Step 2: Append the TypeScript-check block to `scripts/hooks/pre-commit`**

Add the following at the end of the file (after the existing JSON validation, keeping everything above unchanged):

```bash

# 3) TypeScript checks — only when staged files touch backend code/config.
ts_staged="$(git diff --cached --name-only --diff-filter=ACM \
  -- 'src/**' 'test/**' 'tsconfig.json' 'eslint.config.js' 'vitest.config.ts' 'package.json' || true)"
if [ -n "$ts_staged" ]; then
  if command -v npm >/dev/null 2>&1 && [ -f package.json ]; then
    echo "pre-commit: chạy lint + typecheck cho TypeScript..."
    npm run lint
    npm run typecheck
    echo "pre-commit: TypeScript hợp lệ."
  else
    echo "pre-commit: không tìm thấy npm hoặc package.json, bỏ qua kiểm tra TypeScript." >&2
  fi
fi
```

- [ ] **Step 3: Verify a docs-only commit does NOT trigger TS checks**

Run:
```bash
echo "scratch" > /tmp/pm001-doc-check.md
git add scripts/hooks/pre-commit
git diff --cached --name-only --diff-filter=ACM -- 'src/**' 'test/**' 'tsconfig.json' 'eslint.config.js' 'vitest.config.ts' 'package.json'
rm -f /tmp/pm001-doc-check.md
```
Expected: the second command prints nothing (no TS-relevant files staged), confirming the guard skips TS checks for non-backend commits.

- [ ] **Step 4: Verify the hook runs and preserves JSON validation**

Run: `bash scripts/hooks/pre-commit`
Expected: prints `All JSON specs are valid.` / `pre-commit: JSON hợp lệ.`; because only `scripts/hooks/pre-commit` is staged (no `src/**`), the TypeScript block is skipped.

- [ ] **Step 5: Commit**

```bash
git add scripts/hooks/pre-commit
git commit -m "chore(pm-001): extend pre-commit hook with TS lint/typecheck"
```

---

### Task 11: Final verification

Confirms the whole skeleton builds, checks pass, and the definition of done is met. No new files — a verification gate.

**Files:**
- None (verification only).

**Interfaces:**
- Consumes: everything from Tasks 1–10.
- Produces: nothing.

- [ ] **Step 1: Clean install and full gate**

Run: `npm ci && npm run check`
Expected: install succeeds; lint, typecheck, and all tests pass.

- [ ] **Step 2: Build succeeds**

Run: `npm run build`
Expected: exit 0; `dist/server.js` present.

- [ ] **Step 3: Runtime smoke test against the built artifact**

Run:
```bash
LOG_LEVEL=silent node dist/server.js &
SERVER_PID=$!
sleep 1
curl -sf http://127.0.0.1:3000/health && echo
curl -sf http://127.0.0.1:3000/ready && echo
kill $SERVER_PID
```
Expected: `{"status":"ok"}` and `{"status":"ready"}`.

- [ ] **Step 4: Confirm no unintended changes to existing repo behavior**

Run: `git status --short`
Expected: working tree clean (all work committed); `validate-specs.yml` and `scripts/validate-json.py` unchanged from their original content.

---

## Self-Review

**1. Spec coverage** — each spec section maps to a task:
- Architecture / `buildApp`+`server` split → Tasks 6, 7.
- Repository layout (`src/` tree) → created across Tasks 2–8; `modules/*` seams → Task 8.
- Components: config → Task 3; app → Task 6; server → Task 7; logging (folded into Fastify constructor) → Task 6; error-handler → Task 4; health → Task 5; errors → Task 2; modules → Task 8.
- Data flow (startup + request + error) → Tasks 6, 7 (startup/shutdown), 4 (error mapping), 5 (health/ready).
- Error handling & configuration (fail-fast, enum validation, error shape, no leak) → Tasks 3, 4.
- Testing (`app.inject`, mirrored layout, no coverage gate) → Tasks 2–6 tests; `vitest.config.ts` → Task 1.
- Tooling/CI/hook (deps, scripts, tsconfig, CI, hook extension, gitignore) → Tasks 1, 9, 10; `.gitignore` already correct (no task needed, per spec).
- Out-of-scope items → not implemented (correct).
- Definition of done → Task 11 verifies build, check, health/ready, fail-fast, error shape, CI presence, preserved existing behavior, and seams.
No gaps found.

**2. Placeholder scan** — no "TBD"/"TODO"/"handle edge cases"/"similar to Task N"; every code step contains full code; every test step contains real assertions. Clean.

**3. Type consistency** — `AppConfig`, `loadConfig`, `buildApp`, `registerErrorHandler`, `registerHealthRoutes`, `AppError`/`ValidationError`/`NotFoundError` names and signatures match across their defining and consuming tasks. Error codes `VALIDATION_ERROR`, `NOT_FOUND`, `INTERNAL_ERROR` are used consistently. `.js` import extensions used throughout (required by NodeNext). Consistent.
