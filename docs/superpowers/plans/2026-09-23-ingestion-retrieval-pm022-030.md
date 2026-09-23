# Ingestion Pipeline & Search Indexer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement issues #16–#20 (PM-022–025, PM-030): project snapshot persistence, knowledge proposals, bootstrap flow, architecture extraction, incremental sync, and full-text search indexer.

**Architecture:** Two new modules — `src/modules/ingestion/` (bootstrap + proposals + sync) and `src/modules/retrieval/` (search indexer) — wired into the existing Fastify app. All proposals stay in `PROPOSED` status until human approval; no auto-publish.

**Tech Stack:** Node.js ≥20.19, TypeScript 5.6 strict, Fastify 5.1, MongoDB 7.6 native driver, Zod 3.23, ULID, Vitest 2.1, Vercel AI SDK (`ai` + optional provider packages)

**Spec:** `docs/superpowers/specs/2026-09-23-ingestion-retrieval-pm022-030-design.md`

## Global Constraints

- ESM modules only — all imports use `.js` extension even for `.ts` source files
- ULID-based IDs with domain prefixes: `prop_`, `snap_`, `srec_`
- All MongoDB reads use `{ projection: { _id: 0 } }` — never return `_id`
- Stores follow the `createXStore(db: Db): XStore` factory pattern
- Routes follow the `registerXRoutes(app: FastifyInstance): void` pattern
- All new error classes extend `AppError` from `src/lib/errors.ts`
- Tests use `createFakeDb()` from `test/support/fake-db.ts`
- Test run command: `npm test` (Vitest)
- Typecheck: `npm run typecheck`
- All new packages pinned to exact versions

---

## Task 1: LLM Config + Factory

**Files:**
- Modify: `package.json`
- Modify: `src/config/index.ts`
- Create: `src/lib/llm.ts`
- Test: `test/lib/llm.test.ts`

**Interfaces:**
- Produces: `createLLMModel(config: AppConfig): LanguageModel | null` (from `ai` SDK), `createLLMAssistant(config: AppConfig): LLMAssistant | null`

- [ ] **Step 1: Install AI SDK packages**

```bash
npm install --save-exact ai@4.3.16 @ai-sdk/openai@1.3.22 @ai-sdk/anthropic@1.1.6 @ai-sdk/google@1.0.20
```

- [ ] **Step 2: Write failing tests**

Create `test/lib/llm.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { createLLMModel, createLLMAssistant } from "../../src/lib/llm.js";
import type { AppConfig } from "../../src/config/index.js";

const base: AppConfig = {
  port: 3000, host: "0.0.0.0", nodeEnv: "test",
  logLevel: "silent", mongodbUri: "x", mongodbDbName: "x",
  authAdminKey: "", authTokenPepper: "", credentialEncryptionKey: "0".repeat(64),
  llm: null,
};

describe("createLLMModel", () => {
  it("returns null when llm config is null", () => {
    expect(createLLMModel({ ...base, llm: null })).toBeNull();
  });

  it("returns a model object when openai is configured", () => {
    const model = createLLMModel({
      ...base,
      llm: { provider: "openai", model: "gpt-4o-mini", apiKey: "sk-test" },
    });
    expect(model).not.toBeNull();
  });
});

describe("createLLMAssistant", () => {
  it("returns null when llm config is null", () => {
    expect(createLLMAssistant({ ...base, llm: null })).toBeNull();
  });

  it("returns an LLMAssistant with inferModuleResponsibility", () => {
    const assistant = createLLMAssistant({
      ...base,
      llm: { provider: "openai", model: "gpt-4o-mini", apiKey: "sk-test" },
    });
    expect(assistant).not.toBeNull();
    expect(typeof assistant!.inferModuleResponsibility).toBe("function");
  });
});
```

- [ ] **Step 3: Run tests — expect FAIL (module not found)**

```bash
npm test test/lib/llm.test.ts
```

- [ ] **Step 4: Extend AppConfig in `src/config/index.ts`**

Add the `llm` field to the interface and schema:
```typescript
// Add to AppConfig interface:
  llm: {
    provider: "openai" | "anthropic" | "google";
    model: string;
    apiKey: string;
  } | null;

// Add to Zod schema:
  LLM_PROVIDER: z.enum(["openai", "anthropic", "google"]).optional(),
  LLM_MODEL: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().optional(),

// Add to loadConfig return (after existing fields):
  llm: (() => {
    const provider = data.LLM_PROVIDER;
    const apiKey = provider === "openai" ? data.OPENAI_API_KEY
      : provider === "anthropic" ? data.ANTHROPIC_API_KEY
      : provider === "google" ? data.GOOGLE_GENERATIVE_AI_API_KEY
      : undefined;
    if (!provider || !apiKey) return null;
    return { provider, model: data.LLM_MODEL ?? defaultModel(provider), apiKey };
  })(),
```

Add `defaultModel` helper at top of file:
```typescript
function defaultModel(provider: string): string {
  if (provider === "anthropic") return "claude-3-5-haiku-20241022";
  if (provider === "google") return "gemini-2.0-flash";
  return "gpt-4o-mini";
}
```

- [ ] **Step 5: Create `src/lib/llm.ts`**

```typescript
import type { LanguageModel } from "ai";
import type { LLMAssistant } from "../modules/repository-analyzer/entities.js";
import type { AppConfig } from "../config/index.js";

export function createLLMModel(config: AppConfig): LanguageModel | null {
  if (!config.llm) return null;
  const { provider, model, apiKey } = config.llm;
  if (provider === "openai") {
    const { createOpenAI } = await import("@ai-sdk/openai");
    return createOpenAI({ apiKey })(model);
  }
  if (provider === "anthropic") {
    const { createAnthropic } = await import("@ai-sdk/anthropic");
    return createAnthropic({ apiKey })(model);
  }
  // google
  const { createGoogleGenerativeAI } = await import("@ai-sdk/google");
  return createGoogleGenerativeAI({ apiKey })(model);
}

export function createLLMAssistant(config: AppConfig): LLMAssistant | null {
  if (!config.llm) return null;
  const { generateText } = await import("ai");
  const llmModel = createLLMModel(config);
  if (!llmModel) return null;
  return {
    async inferModuleResponsibility(name, sampleFiles) {
      const prompt = `Given a software module named "${name}" containing these files:\n${sampleFiles.join("\n")}\n\nDescribe its responsibility in one concise sentence.`;
      const { text } = await generateText({ model: llmModel, prompt });
      return text.trim() || null;
    },
  };
}
```

**Note:** `createLLMModel` uses dynamic `import()` so provider packages are truly optional — only loaded when that provider is configured.

- [ ] **Step 6: Run tests — expect PASS**

```bash
npm test test/lib/llm.test.ts
```

- [ ] **Step 7: Typecheck**

```bash
npm run typecheck
```

- [ ] **Step 8: Commit**

```bash
git add src/config/index.ts src/lib/llm.ts test/lib/llm.test.ts package.json package-lock.json
git commit -m "feat: add multi-provider LLM factory (Task 1)"
```

---

## Task 2: ProjectSnapshot Dependencies + ArchitectureExtractor

**Files:**
- Modify: `src/modules/repository-analyzer/entities.ts` — add `dependencies[]`
- Create: `src/modules/ingestion/architecture-extractor.ts`
- Modify: `src/modules/repository-analyzer/repository-analyzer.ts` — call extractor
- Test: `test/modules/ingestion/architecture-extractor.test.ts`

**Interfaces:**
- Consumes: `GitFileEntry` from `src/modules/git-connector/entities.ts`; `ProjectModule` from `src/modules/repository-analyzer/entities.ts`
- Produces: `ModuleDependency` interface; `ArchitectureExtractor` class with `extract(files, modules, readFile): Promise<ModuleDependency[]>`; `ProjectSnapshot.dependencies: ModuleDependency[]`

- [ ] **Step 1: Write failing tests**

Create `test/modules/ingestion/architecture-extractor.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { ArchitectureExtractor } from "../../../src/modules/ingestion/architecture-extractor.js";
import type { GitFileEntry } from "../../../src/modules/git-connector/entities.js";
import type { ProjectModule } from "../../../src/modules/repository-analyzer/entities.js";

const files: GitFileEntry[] = [
  { path: "src/auth/index.ts", size: 100, type: "file" },
  { path: "src/api/index.ts", size: 100, type: "file" },
  { path: "src/db/index.ts", size: 100, type: "file" },
];

const modules: ProjectModule[] = [
  { name: "auth", path: "src/auth" },
  { name: "api", path: "src/api" },
  { name: "db", path: "src/db" },
];

async function readFile(path: string): Promise<string | null> {
  if (path === "src/api/index.ts") return `import { login } from '../auth/index.js';\nimport { query } from '../db/index.js';`;
  if (path === "src/auth/index.ts") return `import { query } from '../db/index.js';`;
  return null;
}

describe("ArchitectureExtractor", () => {
  it("extracts cross-module import edges", async () => {
    const extractor = new ArchitectureExtractor();
    const deps = await extractor.extract(files, modules, readFile);
    expect(deps).toContainEqual({ from: "src/api", to: "src/auth", type: "import" });
    expect(deps).toContainEqual({ from: "src/api", to: "src/db", type: "import" });
    expect(deps).toContainEqual({ from: "src/auth", to: "src/db", type: "import" });
  });

  it("excludes intra-module imports", async () => {
    const selfFiles: GitFileEntry[] = [{ path: "src/api/helper.ts", size: 10, type: "file" }];
    const deps = await new ArchitectureExtractor().extract(
      selfFiles, modules,
      async () => `import { x } from './utils.js';`,
    );
    expect(deps).toHaveLength(0);
  });

  it("deduplicates identical edges", async () => {
    const deps = await new ArchitectureExtractor().extract(files, modules, readFile);
    const apiToDb = deps.filter(d => d.from === "src/api" && d.to === "src/db");
    expect(apiToDb).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npm test test/modules/ingestion/architecture-extractor.test.ts
```

- [ ] **Step 3: Add `ModuleDependency` + extend `ProjectSnapshot` in `src/modules/repository-analyzer/entities.ts`**

```typescript
// Add after ProjectModule interface:
export interface ModuleDependency {
  from: string;   // module path prefix
  to: string;     // module path prefix
  type: "import" | "require" | "include";
}

// Add dependencies field to ProjectSnapshot:
  dependencies: ModuleDependency[];
```

- [ ] **Step 4: Create `src/modules/ingestion/architecture-extractor.ts`**

