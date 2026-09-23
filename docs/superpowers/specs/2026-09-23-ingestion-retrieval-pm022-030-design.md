# Design: Ingestion Pipeline & Search Indexer (PM-022 → PM-030)

**Issues:** #16 (PM-022), #17 (PM-023), #18 (PM-024), #19 (PM-025), #20 (PM-030)  
**Date:** 2026-09-23  
**Status:** Approved

---

## 1. Context

The codebase has a fully-working foundation (auth, tenant scoping, knowledge CRUD, source/fact/relation, audit trail, repository binding, git connector, repository analyzer). Five issues build the next two subsystems:

- **Ingestion pipeline** (`src/modules/ingestion/`) — bootstrap, proposals, incremental sync, architecture extraction
- **Search indexer** (`src/modules/retrieval/`) — searchable representation of published knowledge

### What already exists (do not rebuild)

| Symbol | Location |
|--------|----------|
| `ProjectSnapshot` interface | `src/modules/repository-analyzer/entities.ts` |
| `RepositoryAnalyzer` class | `src/modules/repository-analyzer/repository-analyzer.ts` |
| `proposals` MongoDB collection | declared in `src/lib/indexes.ts:22` |
| `KnowledgeItem`, `Source`, lifecycle | `src/modules/knowledge-core/` |
| `GitConnector` | `src/modules/git-connector/` |
| `Repository` entity | `src/modules/repository-binding/entities.ts` |

---

## 2. LLM Abstraction (`src/lib/llm.ts`)

Multi-provider, config-driven. No new dependencies unless the chosen provider is installed.

```
LLM_PROVIDER=openai|anthropic|google   (default: openai)
LLM_MODEL=gpt-4o                       (provider default if unset)
OPENAI_API_KEY / ANTHROPIC_API_KEY / GOOGLE_GENERATIVE_AI_API_KEY
```

Use **Vercel AI SDK** (`ai`, `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google`) — all packages optional, installed alongside each provider. Factory returns a model instance usable with `generateText` / `generateObject`.

`src/config/index.ts` extends `AppConfig` with:
```typescript
llm: {
  provider: 'openai' | 'anthropic' | 'google';
  model: string;
  apiKey: string;
} | null   // null when no key configured → disable LLM features
```

`RepositoryAnalyzer` already accepts `LLMAssistant | null` — the new `createLLMAssistant(config)` implements that interface and wraps the AI SDK model.

---

## 3. PM-022 — ProjectSnapshot Persistence

### New collection: `project_snapshots`

Root collection (not tenant-scoped — one snapshot per `projectId`).

```typescript
interface StoredProjectSnapshot extends ProjectSnapshot {
  id: string;        // "snap_" + ULID
  projectId: string;
  organizationId: string;
  version: number;   // incremented on each bootstrap
  archivedAt: string | null;
}
```

Indexes: `{ id: 1 }` unique; `{ projectId: 1, archivedAt: 1 }` for "current snapshot" lookup.

### `ProjectSnapshotStore`

`src/modules/repository-analyzer/snapshot-repository.ts`

```typescript
interface ProjectSnapshotStore {
  save(orgId: string, projectId: string, snapshot: ProjectSnapshot): Promise<StoredProjectSnapshot>;
  // Archives the previous active snapshot (sets archivedAt), inserts new one.
  findCurrent(orgId: string, projectId: string): Promise<StoredProjectSnapshot | null>;
  findHistory(orgId: string, projectId: string): Promise<StoredProjectSnapshot[]>;
}
```

### Route

`GET /organizations/:orgId/projects/:projectId/snapshot` → 200 `StoredProjectSnapshot` | 404

Added to `src/routes/repositories.ts` or a new `src/routes/bootstrap.ts`.

---

## 4. PM-025 — Architecture & Dependency Extraction

Extends `ProjectSnapshot` with inter-module dependency graph. Runs inside `RepositoryAnalyzer.analyze()`.

### New field on `ProjectSnapshot`

```typescript
dependencies: Array<{ from: string; to: string; type: 'import' | 'require' | 'include' }>;
```

`from` and `to` are module path prefixes that match `modules[].path` entries.

### `ArchitectureExtractor`

`src/modules/ingestion/architecture-extractor.ts`