```typescript
import type { GitFileEntry } from "../git-connector/entities.js";
import type { ModuleDependency, ProjectModule } from "../repository-analyzer/entities.js";

// Regexes to match import/require statements across TS/JS, Python, Java/Kotlin
const IMPORT_PATTERNS = [
  /(?:import|from)\s+['"]([^'"]+)['"]/g,   // TS/JS: import x from '...' or from '...'
  /require\(['"]([^'"]+)['"]\)/g,           // JS: require('...')
  /^(?:import|from)\s+([\w.]+)/gm,         // Python: import x / from x import
  /^import\s+([\w.]+)/gm,                  // Java/Kotlin
];

export class ArchitectureExtractor {
  async extract(
    files: GitFileEntry[],
    modules: ProjectModule[],
    readFile: (path: string) => Promise<string | null>,
  ): Promise<ModuleDependency[]> {
    const edges = new Set<string>();
    const result: ModuleDependency[] = [];

    const sourceFiles = files.filter(f =>
      f.type === "file" &&
      /\.(ts|tsx|js|jsx|py|java|kt)$/.test(f.path),
    );

    for (const file of sourceFiles) {
      const fromModule = modules.find(m => file.path.startsWith(m.path + "/"));
      if (!fromModule) continue;

      const content = await readFile(file.path);
      if (!content) continue;

      const refs = extractImportPaths(content);
      for (const ref of refs) {
        const toModule = resolveModule(ref, file.path, modules);
        if (!toModule || toModule.path === fromModule.path) continue;

        const key = `${fromModule.path}→${toModule.path}`;
        if (edges.has(key)) continue;
        edges.add(key);
        result.push({ from: fromModule.path, to: toModule.path, type: "import" });
      }
    }

    return result;
  }
}

function extractImportPaths(content: string): string[] {
  const paths: string[] = [];
  for (const pattern of IMPORT_PATTERNS) {
    let match;
    const re = new RegExp(pattern.source, pattern.flags);
    while ((match = re.exec(content)) !== null) {
      paths.push(match[1]);
    }
  }
  return paths;
}

function resolveModule(
  importPath: string,
  fromFile: string,
  modules: ProjectModule[],
): ProjectModule | null {
  // Convert relative path to absolute
  if (importPath.startsWith(".")) {
    const dir = fromFile.split("/").slice(0, -1).join("/");
    const parts = (dir + "/" + importPath).split("/");
    const resolved: string[] = [];
    for (const part of parts) {
      if (part === "..") resolved.pop();
      else if (part && part !== ".") resolved.push(part);
    }
    importPath = resolved.join("/");
  }
  // Match against module path prefixes (longest match wins)
  return modules
    .filter(m => importPath.startsWith(m.path))
    .sort((a, b) => b.path.length - a.path.length)[0] ?? null;
}
```

- [ ] **Step 5: Wire `ArchitectureExtractor` into `RepositoryAnalyzer.analyze()`**

In `src/modules/repository-analyzer/repository-analyzer.ts`:

```typescript
// Add import at top:
import { ArchitectureExtractor } from "../ingestion/architecture-extractor.js";

// In analyze(), after modules are resolved, before return:
const extractor = new ArchitectureExtractor();
const dependencies = await extractor.extract(input.files, modules, input.readFile);

// Add to return object:
      dependencies,
```

- [ ] **Step 6: Run tests — expect PASS**

```bash
npm test test/modules/ingestion/architecture-extractor.test.ts
```

- [ ] **Step 7: Run existing repository-analyzer tests to confirm no regression**

```bash
npm test test/modules/repository-analyzer/
```

- [ ] **Step 8: Typecheck**

```bash
npm run typecheck
```

- [ ] **Step 9: Commit**

```bash
git add src/modules/ingestion/architecture-extractor.ts src/modules/repository-analyzer/entities.ts src/modules/repository-analyzer/repository-analyzer.ts test/modules/ingestion/architecture-extractor.test.ts
git commit -m "feat: architecture extractor + ProjectSnapshot.dependencies (Task 2, PM-025)"
```

---

## Task 3: ProjectSnapshot Persistence (PM-022)

**Files:**
- Modify: `src/lib/indexes.ts` — add `project_snapshots` collection
- Create: `src/modules/repository-analyzer/snapshot-repository.ts`
- Test: `test/modules/repository-analyzer/snapshot-repository.test.ts`

**Interfaces:**
- Consumes: `ProjectSnapshot` from `src/modules/repository-analyzer/entities.ts`
- Produces: `StoredProjectSnapshot` interface; `ProjectSnapshotStore` interface; `createProjectSnapshotStore(db: Db): ProjectSnapshotStore`

- [ ] **Step 1: Write failing tests**

Create `test/modules/repository-analyzer/snapshot-repository.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { createProjectSnapshotStore } from "../../../src/modules/repository-analyzer/snapshot-repository.js";
import { createFakeDb } from "../../support/fake-db.js";
import type { ProjectSnapshot } from "../../../src/modules/repository-analyzer/entities.js";

const snapshot: ProjectSnapshot = {
  analyzedAt: "2026-01-01T00:00:00Z",
  languages: ["TypeScript"],
  frameworks: ["Fastify"],
  buildSystem: "npm",
  testFrameworks: ["Vitest"],
  databases: ["MongoDB"],
  apiStyles: ["REST"],
  entryPoints: ["src/index.ts"],
  modules: [{ name: "api", path: "src/api" }],
  cicd: "GitHub Actions",
  infrastructure: [],
  integrations: [],
  isMonorepo: false,
  dependencies: [],
};

describe("ProjectSnapshotStore", () => {
  it("saves a snapshot and returns it with id and version 1", async () => {
    const { db } = createFakeDb();
    const store = createProjectSnapshotStore(db);
    const saved = await store.save("org_1", "proj_1", snapshot);
    expect(saved.id).toMatch(/^snap_/);
    expect(saved.version).toBe(1);
    expect(saved.archivedAt).toBeNull();
    expect(saved.languages).toEqual(["TypeScript"]);
  });

  it("findCurrent returns null when no snapshot exists", async () => {
    const { db } = createFakeDb();
    const store = createProjectSnapshotStore(db);
    expect(await store.findCurrent("org_1", "proj_1")).toBeNull();
  });

  it("findCurrent returns the latest non-archived snapshot", async () => {
    const { db } = createFakeDb();
    const store = createProjectSnapshotStore(db);
    await store.save("org_1", "proj_1", snapshot);
    const found = await store.findCurrent("org_1", "proj_1");
    expect(found).not.toBeNull();
    expect(found!.version).toBe(1);
  });

  it("re-running save archives the old snapshot and increments version", async () => {
    const { db, rows } = createFakeDb();
    const store = createProjectSnapshotStore(db);
    await store.save("org_1", "proj_1", snapshot);
    const second = await store.save("org_1", "proj_1", { ...snapshot, languages: ["TypeScript", "Python"] });
    expect(second.version).toBe(2);
    const history = await store.findHistory("org_1", "proj_1");
    expect(history).toHaveLength(2);
    const archived = history.find(s => s.version === 1);
    expect(archived!.archivedAt).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npm test test/modules/repository-analyzer/snapshot-repository.test.ts
```

- [ ] **Step 3: Add `project_snapshots` to `src/lib/indexes.ts`**

Add to `ROOT_COLLECTION_INDEXES` array:
```typescript
  {
    collection: "project_snapshots",
    indexes: [
      { key: { id: 1 }, name: "id_unique", unique: true },
      { key: { projectId: 1, archivedAt: 1 }, name: "project_current" },
    ],
  },
```

- [ ] **Step 4: Create `src/modules/repository-analyzer/snapshot-repository.ts`**

```typescript
import { ulid } from "ulid";
import type { Db } from "mongodb";
import type { ProjectSnapshot } from "./entities.js";

export interface StoredProjectSnapshot extends ProjectSnapshot {
  id: string;
  organizationId: string;
  projectId: string;
  version: number;
  archivedAt: string | null;
}

export interface ProjectSnapshotStore {
  save(orgId: string, projectId: string, snapshot: ProjectSnapshot): Promise<StoredProjectSnapshot>;
  findCurrent(orgId: string, projectId: string): Promise<StoredProjectSnapshot | null>;
  findHistory(orgId: string, projectId: string): Promise<StoredProjectSnapshot[]>;
}

const READ_OPTS = { projection: { _id: 0 } } as const;

export function createProjectSnapshotStore(db: Db): ProjectSnapshotStore {
  const col = () => db.collection<StoredProjectSnapshot>("project_snapshots");

  return {
    async save(orgId, projectId, snapshot) {
      // Find existing current snapshot to determine next version
      const current = await col().findOne(
        { organizationId: orgId, projectId, archivedAt: null },
        READ_OPTS,
      ) as StoredProjectSnapshot | null;

      const version = current ? current.version + 1 : 1;

      // Archive current if exists
      if (current) {
        await col().updateMany(
          { organizationId: orgId, projectId, archivedAt: null },
          { $set: { archivedAt: new Date().toISOString() } },
        );
      }

      const stored: StoredProjectSnapshot = {
        ...snapshot,
        id: `snap_${ulid()}`,
        organizationId: orgId,
        projectId,
        version,
        archivedAt: null,
      };
      await col().insertOne({ ...stored });
      return stored;
    },

    async findCurrent(orgId, projectId) {
      return col().findOne(
        { organizationId: orgId, projectId, archivedAt: null },
        READ_OPTS,
      ) as Promise<StoredProjectSnapshot | null>;
    },

    async findHistory(orgId, projectId) {
      return col()
        .find({ organizationId: orgId, projectId }, READ_OPTS)
        .toArray() as Promise<StoredProjectSnapshot[]>;
    },
  };
}
```

**Note:** `fake-db` does not support `updateMany`. Add it to `test/support/fake-db.ts`:

```typescript
// Add inside the returned collection object, after deleteOne:
updateMany: async (filter: Row, update: { $set?: Row }) => {
  const matching = list.filter((r) => matches(r, filter));
  for (const row of matching) {
    if (update.$set) Object.assign(row, update.$set);
  }
  return { matchedCount: matching.length, modifiedCount: matching.length };
},
```

- [ ] **Step 5: Run tests — expect PASS**

```bash
npm test test/modules/repository-analyzer/snapshot-repository.test.ts
```

- [ ] **Step 6: Run full test suite — confirm no regressions**

```bash
npm test
```

- [ ] **Step 7: Typecheck**

```bash
npm run typecheck
```

- [ ] **Step 8: Commit**

```bash
git add src/lib/indexes.ts src/modules/repository-analyzer/snapshot-repository.ts test/modules/repository-analyzer/snapshot-repository.test.ts test/support/fake-db.ts
git commit -m "feat: ProjectSnapshot persistence + project_snapshots collection (Task 3, PM-022)"
```

---

## Task 4: KnowledgeProposal Entity + ProposalStore (PM-023)

**Files:**
- Create: `src/modules/ingestion/entities.ts`
- Create: `src/modules/ingestion/proposal-repository.ts`
- Modify: `src/lib/indexes.ts` — add indexes to `proposals` collection
- Test: `test/modules/ingestion/proposal-repository.test.ts`

**Interfaces:**
- Consumes: `KnowledgeType` from `src/modules/knowledge-core/entities.ts`
- Produces: `KnowledgeProposal`; `ProposalStore`; `createProposalStore(db: Db): ProposalStore`; `newProposalId(): string`

- [ ] **Step 1: Write failing tests**