```typescript
class ArchitectureExtractor {
  extract(files: GitFileEntry[], modules: ProjectModule[], readFile: (p: string) => Promise<string | null>): Promise<ModuleDependency[]>
}
```

Language support:
- **TypeScript/JavaScript**: parse `import ... from '...'` and `require('...')` via regex on `.ts/.tsx/.js/.jsx` files
- **Python**: parse `import X` / `from X import` on `.py` files  
- **Java/Kotlin**: parse `import X.Y.Z` on `.java/.kt` files

Resolution: raw import string → nearest matching `module.path` prefix. Cross-module edges only (intra-module filtered out).

`RepositoryAnalyzer.analyze()` calls `ArchitectureExtractor.extract()` and merges result into the snapshot. This is purely additive — no existing caller is broken.

---

## 5. PM-023 — KnowledgeProposal + BootstrapProposalGenerator

### `KnowledgeProposal` entity

`src/modules/ingestion/entities.ts`

```typescript
export const PROPOSAL_STATUSES = ['PROPOSED', 'APPROVED', 'REJECTED'] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export interface KnowledgeProposal {
  id: string;                         // "prop_" + ULID
  organizationId: string;
  projectId: string;
  status: ProposalStatus;
  type: KnowledgeType;
  title: string;
  summary: string;
  content: Record<string, unknown>;
  sourceIds: string[];
  contentHash: string;                // SHA-256(type+title+summary) for dedup
  triggeredBy: 'bootstrap' | 'incremental' | 'manual';
  createdAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  knowledgeItemId: string | null;     // set when APPROVED → KnowledgeItem created
}
```

### `ProposalStore`

`src/modules/ingestion/proposal-repository.ts`

```typescript
interface ProposalStore {
  create(input: CreateProposalInput): Promise<KnowledgeProposal>;
  findById(orgId: string, id: string): Promise<KnowledgeProposal | null>;
  findByProject(orgId: string, projectId: string, filter?: { status?: ProposalStatus }): Promise<KnowledgeProposal[]>;
  existsByHash(orgId: string, projectId: string, hash: string): Promise<boolean>;
  approve(orgId: string, id: string, actorId: string, knowledgeItemId: string): Promise<KnowledgeProposal | null>;
  reject(orgId: string, id: string, actorId: string): Promise<KnowledgeProposal | null>;
}
```

MongoDB indexes added to `proposals` entry in `indexes.ts`:
- `{ id: 1 }` unique
- `{ organizationId: 1, projectId: 1, status: 1 }`
- `{ organizationId: 1, projectId: 1, contentHash: 1 }` unique (dedup guard)

### `BootstrapProposalGenerator`

`src/modules/ingestion/bootstrap-proposal-generator.ts`

Takes `ProjectSnapshot` → produces `KnowledgeProposal[]` using `generateObject` (Zod structured output).

**Proposal types generated per bootstrap:**

| Type | Count | Description |
|------|-------|-------------|
| Architecture | 1 | Project overview (languages, frameworks, purpose inferred from modules) |
| Architecture | N modules | One per `snapshot.modules[]` — name + responsibility |
| Decision | M | Tech choices (frameworks, databases, API style) |
| Fact | 1–3 | CI/CD system, build system, test framework |
| Relation (`depends_on`) | K | From `snapshot.dependencies[]` — module-to-module edges |

LLM used only for natural language summary generation. Structure (type, sourceIds) is deterministic.

When `config.llm === null`, generates template-based summaries (no LLM call) — system still works, quality lower.

**Dedup**: Before creating each proposal, `existsByHash()` check. Existing hash → skip.

### Bootstrap route

`POST /organizations/:orgId/projects/:projectId/bootstrap`

Flow:
1. Resolve project + active repository binding
2. `GitConnector.listFiles()` + `readFile`
3. `RepositoryAnalyzer.analyze()` → `ProjectSnapshot`
4. `ProjectSnapshotStore.save()` (archives previous)
5. `BootstrapProposalGenerator.generate()` → `KnowledgeProposal[]`
6. `ProposalStore.create()` for each (skipping existing hashes)
7. Return `{ snapshot, proposals: KnowledgeProposal[], created: number, skipped: number }`

### Proposal management routes

`src/routes/proposals.ts`