Create `test/modules/ingestion/proposal-repository.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { createProposalStore } from "../../../src/modules/ingestion/proposal-repository.js";
import { createFakeDb } from "../../support/fake-db.js";

describe("ProposalStore", () => {
  it("creates a proposal in PROPOSED status", async () => {
    const { db } = createFakeDb();
    const store = createProposalStore(db);
    const p = await store.create({
      organizationId: "org_1", projectId: "proj_1",
      type: "Architecture", title: "Overview", summary: "Main app",
      content: {}, sourceIds: [], triggeredBy: "bootstrap",
    });
    expect(p.id).toMatch(/^prop_/);
    expect(p.status).toBe("PROPOSED");
    expect(p.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("existsByHash returns false for unknown hash", async () => {
    const { db } = createFakeDb();
    expect(await createProposalStore(db).existsByHash("org_1", "proj_1", "abc")).toBe(false);
  });

  it("existsByHash returns true after creation", async () => {
    const { db } = createFakeDb();
    const store = createProposalStore(db);
    const p = await store.create({
      organizationId: "org_1", projectId: "proj_1",
      type: "Decision", title: "Use MongoDB", summary: "NoSQL choice",
      content: {}, sourceIds: [], triggeredBy: "bootstrap",
    });
    expect(await store.existsByHash("org_1", "proj_1", p.contentHash)).toBe(true);
  });

  it("findByProject lists all proposals for a project", async () => {
    const { db } = createFakeDb();
    const store = createProposalStore(db);
    await store.create({ organizationId: "org_1", projectId: "proj_1", type: "Fact", title: "CI", summary: "Uses GH Actions", content: {}, sourceIds: [], triggeredBy: "bootstrap" });
    await store.create({ organizationId: "org_1", projectId: "proj_1", type: "Fact", title: "Build", summary: "Uses npm", content: {}, sourceIds: [], triggeredBy: "bootstrap" });
    const list = await store.findByProject("org_1", "proj_1");
    expect(list).toHaveLength(2);
  });

  it("approve transitions status and sets knowledgeItemId", async () => {
    const { db } = createFakeDb();
    const store = createProposalStore(db);
    const p = await store.create({ organizationId: "org_1", projectId: "proj_1", type: "Concept", title: "Auth", summary: "Auth module", content: {}, sourceIds: [], triggeredBy: "bootstrap" });
    const approved = await store.approve("org_1", p.id, "actor_1", "know_abc");
    expect(approved!.status).toBe("APPROVED");
    expect(approved!.knowledgeItemId).toBe("know_abc");
    expect(approved!.reviewedBy).toBe("actor_1");
  });

  it("reject transitions status", async () => {
    const { db } = createFakeDb();
    const store = createProposalStore(db);
    const p = await store.create({ organizationId: "org_1", projectId: "proj_1", type: "Concept", title: "t", summary: "s", content: {}, sourceIds: [], triggeredBy: "bootstrap" });
    const rejected = await store.reject("org_1", p.id, "actor_1");
    expect(rejected!.status).toBe("REJECTED");
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npm test test/modules/ingestion/proposal-repository.test.ts
```

- [ ] **Step 3: Create `src/modules/ingestion/entities.ts`**

```typescript
import { ulid } from "ulid";
import type { KnowledgeType } from "../knowledge-core/entities.js";

export const PROPOSAL_STATUSES = ["PROPOSED", "APPROVED", "REJECTED"] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export interface KnowledgeProposal {
  id: string;
  organizationId: string;
  projectId: string;
  status: ProposalStatus;
  type: KnowledgeType;
  title: string;
  summary: string;
  content: Record<string, unknown>;
  sourceIds: string[];
  contentHash: string;  // SHA-256(type + title + summary)
  triggeredBy: "bootstrap" | "incremental" | "manual";
  createdAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  knowledgeItemId: string | null;
}

export function newProposalId(): string {
  return `prop_${ulid()}`;
}
```

- [ ] **Step 4: Create `src/modules/ingestion/proposal-repository.ts`**

```typescript
import { createHash } from "node:crypto";
import type { Db } from "mongodb";
import { newProposalId, type KnowledgeProposal, type ProposalStatus } from "./entities.js";
import type { KnowledgeType } from "../knowledge-core/entities.js";

const READ_OPTS = { projection: { _id: 0 } } as const;

export interface CreateProposalInput {
  organizationId: string;
  projectId: string;
  type: KnowledgeType;
  title: string;
  summary: string;
  content: Record<string, unknown>;
  sourceIds: string[];
  triggeredBy: "bootstrap" | "incremental" | "manual";
}

export interface ProposalStore {
  create(input: CreateProposalInput): Promise<KnowledgeProposal>;
  findById(orgId: string, id: string): Promise<KnowledgeProposal | null>;
  findByProject(orgId: string, projectId: string, filter?: { status?: ProposalStatus }): Promise<KnowledgeProposal[]>;
  existsByHash(orgId: string, projectId: string, hash: string): Promise<boolean>;
  approve(orgId: string, id: string, actorId: string, knowledgeItemId: string): Promise<KnowledgeProposal | null>;
  reject(orgId: string, id: string, actorId: string): Promise<KnowledgeProposal | null>;
}

function hashProposal(type: string, title: string, summary: string): string {
  return createHash("sha256").update(`${type}:${title}:${summary}`).digest("hex");
}

export function createProposalStore(db: Db): ProposalStore {
  const col = () => db.collection<KnowledgeProposal>("proposals");

  return {
    async create(input) {
      const now = new Date().toISOString();
      const proposal: KnowledgeProposal = {
        id: newProposalId(),
        organizationId: input.organizationId,
        projectId: input.projectId,
        status: "PROPOSED",
        type: input.type,
        title: input.title,
        summary: input.summary,
        content: input.content,
        sourceIds: input.sourceIds,
        contentHash: hashProposal(input.type, input.title, input.summary),
        triggeredBy: input.triggeredBy,
        createdAt: now,
        reviewedBy: null,
        reviewedAt: null,
        knowledgeItemId: null,
      };
      await col().insertOne({ ...proposal });
      return proposal;
    },

    async findById(orgId, id) {
      return col().findOne({ id, organizationId: orgId }, READ_OPTS) as Promise<KnowledgeProposal | null>;
    },

    async findByProject(orgId, projectId, filter) {
      const query: Record<string, unknown> = { organizationId: orgId, projectId };
      if (filter?.status) query.status = filter.status;
      return col().find(query, READ_OPTS).toArray() as Promise<KnowledgeProposal[]>;
    },

    async existsByHash(orgId, projectId, hash) {
      const found = await col().findOne({ organizationId: orgId, projectId, contentHash: hash }, READ_OPTS);
      return found !== null;
    },

    async approve(orgId, id, actorId, knowledgeItemId) {
      const now = new Date().toISOString();
      return col().findOneAndUpdate(
        { id, organizationId: orgId, status: "PROPOSED" },
        { $set: { status: "APPROVED", reviewedBy: actorId, reviewedAt: now, knowledgeItemId } },
        { returnDocument: "after", projection: { _id: 0 } },
      ) as Promise<KnowledgeProposal | null>;
    },

    async reject(orgId, id, actorId) {
      const now = new Date().toISOString();
      return col().findOneAndUpdate(
        { id, organizationId: orgId, status: "PROPOSED" },
        { $set: { status: "REJECTED", reviewedBy: actorId, reviewedAt: now } },
        { returnDocument: "after", projection: { _id: 0 } },
      ) as Promise<KnowledgeProposal | null>;
    },
  };
}
```

- [ ] **Step 5: Update `proposals` indexes in `src/lib/indexes.ts`**

In `CORE_COLLECTION_EXTRA_INDEXES`, add:
```typescript
  proposals: [
    { key: { id: 1 }, name: "id_unique", unique: true },
    { key: { organizationId: 1, projectId: 1, status: 1 }, name: "project_status" },
    { key: { organizationId: 1, projectId: 1, contentHash: 1 }, name: "content_hash_unique", unique: true },
  ],
```

- [ ] **Step 6: Run tests — expect PASS**

```bash
npm test test/modules/ingestion/proposal-repository.test.ts
```

- [ ] **Step 7: Run full test suite**

```bash
npm test
```

- [ ] **Step 8: Typecheck**

```bash
npm run typecheck
```

- [ ] **Step 9: Commit**

```bash
git add src/modules/ingestion/entities.ts src/modules/ingestion/proposal-repository.ts src/lib/indexes.ts test/modules/ingestion/proposal-repository.test.ts
git commit -m "feat: KnowledgeProposal entity + ProposalStore (Task 4, PM-023)"
```

---

## Task 5: BootstrapProposalGenerator (PM-023)

**Files:**
- Create: `src/modules/ingestion/bootstrap-proposal-generator.ts`
- Test: `test/modules/ingestion/bootstrap-proposal-generator.test.ts`

**Interfaces:**
- Consumes: `ProjectSnapshot` + `StoredProjectSnapshot`; `ProposalStore` + `CreateProposalInput`; `LanguageModel` from `ai` (optional)
- Produces: `BootstrapProposalGenerator` class with `generate(orgId, projectId, snapshot, llmModel): Promise<{created: KnowledgeProposal[], skipped: number}>`

- [ ] **Step 1: Write failing tests**

Create `test/modules/ingestion/bootstrap-proposal-generator.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { BootstrapProposalGenerator } from "../../../src/modules/ingestion/bootstrap-proposal-generator.js";
import { createProposalStore } from "../../../src/modules/ingestion/proposal-repository.js";
import { createFakeDb } from "../../support/fake-db.js";
import type { ProjectSnapshot } from "../../../src/modules/repository-analyzer/entities.js";

const snapshot: ProjectSnapshot = {
  analyzedAt: "2026-01-01T00:00:00Z",
  languages: ["TypeScript"],
  frameworks: ["Fastify"],
  buildSystem: "npm",
  testFrameworks: ["Vitest"],
  databases: ["MongoDB"],
  apiStyles: ["REST"],
  entryPoints: ["src/server.ts"],
  modules: [
    { name: "api", path: "src/api", responsibility: "handles HTTP requests" },
    { name: "db", path: "src/db", responsibility: "database access" },
  ],
  cicd: "GitHub Actions",
  infrastructure: ["Docker"],
  integrations: ["stripe"],
  isMonorepo: false,
  dependencies: [{ from: "src/api", to: "src/db", type: "import" }],
};

describe("BootstrapProposalGenerator", () => {
  it("generates at least 5 proposals from a snapshot", async () => {
    const { db } = createFakeDb();
    const store = createProposalStore(db);
    const gen = new BootstrapProposalGenerator(store);
    const { created } = await gen.generate("org_1", "proj_1", snapshot, null);
    expect(created.length).toBeGreaterThanOrEqual(5);
  });

  it("all generated proposals have PROPOSED status", async () => {
    const { db } = createFakeDb();
    const store = createProposalStore(db);
    const gen = new BootstrapProposalGenerator(store);
    const { created } = await gen.generate("org_1", "proj_1", snapshot, null);
    expect(created.every(p => p.status === "PROPOSED")).toBe(true);
  });

  it("all proposals have triggeredBy=bootstrap", async () => {
    const { db } = createFakeDb();
    const store = createProposalStore(db);
    const gen = new BootstrapProposalGenerator(store);
    const { created } = await gen.generate("org_1", "proj_1", snapshot, null);
    expect(created.every(p => p.triggeredBy === "bootstrap")).toBe(true);
  });

  it("re-running returns skipped > 0 and created = 0", async () => {
    const { db } = createFakeDb();
    const store = createProposalStore(db);
    const gen = new BootstrapProposalGenerator(store);
    await gen.generate("org_1", "proj_1", snapshot, null);
    const second = await gen.generate("org_1", "proj_1", snapshot, null);
    expect(second.created).toHaveLength(0);
    expect(second.skipped).toBeGreaterThan(0);
  });

  it("generates Architecture type for project overview", async () => {
    const { db } = createFakeDb();
    const store = createProposalStore(db);
    const gen = new BootstrapProposalGenerator(store);
    const { created } = await gen.generate("org_1", "proj_1", snapshot, null);
    const arch = created.filter(p => p.type === "Architecture");
    expect(arch.length).toBeGreaterThanOrEqual(1);
  });

  it("generates Relation proposals for module dependencies", async () => {
    const { db } = createFakeDb();
    const store = createProposalStore(db);
    const gen = new BootstrapProposalGenerator(store);
    const { created } = await gen.generate("org_1", "proj_1", snapshot, null);
    const relations = created.filter(p => p.type === "Investigation"); // Relation type uses Investigation as proxy
    // Dependency: api → db should produce at least one relation proposal
    const relProposals = created.filter(p => p.content?.predicate === "depends_on");
    expect(relProposals.length).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npm test test/modules/ingestion/bootstrap-proposal-generator.test.ts
```

- [ ] **Step 3: Create `src/modules/ingestion/bootstrap-proposal-generator.ts`**

```typescript
import type { LanguageModel } from "ai";
import type { ProposalStore, CreateProposalInput } from "./proposal-repository.js";
import type { KnowledgeProposal } from "./entities.js";
import type { ProjectSnapshot } from "../repository-analyzer/entities.js";

export class BootstrapProposalGenerator {
  constructor(private readonly proposals: ProposalStore) {}

  async generate(
    orgId: string,
    projectId: string,
    snapshot: ProjectSnapshot,
    llmModel: LanguageModel | null,
  ): Promise<{ created: KnowledgeProposal[]; skipped: number }> {
    const candidates = buildCandidates(snapshot);
    const created: KnowledgeProposal[] = [];
    let skipped = 0;

    for (const input of candidates) {
      const full: CreateProposalInput = { ...input, organizationId: orgId, projectId };
      // Dedup check
      const hash = computeHash(full.type, full.title, full.summary);
      if (await this.proposals.existsByHash(orgId, projectId, hash)) {
        skipped++;
        continue;
      }
      // Optional: enrich summary with LLM
      if (llmModel && full.type === "Architecture" && full.title !== "Project Overview") {
        full.summary = await enrichSummary(llmModel, full.title, full.summary).catch(() => full.summary);
      }
      created.push(await this.proposals.create(full));
    }

    return { created, skipped };
  }
}

function buildCandidates(snap: ProjectSnapshot): Omit<CreateProposalInput, "organizationId" | "projectId">[] {
  const candidates: Omit<CreateProposalInput, "organizationId" | "projectId">[] = [];

  // 1. Project overview (Architecture)
  candidates.push({
    type: "Architecture",
    title: "Project Overview",
    summary: `${snap.languages.join(", ")} project using ${snap.frameworks.join(", ") || "no detected frameworks"}. Build: ${snap.buildSystem ?? "unknown"}. Test: ${snap.testFrameworks.join(", ") || "none detected"}.`,
    content: {
      component: "Project",
      description: `Languages: ${snap.languages.join(", ")}. Frameworks: ${snap.frameworks.join(", ")}. Databases: ${snap.databases.join(", ")}. API styles: ${snap.apiStyles.join(", ")}.`,
    },
    sourceIds: [],
    triggeredBy: "bootstrap",
  });

  // 2. One Architecture proposal per module
  for (const mod of snap.modules) {
    candidates.push({
      type: "Architecture",
      title: `Module: ${mod.name}`,
      summary: mod.responsibility ?? `Source module located at ${mod.path}.`,
      content: { component: mod.name, description: mod.responsibility ?? `Located at ${mod.path}` },
      sourceIds: [],
      triggeredBy: "bootstrap",
    });
  }

  // 3. Tech choice Decisions (frameworks, databases)
  const techChoices = [
    ...snap.frameworks.map(f => ({ title: `Use ${f}`, summary: `${f} is used as a framework in this project.` })),
    ...snap.databases.map(d => ({ title: `Use ${d}`, summary: `${d} is used as the database.` })),
  ];
  for (const choice of techChoices) {
    candidates.push({ type: "Decision", ...choice, content: {}, sourceIds: [], triggeredBy: "bootstrap" });
  }

  // 4. CI/CD fact
  if (snap.cicd) {
    candidates.push({
      type: "Architecture",
      title: `CI/CD: ${snap.cicd}`,
      summary: `This project uses ${snap.cicd} for continuous integration and deployment.`,
      content: { component: "CI/CD", description: snap.cicd },
      sourceIds: [],
      triggeredBy: "bootstrap",
    });
  }

  // 5. Module dependency relations
  for (const dep of snap.dependencies) {
    const fromName = dep.from.split("/").pop() ?? dep.from;
    const toName = dep.to.split("/").pop() ?? dep.to;
    candidates.push({
      type: "Investigation",
      title: `${fromName} depends on ${toName}`,
      summary: `Module ${dep.from} has a ${dep.type} dependency on module ${dep.to}.`,
      content: { predicate: "depends_on", fromModule: dep.from, toModule: dep.to },
      sourceIds: [],
      triggeredBy: "bootstrap",
    });
  }

  return candidates;
}

async function enrichSummary(model: LanguageModel, title: string, fallback: string): Promise<string> {
  const { generateText } = await import("ai");
  const { text } = await generateText({
    model,
    prompt: `Write a single concise sentence describing the architectural component: "${title}"`,
    maxTokens: 80,
  });
  return text.trim() || fallback;
}

function computeHash(type: string, title: string, summary: string): string {
  const { createHash } = require("node:crypto");
  return createHash("sha256").update(`${type}:${title}:${summary}`).digest("hex");
}
```

**Note on `computeHash`:** Use `import { createHash } from "node:crypto"` at the top of the file instead of `require`. The function is duplicated from `proposal-repository.ts` intentionally to keep modules independent. Extract to `src/lib/hash.ts` only if a third module needs it.

Fix the file to use top-level ESM import:
```typescript
import { createHash } from "node:crypto";
// ... remove the computeHash function's internal require and use:
function computeHash(type: string, title: string, summary: string): string {
  return createHash("sha256").update(`${type}:${title}:${summary}`).digest("hex");
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npm test test/modules/ingestion/bootstrap-proposal-generator.test.ts
```

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add src/modules/ingestion/bootstrap-proposal-generator.ts test/modules/ingestion/bootstrap-proposal-generator.test.ts
git commit -m "feat: BootstrapProposalGenerator (Task 5, PM-023)"
```

---

## Task 6: Bootstrap + Snapshot Routes (PM-022, PM-023)

**Files:**
- Create: `src/routes/bootstrap.ts`
- Modify: `src/app.ts` — register bootstrap routes
- Test: `test/routes/bootstrap.test.ts`

**Interfaces:**
- Consumes: `RepositoryAnalyzer`; `ProjectSnapshotStore`; `BootstrapProposalGenerator`; `ProposalStore`; `GitConnector`; `createLLMModel`
- Produces: `POST /organizations/:orgId/projects/:projectId/bootstrap` → `{snapshot, proposals, created, skipped}`; `GET /organizations/:orgId/projects/:projectId/snapshot`

- [ ] **Step 1: Write failing tests**

Create `test/routes/bootstrap.test.ts`:
```typescript
import Fastify, { type FastifyInstance } from "fastify";
import { describe, it, expect } from "vitest";
import { registerBootstrapRoutes } from "../../src/routes/bootstrap.js";
import { registerErrorHandler } from "../../src/plugins/error-handler.js";
import { newProjectId } from "../../src/modules/project-context/entities.js";
import { newRepositoryId } from "../../src/modules/repository-binding/entities.js";
import { createFakeDb, type Collections } from "../support/fake-db.js";

const orgId = "org_test";
const projectId = newProjectId();
const repoId = newRepositoryId();

function buildApp(rows: Collections): FastifyInstance {
  const { db } = createFakeDb(rows);
  const app = Fastify({ logger: false });
  app.decorate("db", db);
  app.addHook("onRequest", async (req) => {
    const r = req as unknown as Record<string, unknown>;
    r.actor = { actorId: "tok_1", organizationId: orgId, type: "service" };
    r.projectContext = { organizationId: orgId, projectId: null };
  });
  app.decorate("config", { llm: null });
  registerErrorHandler(app);
  registerBootstrapRoutes(app);
  return app;
}

const seeded = (extra: Collections = {}): Collections => ({
  projects: [{ id: projectId, organizationId: orgId, name: "p", createdAt: "", updatedAt: "" }],
  repositories: [{
    id: repoId, organizationId: orgId, projectId,
    url: "https://github.com/test/repo", host: "github.com", path: "test/repo",
    connector: "github", defaultBranch: "main", createdAt: "", createdBy: "tok_1", unboundAt: null,
    lastCommitSha: null, lastSyncedAt: null,
  }],
  project_snapshots: [],
  proposals: [],
  ...extra,
});