```
GET  /organizations/:orgId/projects/:projectId/proposals          → list (filter by status)
GET  /organizations/:orgId/projects/:projectId/proposals/:id      → single
POST /organizations/:orgId/projects/:projectId/proposals/:id/approve → APPROVED + create KnowledgeItem
POST /organizations/:orgId/projects/:projectId/proposals/:id/reject  → REJECTED
```

`approve` creates a `KnowledgeItem` in `PROPOSED` status from the proposal content, links `knowledgeItemId` back on the proposal.

---

## 6. PM-024 — Incremental Sync

### Repository entity extension

Add two fields to `Repository`:

```typescript
lastCommitSha: string | null;   // last successfully synced commit SHA
lastSyncedAt: string | null;
```

Migration: existing documents get `null` for both fields (MongoDB adds on upsert).

### `IncrementalSync`

`src/modules/ingestion/incremental-sync.ts`

```typescript
class IncrementalSync {
  constructor(
    private readonly git: GitConnector,
    private readonly knowledgeStore: KnowledgeItemStore,
    private readonly sourceStore: SourceStore,
    private readonly proposalStore: ProposalStore,
    private readonly repoStore: RepositoryStore,
  ) {}

  async sync(orgId: string, projectId: string, repoId: string): Promise<SyncResult>
}

interface SyncResult {
  fromSha: string | null;
  toSha: string;
  changedFiles: string[];
  stalledItems: number;    // KnowledgeItems marked STALE
  newProposals: number;    // update proposals created
}
```

**Algorithm:**
1. Load `Repository` → `lastCommitSha`
2. `GitConnector.readCommits({ since: lastCommitSha })` → get HEAD SHA + changed files
3. If `fromSha === null` → skip stale marking (first sync, bootstrap handles it)
4. `changed files` → query Sources with matching `locator` (file path) → get `sourceIds`
5. For each source: load KnowledgeItems referencing that `sourceId` → mark STALE (status transition `PUBLISHED → STALE`)
6. For meaningfully-changed modules (path prefix match): generate update proposals via lightweight template (no LLM for incremental — keep it fast)
7. Update `Repository.lastCommitSha = HEAD SHA`, `lastSyncedAt = now`

**Idempotency**: If `sync()` is called again with same HEAD SHA → no changed files → no-op.

### Route

`POST /organizations/:orgId/projects/:projectId/repositories/:repoId/sync` → `SyncResult`

---

## 7. PM-030 — SearchIndexer

### `SearchRecord` entity

`src/modules/retrieval/entities.ts`

```typescript
export interface SearchRecord {
  id: string;             // "srec_" + ULID
  knowledgeId: string;
  organizationId: string;
  projectId: string;
  type: KnowledgeType;
  status: KnowledgeStatus;
  title: string;
  searchText: string;     // title + " " + summary + " " + key content fields (flattened)
  tags: string[];
  ownerId: string;
  lastVerifiedAt: string | null;
  updatedAt: string;
}
```

### MongoDB collection: `search_records`

Added to `CORE_INDEXES` in `indexes.ts`:
- `{ id: 1 }` unique
- `{ organizationId: 1, knowledgeId: 1 }` unique (one record per knowledge item)
- `{ organizationId: 1, projectId: 1, status: 1 }`
- `{ searchText: "text" }` — MongoDB full-text index (weighted)

### `SearchIndexer`

`src/modules/retrieval/search-indexer.ts`

```typescript
class SearchIndexer {
  upsert(item: KnowledgeItem): Promise<void>
  remove(orgId: string, knowledgeId: string): Promise<void>
  rebuild(orgId: string, projectId: string, items: KnowledgeItem[]): Promise<void>
}
```

`searchText` is built by flattening the typed content fields from `contracts.ts`:
- All string fields from `item.content` joined with spaces
- `item.title + " " + item.summary` prepended

**Integration with knowledge routes** (`src/routes/knowledge.ts`):
- After `POST /knowledge` (create): `searchIndexer.upsert(item)` when status is `PUBLISHED`
- After `PATCH /knowledge/:id` (update): `searchIndexer.upsert(item)` if `PUBLISHED`, `remove()` if `DEPRECATED`/`REJECTED`
- Status transitions `→ PUBLISHED`: `upsert()`; `→ DEPRECATED`: `remove()`