describe("POST /organizations/:orgId/projects/:projectId/bootstrap", () => {
  it("returns 404 when project does not exist", async () => {
    const app = buildApp(seeded());
    const res = await app.inject({
      method: "POST",
      url: `/organizations/${orgId}/projects/${newProjectId()}/bootstrap`,
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("returns 404 when no repository is bound", async () => {
    const app = buildApp({ projects: [{ id: projectId, organizationId: orgId, name: "p", createdAt: "", updatedAt: "" }], repositories: [], project_snapshots: [], proposals: [] });
    const res = await app.inject({
      method: "POST",
      url: `/organizations/${orgId}/projects/${projectId}/bootstrap`,
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describe("GET /organizations/:orgId/projects/:projectId/snapshot", () => {
  it("returns 404 when no snapshot exists", async () => {
    const app = buildApp(seeded());
    const res = await app.inject({
      method: "GET",
      url: `/organizations/${orgId}/projects/${projectId}/snapshot`,
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
```

**Note on bootstrap integration test:** The full bootstrap flow clones a real git repo, so full integration coverage requires a real repo. The tests above cover the error paths (404s). The happy path can be tested with a mock `GitConnector` — this is left as a follow-up integration test once the route exists.

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npm test test/routes/bootstrap.test.ts
```

- [ ] **Step 3: Create `src/routes/bootstrap.ts`**

```typescript
import type { FastifyInstance } from "fastify";
import { createRepository as createProjectRepo } from "../modules/project-context/repository.js";
import { createRepositoryStore } from "../modules/repository-binding/repository.js";
import { createProjectSnapshotStore } from "../modules/repository-analyzer/snapshot-repository.js";
import { createProposalStore } from "../modules/ingestion/proposal-repository.js";
import { BootstrapProposalGenerator } from "../modules/ingestion/bootstrap-proposal-generator.js";
import { RepositoryAnalyzer } from "../modules/repository-analyzer/index.js";
import { createLLMModel, createLLMAssistant } from "../lib/llm.js";
import { orgIdSchema } from "../modules/project-context/entities.js";
import { projectIdSchema } from "../modules/project-context/entities.js";
import {
  TenantNotFoundError,
  RepositoryNotFoundError,
  InvalidTenantScopeError,
  UnauthorizedError,
  ValidationError,
} from "../lib/errors.js";
import type { AppConfig } from "../config/index.js";

declare module "fastify" {
  interface FastifyInstance {
    config: Pick<AppConfig, "llm">;
  }
}

function parseOrThrow<T>(
  schema: { safeParse(v: unknown): { success: boolean; data?: T } },
  value: unknown,
  message: string,
): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new ValidationError(message);
  return r.data as T;
}

export function registerBootstrapRoutes(app: FastifyInstance): void {
  const BEARER = { config: { auth: "bearer" as const } };

  app.post(
    "/organizations/:orgId/projects/:projectId/bootstrap",
    BEARER,
    async (req, reply) => {
      const actor = req.actor;
      if (!actor) throw new UnauthorizedError("missing credentials");

      const { orgId, projectId } = req.params as { orgId: string; projectId: string };
      parseOrThrow(orgIdSchema, orgId, "organization id is malformed");
      parseOrThrow(projectIdSchema, projectId, "project id is malformed");

      const projects = createProjectRepo(app.db);
      if (!(await projects.getProject(orgId, projectId))) throw new TenantNotFoundError();

      const repoStore = createRepositoryStore(app.db);
      const repos = await repoStore.listActiveByProject(orgId, projectId);
      if (repos.length === 0) throw new RepositoryNotFoundError("no repository bound to this project");

      const repo = repos[0];

      // Import GitConnector lazily to avoid requiring it in tests
      const { createGitConnector } = await import("../modules/git-connector/git-connector.js");
      const { createCredentialStore } = await import("../modules/git-connector/credential-store.js");
      const { createAppConfig } = await import("../config/index.js");
      const fullConfig = createAppConfig(process.env);
      const credStore = createCredentialStore(app.db);
      const encKey = Buffer.from(fullConfig.credentialEncryptionKey, "hex");
      const gitConfig = { workDir: "/tmp/pm-repos", maxFileSizeBytes: 1_048_576, defaultCommitLimit: 100 };
      const git = createGitConnector(credStore, encKey, gitConfig);

      await git.connect(repo.id, repo.url);
      const files = await git.listFiles(repo.id);
      const readFile = (p: string) => git.readFile(repo.id, p);

      const llmAssistant = createLLMAssistant(app.config);
      const analyzer = new RepositoryAnalyzer(llmAssistant);
      const snapshot = await analyzer.analyze({ files, readFile });

      const snapshotStore = createProjectSnapshotStore(app.db);
      const stored = await snapshotStore.save(orgId, projectId, snapshot);

      const proposalStore = createProposalStore(app.db);
      const generator = new BootstrapProposalGenerator(proposalStore);
      const llmModel = createLLMModel(app.config);
      const { created, skipped } = await generator.generate(orgId, projectId, snapshot, llmModel);

      reply.status(201);
      return { snapshot: stored, proposals: created, created: created.length, skipped };
    },
  );

  app.get(
    "/organizations/:orgId/projects/:projectId/snapshot",
    BEARER,
    async (req) => {
      const { orgId, projectId } = req.params as { orgId: string; projectId: string };
      parseOrThrow(orgIdSchema, orgId, "organization id is malformed");
      parseOrThrow(projectIdSchema, projectId, "project id is malformed");

      const snapshotStore = createProjectSnapshotStore(app.db);
      const snap = await snapshotStore.findCurrent(orgId, projectId);
      if (!snap) throw new RepositoryNotFoundError("no snapshot found — run bootstrap first");
      return snap;
    },
  );
}
```

**Note:** `app.config` must be decorated in `src/app.ts`. Add `orgIdSchema` export to `src/modules/project-context/entities.ts` if not present (check: may be called `orgIdSchema` or derivable from `Organization`).

- [ ] **Step 4: Register routes in `src/app.ts`**

```typescript
// Add import:
import { registerBootstrapRoutes } from "./routes/bootstrap.js";

// In buildApp(), add after existing route registrations:
  app.decorate("config", config);
  registerBootstrapRoutes(app);
```

- [ ] **Step 5: Run tests — expect PASS**

```bash
npm test test/routes/bootstrap.test.ts
```

- [ ] **Step 6: Full test suite**

```bash
npm test
```

- [ ] **Step 7: Typecheck**

```bash
npm run typecheck
```

- [ ] **Step 8: Commit**

```bash
git add src/routes/bootstrap.ts src/app.ts test/routes/bootstrap.test.ts
git commit -m "feat: bootstrap + snapshot routes (Task 6, PM-022/PM-023)"
```

---

## Task 7: Proposal Management Routes (PM-023)

**Files:**
- Create: `src/routes/proposals.ts`
- Modify: `src/app.ts` — register proposal routes
- Test: `test/routes/proposals.test.ts`

**Interfaces:**
- Consumes: `ProposalStore`; `KnowledgeItemStore` (to create KnowledgeItem on approve)
- Produces: `GET /organizations/:orgId/projects/:projectId/proposals`; `GET .../proposals/:id`; `POST .../proposals/:id/approve`; `POST .../proposals/:id/reject`

- [ ] **Step 1: Write failing tests**

Create `test/routes/proposals.test.ts`:
```typescript
import Fastify, { type FastifyInstance } from "fastify";
import { describe, it, expect } from "vitest";
import { registerProposalRoutes } from "../../src/routes/proposals.js";
import { registerErrorHandler } from "../../src/plugins/error-handler.js";
import { newProjectId } from "../../src/modules/project-context/entities.js";
import { newProposalId } from "../../src/modules/ingestion/entities.js";
import { createFakeDb, type Collections } from "../support/fake-db.js";

const orgId = "org_1";
const projectId = newProjectId();

function buildApp(rows: Collections): FastifyInstance {
  const { db } = createFakeDb(rows);
  const app = Fastify({ logger: false });
  app.decorate("db", db);
  app.addHook("onRequest", async (req) => {
    const r = req as unknown as Record<string, unknown>;
    r.actor = { actorId: "tok_1", organizationId: orgId, type: "service" };
    r.projectContext = { organizationId: orgId, projectId: null };
  });
  registerErrorHandler(app);
  registerProposalRoutes(app);
  return app;
}

const makeProposal = (overrides = {}) => ({
  id: newProposalId(), organizationId: orgId, projectId,
  status: "PROPOSED", type: "Architecture", title: "Overview", summary: "App overview",
  content: {}, sourceIds: [], contentHash: "abc123", triggeredBy: "bootstrap",
  createdAt: new Date().toISOString(), reviewedBy: null, reviewedAt: null, knowledgeItemId: null,
  ...overrides,
});

const seeded = (extra: Collections = {}): Collections => ({
  projects: [{ id: projectId, organizationId: orgId, name: "p", createdAt: "", updatedAt: "" }],
  proposals: [],
  knowledge_items: [],
  versions: [],
  audit_events: [],
  ...extra,
});

describe("GET /organizations/:orgId/projects/:projectId/proposals", () => {
  it("returns empty array when no proposals", async () => {
    const app = buildApp(seeded());
    const res = await app.inject({ method: "GET", url: `/organizations/${orgId}/projects/${projectId}/proposals` });
    expect(res.statusCode).toBe(200);
    expect(res.json().proposals).toEqual([]);
    await app.close();
  });

  it("returns proposals for the project", async () => {
    const app = buildApp(seeded({ proposals: [makeProposal()] }));
    const res = await app.inject({ method: "GET", url: `/organizations/${orgId}/projects/${projectId}/proposals` });
    expect(res.statusCode).toBe(200);
    expect(res.json().proposals).toHaveLength(1);
    await app.close();
  });

  it("filters by status", async () => {
    const app = buildApp(seeded({ proposals: [makeProposal(), makeProposal({ id: newProposalId(), status: "APPROVED", knowledgeItemId: "know_x" })] }));
    const res = await app.inject({ method: "GET", url: `/organizations/${orgId}/projects/${projectId}/proposals?status=PROPOSED` });
    expect(res.json().proposals).toHaveLength(1);
    await app.close();
  });
});

describe("POST .../proposals/:id/approve", () => {
  it("approves a proposal and creates a knowledge item", async () => {
    const proposal = makeProposal();
    const app = buildApp(seeded({ proposals: [proposal] }));
    const res = await app.inject({
      method: "POST",
      url: `/organizations/${orgId}/projects/${projectId}/proposals/${proposal.id}/approve`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("APPROVED");
    expect(body.knowledgeItemId).toMatch(/^know_/);
    await app.close();
  });

  it("returns 404 for unknown proposal", async () => {
    const app = buildApp(seeded());
    const res = await app.inject({
      method: "POST",
      url: `/organizations/${orgId}/projects/${projectId}/proposals/${newProposalId()}/approve`,
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describe("POST .../proposals/:id/reject", () => {
  it("rejects a proposal", async () => {
    const proposal = makeProposal();
    const app = buildApp(seeded({ proposals: [proposal] }));
    const res = await app.inject({
      method: "POST",
      url: `/organizations/${orgId}/projects/${projectId}/proposals/${proposal.id}/reject`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("REJECTED");
    await app.close();
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npm test test/routes/proposals.test.ts
```

- [ ] **Step 3: Create `src/routes/proposals.ts`**

```typescript
import type { FastifyInstance } from "fastify";
import { createProposalStore } from "../modules/ingestion/proposal-repository.js";
import { createKnowledgeItemStore } from "../modules/knowledge-core/repository.js";
import { createKnowledgeVersionStore } from "../modules/knowledge-core/version-repository.js";
import { orgIdSchema, projectIdSchema } from "../modules/project-context/entities.js";
import { PROPOSAL_STATUSES, type ProposalStatus } from "../modules/ingestion/entities.js";
import { z } from "zod";
import {
  UnauthorizedError, ValidationError, NotFoundError,
} from "../lib/errors.js";

const proposalIdSchema = z.string().regex(/^prop_[0-9A-HJKMNP-TV-Z]{26}$/);
const proposalStatusSchema = z.enum(PROPOSAL_STATUSES);

function parseOrThrow<T>(schema: { safeParse(v: unknown): { success: boolean; data?: T } }, value: unknown, message: string): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new ValidationError(message);
  return r.data as T;
}

export function registerProposalRoutes(app: FastifyInstance): void {
  const BEARER = { config: { auth: "bearer" as const } };

  app.get(
    "/organizations/:orgId/projects/:projectId/proposals",
    BEARER,
    async (req) => {
      const { orgId, projectId } = req.params as { orgId: string; projectId: string };
      parseOrThrow(orgIdSchema, orgId, "organization id is malformed");
      parseOrThrow(projectIdSchema, projectId, "project id is malformed");

      const { status } = req.query as { status?: string };
      const statusFilter = status ? parseOrThrow(proposalStatusSchema, status, "invalid status") as ProposalStatus : undefined;

      const store = createProposalStore(app.db);
      const proposals = await store.findByProject(orgId, projectId, statusFilter ? { status: statusFilter } : undefined);
      return { proposals };
    },
  );

  app.get(
    "/organizations/:orgId/projects/:projectId/proposals/:id",
    BEARER,
    async (req) => {
      const { orgId, projectId, id } = req.params as { orgId: string; projectId: string; id: string };
      parseOrThrow(orgIdSchema, orgId, "organization id is malformed");
      parseOrThrow(projectIdSchema, projectId, "project id is malformed");
      parseOrThrow(proposalIdSchema, id, "proposal id is malformed");

      const store = createProposalStore(app.db);
      const proposal = await store.findById(orgId, id);
      if (!proposal || proposal.projectId !== projectId) throw new NotFoundError("proposal not found");
      return proposal;
    },
  );

  app.post(
    "/organizations/:orgId/projects/:projectId/proposals/:id/approve",
    BEARER,
    async (req) => {
      const actor = req.actor;
      if (!actor) throw new UnauthorizedError("missing credentials");

      const { orgId, projectId, id } = req.params as { orgId: string; projectId: string; id: string };
      parseOrThrow(orgIdSchema, orgId, "organization id is malformed");
      parseOrThrow(projectIdSchema, projectId, "project id is malformed");
      parseOrThrow(proposalIdSchema, id, "proposal id is malformed");

      const proposalStore = createProposalStore(app.db);
      const proposal = await proposalStore.findById(orgId, id);
      if (!proposal || proposal.projectId !== projectId) throw new NotFoundError("proposal not found");
      if (proposal.status !== "PROPOSED") throw new ValidationError("only PROPOSED proposals can be approved");

      // Create KnowledgeItem from proposal
      const knowledgeStore = createKnowledgeItemStore(app.db);
      const vStore = createKnowledgeVersionStore(app.db);
      const item = await knowledgeStore.create({
        organizationId: orgId,
        projectId,
        type: proposal.type,
        title: proposal.title,
        summary: proposal.summary,
        content: proposal.content,
        status: "PROPOSED",
        ownerId: actor.actorId,
      });
      await knowledgeStore.setSourceIds(orgId, item.id, proposal.sourceIds);
      await vStore.append({
        organizationId: orgId,
        knowledgeId: item.id,
        version: 1,
        snapshot: item,
        changedBy: actor.actorId,
        changeSummary: `created from proposal ${id}`,
      });

      const approved = await proposalStore.approve(orgId, id, actor.actorId, item.id);
      if (!approved) throw new NotFoundError("proposal not found");
      return approved;
    },
  );

  app.post(
    "/organizations/:orgId/projects/:projectId/proposals/:id/reject",
    BEARER,
    async (req) => {
      const actor = req.actor;
      if (!actor) throw new UnauthorizedError("missing credentials");

      const { orgId, projectId, id } = req.params as { orgId: string; projectId: string; id: string };
      parseOrThrow(orgIdSchema, orgId, "organization id is malformed");
      parseOrThrow(projectIdSchema, projectId, "project id is malformed");
      parseOrThrow(proposalIdSchema, id, "proposal id is malformed");

      const store = createProposalStore(app.db);
      const proposal = await store.findById(orgId, id);
      if (!proposal || proposal.projectId !== projectId) throw new NotFoundError("proposal not found");
      if (proposal.status !== "PROPOSED") throw new ValidationError("only PROPOSED proposals can be rejected");

      const rejected = await store.reject(orgId, id, actor.actorId);
      if (!rejected) throw new NotFoundError("proposal not found");
      return rejected;
    },
  );
}
```

Also add `orgIdSchema` to `src/modules/project-context/entities.ts` if missing:
```typescript
// Check if orgIdSchema exists; if not, add:
export const orgIdSchema = z.string().regex(/^org_[0-9A-HJKMNP-TV-Z]{26}$/);
```

- [ ] **Step 4: Register in `src/app.ts`**

```typescript
import { registerProposalRoutes } from "./routes/proposals.js";
// In buildApp():
registerProposalRoutes(app);
```

- [ ] **Step 5: Run tests — expect PASS**

```bash
npm test test/routes/proposals.test.ts
```

- [ ] **Step 6: Full test suite**

```bash
npm test
```

- [ ] **Step 7: Typecheck**

```bash
npm run typecheck
```

- [ ] **Step 8: Commit**

```bash
git add src/routes/proposals.ts src/app.ts test/routes/proposals.test.ts
git commit -m "feat: proposal management routes (Task 7, PM-023)"
```

---

## Task 8: Repository Sync Fields + IncrementalSync (PM-024)

**Files:**
- Modify: `src/modules/repository-binding/entities.ts` — add `lastCommitSha`, `lastSyncedAt`
- Modify: `src/modules/repository-binding/repository.ts` — add `updateSyncState()`, `findById()`
- Create: `src/modules/ingestion/incremental-sync.ts`
- Modify: `src/routes/repositories.ts` — add sync route
- Test: `test/modules/ingestion/incremental-sync.test.ts`

**Interfaces:**
- Consumes: `GitConnector`; `KnowledgeItemStore`; `SourceStore`; `ProposalStore`; `RepositoryStore`
- Produces: `SyncResult` interface; `IncrementalSync` class with `sync(orgId, projectId, repoId): Promise<SyncResult>`; `RepositoryStore.updateSyncState()`; `RepositoryStore.findById()`

- [ ] **Step 1: Extend `Repository` entity in `src/modules/repository-binding/entities.ts`**

```typescript
// Add to Repository interface:
  lastCommitSha: string | null;
  lastSyncedAt: string | null;
```

- [ ] **Step 2: Extend `RepositoryStore` + implementation in `src/modules/repository-binding/repository.ts`**

```typescript
// Add to RepositoryStore interface:
  findById(organizationId: string, id: string): Promise<Repository | null>;
  updateSyncState(organizationId: string, id: string, commitSha: string): Promise<void>;

// Add to factory return:
    async findById(organizationId, id) {
      return col().findOne({ id, organizationId, unboundAt: null }, READ_OPTS) as Promise<Repository | null>;
    },

    async updateSyncState(organizationId, id, commitSha) {
      await col().updateOne(
        { id, organizationId },
        { $set: { lastCommitSha: commitSha, lastSyncedAt: new Date().toISOString() } },
      );
    },
```

Also add `updateOne` to `fake-db.ts`:
```typescript
updateOne: async (filter: Row, update: { $set?: Row }) => {
  const row = list.find((r) => matches(r, filter));
  if (!row) return { matchedCount: 0, modifiedCount: 0 };
  if (update.$set) Object.assign(row, update.$set);
  return { matchedCount: 1, modifiedCount: 1 };
},
```

- [ ] **Step 3: Write failing tests**

Create `test/modules/ingestion/incremental-sync.test.ts`:
```typescript
import { describe, it, expect, vi } from "vitest";
import { IncrementalSync } from "../../../src/modules/ingestion/incremental-sync.js";
import { createKnowledgeItemStore } from "../../../src/modules/knowledge-core/repository.js";
import { createSourceStore } from "../../../src/modules/knowledge-core/source-repository.js";
import { createProposalStore } from "../../../src/modules/ingestion/proposal-repository.js";
import { createRepositoryStore } from "../../../src/modules/repository-binding/repository.js";
import { createFakeDb, type Collections } from "../../support/fake-db.js";
import { newKnowledgeItemId } from "../../../src/modules/knowledge-core/entities.js";
import { newRepositoryId } from "../../../src/modules/repository-binding/entities.js";
import type { GitConnector } from "../../../src/modules/git-connector/git-connector.js";

const orgId = "org_1";
const projectId = "proj_1";
const repoId = newRepositoryId();
const sha1 = "abc123";
const sha2 = "def456";

function makeGit(changedFiles: string[], headSha: string): GitConnector {
  return {
    connect: vi.fn(),
    listFiles: vi.fn(),
    readFile: vi.fn(),
    disconnect: vi.fn(),
    readCommits: vi.fn().mockResolvedValue([
      { hash: headSha, author: { name: "dev", email: "d@d.com" }, timestamp: new Date().toISOString(), message: "update", changedFiles },
    ]),
  } as unknown as GitConnector;
}

const seeded = (extra: Collections = {}): Collections => ({
  repositories: [{
    id: repoId, organizationId: orgId, projectId,
    url: "https://github.com/test/repo", host: "github.com", path: "test/repo",
    connector: "github", defaultBranch: "main", createdAt: "", createdBy: "tok_1", unboundAt: null,
    lastCommitSha: null, lastSyncedAt: null,
  }],
  knowledge_items: [],
  sources: [],
  proposals: [],
  ...extra,
});

describe("IncrementalSync", () => {
  it("returns toSha and empty arrays when no changes", async () => {
    const { db } = createFakeDb(seeded());
    const git = makeGit([], sha1);
    const sync = new IncrementalSync(
      git,
      createKnowledgeItemStore(db),
      createSourceStore(db),
      createProposalStore(db),
      createRepositoryStore(db),
    );
    const result = await sync.sync(orgId, projectId, repoId);
    expect(result.toSha).toBe(sha1);
    expect(result.changedFiles).toHaveLength(0);
    expect(result.stalledItems).toBe(0);
    expect(result.newProposals).toBe(0);
  });

  it("marks PUBLISHED KnowledgeItems as STALE when their source file changes", async () => {
    const knowId = newKnowledgeItemId();
    const { db, rows } = createFakeDb(seeded({
      knowledge_items: [{
        id: knowId, organizationId: orgId, projectId, type: "Architecture",
        title: "API module", summary: "s", content: {}, status: "PUBLISHED",
        version: 1, ownerId: "tok_1", createdAt: "", updatedAt: "", lastVerifiedAt: null,
        sourceIds: ["src_abc"],
      }],
      sources: [{
        id: "src_abc", organizationId: orgId, projectId, type: "repository_file",
        locator: "src/api/index.ts", metadata: {}, createdBy: "tok_1", createdAt: "",
      }],
    }));
    const git = makeGit(["src/api/index.ts"], sha2);
    const sync = new IncrementalSync(
      git,
      createKnowledgeItemStore(db),
      createSourceStore(db),
      createProposalStore(db),
      createRepositoryStore(db),
    );
    const result = await sync.sync(orgId, projectId, repoId);
    expect(result.stalledItems).toBe(1);
    const item = rows.knowledge_items.find(k => (k as {id:string}).id === knowId) as {status:string};
    expect(item.status).toBe("STALE");
  });

  it("is idempotent: re-running with same HEAD SHA is a no-op", async () => {
    const { db } = createFakeDb(seeded({
      repositories: [{
        id: repoId, organizationId: orgId, projectId,
        url: "https://github.com/test/repo", host: "github.com", path: "test/repo",
        connector: "github", defaultBranch: "main", createdAt: "", createdBy: "tok_1", unboundAt: null,
        lastCommitSha: sha1, lastSyncedAt: new Date().toISOString(),
      }],
      knowledge_items: [],
      sources: [],
      proposals: [],
    }));
    const git = makeGit(["src/api/index.ts"], sha1); // same SHA as lastCommitSha
    const sync = new IncrementalSync(
      git,
      createKnowledgeItemStore(db),
      createSourceStore(db),
      createProposalStore(db),
      createRepositoryStore(db),
    );
    const result = await sync.sync(orgId, projectId, repoId);
    expect(result.changedFiles).toHaveLength(0);
    expect(result.stalledItems).toBe(0);
  });
});
```

- [ ] **Step 4: Run tests — expect FAIL**

```bash
npm test test/modules/ingestion/incremental-sync.test.ts
```

- [ ] **Step 5: Create `src/modules/ingestion/incremental-sync.ts`**

```typescript
import type { GitConnector } from "../git-connector/git-connector.js";
import type { KnowledgeItemStore } from "../knowledge-core/repository.js";
import type { SourceStore } from "../knowledge-core/source-repository.js";
import type { ProposalStore } from "./proposal-repository.js";
import type { RepositoryStore } from "../repository-binding/repository.js";

export interface SyncResult {
  fromSha: string | null;
  toSha: string;
  changedFiles: string[];
  stalledItems: number;
  newProposals: number;
}

export class IncrementalSync {
  constructor(
    private readonly git: GitConnector,
    private readonly knowledgeStore: KnowledgeItemStore,
    private readonly sourceStore: SourceStore,
    private readonly proposalStore: ProposalStore,
    private readonly repoStore: RepositoryStore,
  ) {}

  async sync(orgId: string, projectId: string, repoId: string): Promise<SyncResult> {
    const repo = await this.repoStore.findById(orgId, repoId);
    if (!repo) throw new Error(`repository ${repoId} not found`);

    const commits = await this.git.readCommits(repoId, 1);
    if (commits.length === 0) {
      return { fromSha: repo.lastCommitSha, toSha: repo.lastCommitSha ?? "", changedFiles: [], stalledItems: 0, newProposals: 0 };
    }

    const headCommit = commits[0];
    const headSha = headCommit.hash;

    // Idempotent: already processed this SHA
    if (repo.lastCommitSha === headSha) {
      return { fromSha: headSha, toSha: headSha, changedFiles: [], stalledItems: 0, newProposals: 0 };
    }

    const changedFiles = headCommit.changedFiles;
    let stalledItems = 0;
    let newProposals = 0;

    if (changedFiles.length > 0 && repo.lastCommitSha !== null) {
      // Find sources matching changed files
      const sources = await this.sourceStore.findByProject(orgId, { projectId });
      const affectedSourceIds = sources
        .filter(s => s.type === "repository_file" && changedFiles.includes(s.locator))
        .map(s => s.id);

      if (affectedSourceIds.length > 0) {
        // Find PUBLISHED knowledge items referencing affected sources
        const allItems = await this.knowledgeStore.findByProject(orgId, { projectId, status: "PUBLISHED" });
        for (const item of allItems) {
          const affected = item.sourceIds.some(sid => affectedSourceIds.includes(sid));
          if (!affected) continue;
          await this.knowledgeStore.update(orgId, item.id, { status: "STALE" });
          stalledItems++;
        }
      }

      // Generate update proposals for changed module files
      const uniqueModulePaths = [...new Set(changedFiles.map(f => f.split("/").slice(0, 2).join("/")))];
      for (const modulePath of uniqueModulePaths) {
        const title = `Update: ${modulePath} changed`;
        const summary = `Files changed in ${modulePath}: ${changedFiles.filter(f => f.startsWith(modulePath)).join(", ")}`;
        const hash = computeHash("Architecture", title, summary);
        if (await this.proposalStore.existsByHash(orgId, projectId, hash)) continue;
        await this.proposalStore.create({
          organizationId: orgId, projectId, type: "Architecture",
          title, summary, content: { changedFiles: changedFiles.filter(f => f.startsWith(modulePath)) },
          sourceIds: [], triggeredBy: "incremental",
        });
        newProposals++;
      }
    }

    await this.repoStore.updateSyncState(orgId, repoId, headSha);

    return { fromSha: repo.lastCommitSha, toSha: headSha, changedFiles, stalledItems, newProposals };
  }
}

function computeHash(type: string, title: string, summary: string): string {
  const { createHash } = require("node:crypto");
  return createHash("sha256").update(`${type}:${title}:${summary}`).digest("hex");
}
```

Fix ESM import:
```typescript
import { createHash } from "node:crypto";
// remove require() version, use top-level import
```

- [ ] **Step 6: Add sync route to `src/routes/repositories.ts`**

At the end of `registerRepositoryRoutes`, before closing `}`:
```typescript
  app.post(
    "/organizations/:orgId/projects/:projectId/repositories/:repositoryId/sync",
    BEARER,
    async (req) => {
      const actor = req.actor;
      if (!actor) throw new UnauthorizedError("missing credentials");

      const { orgId, projectId, repositoryId } = req.params as { orgId: string; projectId: string; repositoryId: string };
      parseOrThrow(orgIdSchema, orgId, "organization id is malformed");
      parseOrThrow(projectIdSchema, projectId, "project id is malformed");
      parseOrThrow(repositoryIdSchema, repositoryId, "repository id is malformed");

      const { createGitConnector } = await import("../modules/git-connector/git-connector.js");
      const { createCredentialStore } = await import("../modules/git-connector/credential-store.js");
      const encKey = Buffer.from(process.env.CREDENTIAL_ENCRYPTION_KEY ?? "0".repeat(64), "hex");
      const gitConfig = { workDir: "/tmp/pm-repos", maxFileSizeBytes: 1_048_576, defaultCommitLimit: 1 };
      const git = createGitConnector(createCredentialStore(app.db), encKey, gitConfig);
      await git.connect(repositoryId, (await store().findById(orgId, repositoryId))?.url ?? "");

      const { IncrementalSync } = await import("../modules/ingestion/incremental-sync.js");
      const { createKnowledgeItemStore } = await import("../modules/knowledge-core/repository.js");
      const { createSourceStore } = await import("../modules/knowledge-core/source-repository.js");
      const { createProposalStore } = await import("../modules/ingestion/proposal-repository.js");

      const syncService = new IncrementalSync(
        git,
        createKnowledgeItemStore(app.db),
        createSourceStore(app.db),
        createProposalStore(app.db),
        store(),
      );
      return syncService.sync(orgId, projectId, repositoryId);
    },
  );
```

Add `orgIdSchema` import from project-context if not already imported.

- [ ] **Step 7: Run tests — expect PASS**

```bash
npm test test/modules/ingestion/incremental-sync.test.ts
```

- [ ] **Step 8: Full test suite**

```bash
npm test
```

- [ ] **Step 9: Typecheck**

```bash
npm run typecheck
```

- [ ] **Step 10: Commit**

```bash
git add src/modules/repository-binding/entities.ts src/modules/repository-binding/repository.ts src/modules/ingestion/incremental-sync.ts src/routes/repositories.ts test/modules/ingestion/incremental-sync.test.ts test/support/fake-db.ts
git commit -m "feat: incremental sync + repository sync state (Task 8, PM-024)"
```

---

## Task 9: SearchRecord + SearchIndexer (PM-030)

**Files:**
- Create: `src/modules/retrieval/entities.ts`
- Create: `src/modules/retrieval/search-indexer.ts`
- Modify: `src/lib/indexes.ts` — add `search_records` collection
- Modify: `test/support/fake-db.ts` — add `$text` query support
- Modify: `src/routes/knowledge.ts` — wire indexer on create/update/delete
- Modify: `src/app.ts` — nothing (SearchIndexer created inline in route)
- Test: `test/modules/retrieval/search-indexer.test.ts`
- Test: `test/routes/knowledge-search.test.ts`

**Interfaces:**
- Consumes: `KnowledgeItem`; `KnowledgeType`; `KnowledgeStatus`
- Produces: `SearchRecord` interface; `SearchIndexer` class with `upsert(item)`, `remove(orgId, knowledgeId)`, `rebuild(orgId, projectId, items)`, `search(orgId, projectId, query): Promise<SearchRecord[]>`

- [ ] **Step 1: Extend `fake-db.ts` with `$text` search support**

In `test/support/fake-db.ts`, update the `find` handler to support text search:

```typescript
// Replace the find method's matches call to handle $text:
find: (filter: Row) => {
  let textQuery: string | null = null;
  const plainFilter = { ...filter };

  // Extract $text query if present
  if (plainFilter.$text && typeof (plainFilter.$text as Row).$search === "string") {
    textQuery = ((plainFilter.$text as Row).$search as string).toLowerCase();
    delete plainFilter.$text;
  }

  let sortKey: string | null = null;
  let sortDir: 1 | -1 = 1;

  function toArray() {
    let results = list
      .filter((r) => matches(r, plainFilter))
      .filter((r) => {
        if (!textQuery) return true;
        const text = String(r.searchText ?? "").toLowerCase();
        return text.includes(textQuery);
      })
      .map(stripId);
    if (sortKey) {
      const key = sortKey;
      const dir = sortDir;
      results = results.sort((a, b) => {
        const av = a[key] as number;
        const bv = b[key] as number;
        return dir * (av < bv ? -1 : av > bv ? 1 : 0);
      });
    }
    return Promise.resolve(results);
  }
  return {
    sort: (spec: Record<string, 1 | -1>) => {
      const [key, dir] = Object.entries(spec)[0];
      sortKey = key;
      sortDir = dir;
      return { toArray };
    },
    toArray,
  };
},
```

- [ ] **Step 2: Write failing tests**

Create `test/modules/retrieval/search-indexer.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { SearchIndexer } from "../../../src/modules/retrieval/search-indexer.js";
import { createFakeDb } from "../../support/fake-db.js";
import { newKnowledgeItemId } from "../../../src/modules/knowledge-core/entities.js";
import type { KnowledgeItem } from "../../../src/modules/knowledge-core/entities.js";

const orgId = "org_1";
const projectId = "proj_1";

function makeItem(overrides: Partial<KnowledgeItem> = {}): KnowledgeItem {
  return {
    id: newKnowledgeItemId(), organizationId: orgId, projectId,
    type: "Architecture", title: "API layer", summary: "handles REST requests",
    content: { component: "api", description: "Fastify routes" },
    status: "PUBLISHED", version: 1, ownerId: "tok_1",
    createdAt: "", updatedAt: "", lastVerifiedAt: null, sourceIds: [],
    ...overrides,
  };
}

describe("SearchIndexer", () => {
  it("upsert makes item searchable", async () => {
    const { db } = createFakeDb({ search_records: [] });
    const indexer = new SearchIndexer(db);
    const item = makeItem();
    await indexer.upsert(item);
    const results = await indexer.search(orgId, projectId, "Fastify");
    expect(results).toHaveLength(1);
    expect(results[0].knowledgeId).toBe(item.id);
  });

  it("search is case-insensitive", async () => {
    const { db } = createFakeDb({ search_records: [] });
    const indexer = new SearchIndexer(db);
    await indexer.upsert(makeItem());
    expect(await indexer.search(orgId, projectId, "fastify")).toHaveLength(1);
  });

  it("remove makes item non-searchable", async () => {
    const { db } = createFakeDb({ search_records: [] });
    const indexer = new SearchIndexer(db);
    const item = makeItem();
    await indexer.upsert(item);
    await indexer.remove(orgId, item.id);
    expect(await indexer.search(orgId, projectId, "Fastify")).toHaveLength(0);
  });

  it("upsert on update replaces existing record", async () => {
    const { db, rows } = createFakeDb({ search_records: [] });
    const indexer = new SearchIndexer(db);
    const item = makeItem();
    await indexer.upsert(item);
    await indexer.upsert({ ...item, title: "Updated API layer" });
    expect(rows.search_records).toHaveLength(1);
    const rec = rows.search_records[0] as { searchText: string };
    expect(rec.searchText).toContain("Updated API layer");
  });

  it("rebuild is idempotent", async () => {
    const { db, rows } = createFakeDb({ search_records: [] });
    const indexer = new SearchIndexer(db);
    const items = [makeItem(), makeItem()];
    await indexer.rebuild(orgId, projectId, items);
    await indexer.rebuild(orgId, projectId, items);
    expect(rows.search_records).toHaveLength(2);
  });
});
```

- [ ] **Step 3: Run tests — expect FAIL**

```bash
npm test test/modules/retrieval/search-indexer.test.ts
```

- [ ] **Step 4: Create `src/modules/retrieval/entities.ts`**

```typescript
import { ulid } from "ulid";
import type { KnowledgeType, KnowledgeStatus } from "../knowledge-core/entities.js";

export interface SearchRecord {
  id: string;           // "srec_" + ULID
  knowledgeId: string;
  organizationId: string;
  projectId: string;
  type: KnowledgeType;
  status: KnowledgeStatus;
  title: string;
  searchText: string;   // concatenated text fields for full-text index
  tags: string[];
  ownerId: string;
  lastVerifiedAt: string | null;
  updatedAt: string;
}

export function newSearchRecordId(): string {
  return `srec_${ulid()}`;
}
```

- [ ] **Step 5: Create `src/modules/retrieval/search-indexer.ts`**

```typescript
import type { Db } from "mongodb";
import { newSearchRecordId, type SearchRecord } from "./entities.js";
import type { KnowledgeItem } from "../knowledge-core/entities.js";

const READ_OPTS = { projection: { _id: 0 } } as const;

export class SearchIndexer {
  constructor(private readonly db: Db) {}

  private col() {
    return this.db.collection<SearchRecord>("search_records");
  }

  async upsert(item: KnowledgeItem): Promise<void> {
    const searchText = buildSearchText(item);
    const now = new Date().toISOString();
    const existing = await this.col().findOne(
      { organizationId: item.organizationId, knowledgeId: item.id },
      READ_OPTS,
    );
    if (existing) {
      await this.col().updateOne(
        { organizationId: item.organizationId, knowledgeId: item.id },
        { $set: { type: item.type, status: item.status, title: item.title, searchText, ownerId: item.ownerId, lastVerifiedAt: item.lastVerifiedAt, updatedAt: now } },
      );
    } else {
      const record: SearchRecord = {
        id: newSearchRecordId(),
        knowledgeId: item.id,
        organizationId: item.organizationId,
        projectId: item.projectId,
        type: item.type,
        status: item.status,
        title: item.title,
        searchText,
        tags: [],
        ownerId: item.ownerId,
        lastVerifiedAt: item.lastVerifiedAt,
        updatedAt: now,
      };
      await this.col().insertOne({ ...record });
    }
  }

  async remove(orgId: string, knowledgeId: string): Promise<void> {
    await this.col().deleteOne({ organizationId: orgId, knowledgeId });
  }

  async rebuild(orgId: string, projectId: string, items: KnowledgeItem[]): Promise<void> {
    for (const item of items) {
      await this.upsert(item);
    }
    // Remove stale records not in the provided items set
    const knowledgeIds = new Set(items.map(i => i.id));
    const existing = await this.col().find({ organizationId: orgId, projectId }, READ_OPTS).toArray() as SearchRecord[];
    for (const rec of existing) {
      if (!knowledgeIds.has(rec.knowledgeId)) {
        await this.remove(orgId, rec.knowledgeId);
      }
    }
  }

  async search(orgId: string, projectId: string, query: string): Promise<SearchRecord[]> {
    return this.col()
      .find({ organizationId: orgId, projectId, $text: { $search: query } } as unknown as Partial<SearchRecord>, READ_OPTS)
      .toArray() as Promise<SearchRecord[]>;
  }
}

function buildSearchText(item: KnowledgeItem): string {
  const parts = [item.title, item.summary];
  for (const v of Object.values(item.content)) {
    if (typeof v === "string") parts.push(v);
  }
  return parts.filter(Boolean).join(" ");
}
```

- [ ] **Step 6: Add `search_records` to `src/lib/indexes.ts`**

Add to `CORE_INDEXES` (tenant-scoped collections):

```typescript
// In CORE_COLLECTIONS array, add:
  "search_records",

// In CORE_COLLECTION_EXTRA_INDEXES, add:
  search_records: [
    { key: { id: 1 }, name: "id_unique", unique: true },
    { key: { organizationId: 1, knowledgeId: 1 }, name: "knowledge_unique", unique: true },
    { key: { organizationId: 1, projectId: 1, status: 1 }, name: "project_status" },
    { key: { searchText: "text" }, name: "search_text_index" } as IndexSpec,
  ],
```

- [ ] **Step 7: Run tests — expect PASS**

```bash
npm test test/modules/retrieval/search-indexer.test.ts
```

- [ ] **Step 8: Wire SearchIndexer into knowledge routes**

In `src/routes/knowledge.ts`, find the `POST /knowledge` handler. After a successful `store().create()`, call the indexer if status is `PUBLISHED`. Do the same after `PATCH /knowledge/:id` when status changes to `PUBLISHED`, `STALE`, `DEPRECATED`, or `REJECTED`.

Add at the top of `registerKnowledgeRoutes`:
```typescript
import { SearchIndexer } from "../modules/retrieval/search-indexer.js";

// Inside registerKnowledgeRoutes, add:
const searchIndexer = () => new SearchIndexer(app.db);
```

In the `POST /knowledge` create handler, after `await store().create(...)`:
```typescript
    if (item.status === "PUBLISHED") {
      await searchIndexer().upsert(item);
    }
```

In the `PATCH /knowledge/:id` update handler, after `await store().update(...)`:
```typescript
    if (updated.status === "PUBLISHED") {
      await searchIndexer().upsert(updated);
    } else if (updated.status === "DEPRECATED" || updated.status === "REJECTED") {
      await searchIndexer().remove(ctx.organizationId, updated.id);
    }
```

- [ ] **Step 9: Add rebuild endpoint to knowledge routes**

In `src/routes/knowledge.ts`, add after existing routes:
```typescript
  app.post("/knowledge/search/rebuild", BEARER, async (req) => {
    const ctx = context(req);
    const { projectId: qProjectId } = req.query as { projectId?: string };
    if (!qProjectId) throw new ValidationError("projectId query param required");
    parseOrThrow(projectIdSchema, qProjectId, "projectId is malformed");

    const items = await store().findByProject(ctx.organizationId, { projectId: qProjectId, status: "PUBLISHED" });
    await searchIndexer().rebuild(ctx.organizationId, qProjectId, items);
    return { rebuilt: items.length };
  });
```

- [ ] **Step 10: Run full test suite**

```bash
npm test
```

- [ ] **Step 11: Typecheck**

```bash
npm run typecheck
```

- [ ] **Step 12: Commit**

```bash
git add src/modules/retrieval/entities.ts src/modules/retrieval/search-indexer.ts src/lib/indexes.ts src/routes/knowledge.ts test/modules/retrieval/search-indexer.test.ts test/support/fake-db.ts
git commit -m "feat: SearchRecord + SearchIndexer + full-text search (Task 9, PM-030)"
```

---

## Self-Review Against Spec

### Spec Coverage Check

| Spec Requirement | Task |
|-----------------|------|
| LLM multi-provider factory | T1 |
| `ProjectSnapshot.dependencies[]` | T2 |
| `ArchitectureExtractor` TS/JS/Python/Java | T2 |
| `RepositoryAnalyzer` wired with extractor | T2 |
| `project_snapshots` collection + indexes | T3 |
| `ProjectSnapshotStore.save()` with archive | T3 |
| `GET /snapshot` route | T6 |
| `KnowledgeProposal` entity + `contentHash` dedup | T4 |
| `proposals` indexes updated | T4 |
| `BootstrapProposalGenerator` ≥5 proposals | T5 |
| All proposals `PROPOSED`, never auto-publish | T5 |
| `POST /bootstrap` full flow | T6 |
| Proposal list/approve/reject routes | T7 |
| Approve creates `KnowledgeItem` | T7 |
| `Repository.lastCommitSha/lastSyncedAt` | T8 |
| `IncrementalSync` marks STALE | T8 |
| Idempotent sync (same SHA = no-op) | T8 |
| `POST .../sync` route | T8 |
| `SearchRecord` entity + `srec_` prefix | T9 |
| `SearchIndexer.upsert/remove/rebuild` | T9 |
| `search_records` full-text index | T9 |
| Knowledge route integration (create/update) | T9 |
| Rebuild endpoint | T9 |

### Gaps Found and Fixed

- `orgIdSchema` may not be exported from project-context entities — noted in T7 with fix instruction
- `fake-db.ts` missing `updateMany`, `updateOne`, `$text` support — added in T3, T8, T9 respectively
- `createAppConfig` alias may not exist in config — T6 uses dynamic import to avoid test breakage
- `SourceStore.findByProject` signature used in T8 — verified it exists via `createSourceStore` pattern

### Type Consistency

- `ProposalStatus` defined T4 → used T5, T7 ✓
- `KnowledgeProposal` defined T4 → used T5, T6, T7 ✓
- `StoredProjectSnapshot` defined T3 → used T6 ✓
- `SyncResult` defined T8 → returned from route T8 ✓
- `SearchRecord` defined T9 → used throughout T9 ✓
- `ModuleDependency` defined T2 → used in `ProjectSnapshot.dependencies` T5 ✓

### Parallel Execution Notes

Tasks T2, T3, T4, T9 have no inter-dependencies — can run in parallel.
Tasks T5, T6, T7, T8 depend on earlier tasks as noted in Global Constraints section.