The `SearchIndexer` instance is created once in `app.ts` and passed to the knowledge routes plugin (same pattern as `KnowledgeItemStore`).

### Rebuild endpoint

`POST /organizations/:orgId/projects/:projectId/knowledge/search/rebuild`

Loads all PUBLISHED items for the project, calls `searchIndexer.rebuild()`. Idempotent.

### Search improvement

`GET /organizations/:orgId/projects/:projectId/knowledge?q=...` already exists using a naive text match. After PM-030, the query handler uses MongoDB `$text` on `search_records` instead, returning `SearchRecord[]` → resolve full `KnowledgeItem[]`.

---

## 8. File Map

```
src/
├── lib/
│   ├── llm.ts                                      NEW — AI SDK factory
│   └── indexes.ts                                  EDIT — add proposals indexes, project_snapshots, search_records
├── config/index.ts                                 EDIT — add llm config block
├── modules/
│   ├── repository-analyzer/
│   │   ├── entities.ts                             EDIT — add dependencies[] to ProjectSnapshot
│   │   ├── repository-analyzer.ts                  EDIT — call ArchitectureExtractor, wire LLM from config
│   │   └── snapshot-repository.ts                  NEW — ProjectSnapshotStore
│   ├── repository-binding/
│   │   └── entities.ts                             EDIT — add lastCommitSha, lastSyncedAt to Repository
│   ├── ingestion/
│   │   ├── entities.ts                             NEW — KnowledgeProposal, ProposalStatus
│   │   ├── proposal-repository.ts                  NEW — ProposalStore
│   │   ├── architecture-extractor.ts               NEW — ArchitectureExtractor
│   │   ├── bootstrap-proposal-generator.ts         NEW — BootstrapProposalGenerator
│   │   └── incremental-sync.ts                     NEW — IncrementalSync
│   └── retrieval/
│       ├── entities.ts                             NEW — SearchRecord
│       └── search-indexer.ts                       NEW — SearchIndexer
└── routes/
    ├── bootstrap.ts                                NEW — POST bootstrap, GET snapshot
    ├── proposals.ts                                NEW — proposal CRUD + approve/reject
    ├── knowledge.ts                                EDIT — wire SearchIndexer on create/update
    └── repositories.ts                             EDIT — add sync route

test/
├── modules/
│   ├── ingestion/
│   │   ├── architecture-extractor.test.ts          NEW
│   │   ├── bootstrap-proposal-generator.test.ts    NEW
│   │   └── incremental-sync.test.ts                NEW
│   └── retrieval/
│       └── search-indexer.test.ts                  NEW
└── routes/
    ├── bootstrap.test.ts                           NEW
    └── proposals.test.ts                           NEW
```

---

## 9. Dependency Order

```
[1] src/lib/llm.ts + config change          — independent
[2] PM-022: snapshot-repository.ts          — needs indexes.ts update
[3] PM-025: architecture-extractor.ts       — needs entities.ts extension
[4] PM-023: ingestion/entities + proposal-repository + bootstrap-proposal-generator
            ← depends on [1] [2] [3]
[5] PM-024: incremental-sync               ← depends on [4]
[6] PM-030: retrieval/entities + search-indexer + search_records index
            — independent of [2-5], can run in parallel

Lanes that can be parallelised:
  Lane A: [1] → [2] → [3] → [4] → [5]
  Lane B: [6]
```

---

## 10. Acceptance Criteria Summary

| Issue | Key Criteria |
|-------|-------------|
| PM-022 | `POST /bootstrap` stores snapshot; re-run archives previous; `GET /snapshot` returns current |
| PM-023 | Bootstrap on empty-knowledge project → ≥5 proposals; all `PROPOSED`; dedup prevents re-running from duplicating |
| PM-024 | Sync after a commit marks affected KnowledgeItems STALE; re-running same SHA is a no-op |
| PM-025 | Dependency graph has no phantom nodes; `Architecture` proposals generated per module |
| PM-030 | Publishing a KnowledgeItem makes it searchable within 1s via `$text`; deprecating removes it |

---

## 11. Out of Scope (this spec)

- Vector embeddings / semantic search (PM-031+)
- Reranking, relation expansion, context assembly (PM-034+)
- GitHub webhook ingestion (PM-040+)
- Console UI (PM-070+)
