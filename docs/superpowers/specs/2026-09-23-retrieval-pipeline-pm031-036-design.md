# Design: Retrieval Pipeline (PM-031 → PM-036)

**Issues:** #21 (PM-031), #22 (PM-032), #23 (PM-033), #24 (PM-034), #25 (PM-035), #26 (PM-036)  
**Date:** 2026-09-23  
**Status:** Approved

---

## 1. Context

PM-030 (SearchIndexer) delivered full-text `$text` search over a denormalized `search_records` collection. These six issues build the rest of the retrieval stack on top of it:

- **Embedding pipeline** — vector representations on `KnowledgeItem`
- **Vector search** — cosine k-NN using those embeddings
- **Hybrid retrieval** — merge text + vector + metadata into one ranked candidate set
- **Reranking** — optional second-pass score refinement
- **Relation expansion** — BFS over the existing relations graph to surface connected items
- **Context assembly** — structured, evidence-backed payload for agents

### What already exists (do not rebuild)

| Symbol | Location |
|--------|----------|
| `SearchIndexer` / `SearchRecord` | `src/modules/retrieval/search-indexer.ts`, `entities.ts` |
| `KnowledgeItem`, `Source`, `Relation` | `src/modules/knowledge-core/` |
| `relation-repository.ts` (with `findBySubject`, `findByObject`) | `src/modules/knowledge-core/relation-repository.ts` |
| `KnowledgeGap` creation | `src/routes/knowledge.ts` (existing `POST /knowledge/gaps` logic) |
| LLM config + Vercel AI SDK | `src/lib/llm.ts`, `src/config/index.ts` |
| `@ai-sdk/openai` package | already installed |

### Infrastructure decisions

| Choice | Decision | Rationale |
|--------|----------|-----------|
| Vector store | MongoDB in-process cosine scan | Self-hosted MongoDB; zero new deps; ceiling ~10k items/project |
| Embedding provider | OpenAI `text-embedding-3-small` | Reuses `@ai-sdk/openai`; 1536 dims; no new packages |
| Job queue | None — fire-and-forget async on publish | No queue installed; flagged with `ponytail:` comment |
| Reranker | Cohere Rerank if `COHERE_API_KEY` set, else fallback | Optional; no hard dep |

---

## 2. Foundational changes

### 2.1 Config (`src/config/index.ts`)

Add an `embedding` block to `AppConfig` alongside `llm`:

```typescript
embedding: {
  provider: 'openai';
  model: string;           // default: 'text-embedding-3-small'
  apiKey: string;
  dimensions: number;      // default: 1536
} | null;                  // null → embedding features disabled
```

Env vars:
```
EMBEDDING_PROVIDER=openai          (default: openai)
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_DIMENSIONS=1536
# falls back to OPENAI_API_KEY if no separate embedding key
EMBEDDING_API_KEY=<optional>
```

### 2.2 KnowledgeItem entity (`src/modules/knowledge-core/entities.ts`)

Add three fields:

```typescript
embedding: number[] | null;          // 1536-dim vector; null until first embed
embeddingModel: string | null;       // e.g. 'text-embedding-3-small'
embeddingUpdatedAt: string | null;   // ISO timestamp of last embed
```

No migration needed for existing documents — missing fields read as `null`.

### 2.3 MongoDB index (`src/lib/indexes.ts`)

Add sparse index on `knowledge_items` for efficient filtered scans:

```typescript
{ embeddingModel: 1, projectId: 1, status: 1 }  // sparse: true
```

---

## 3. PM-031 — EmbeddingPipeline

**File:** `src/modules/retrieval/embedding-pipeline.ts`

### Responsibility

Convert a `KnowledgeItem`'s `searchText` to a 1536-dim float vector using OpenAI `text-embedding-3-small`, store it back on the item.

### Interface

```typescript
interface EmbeddingPipeline {
  embedItem(itemId: string): Promise<void>;
  embedBatch(itemIds: string[]): Promise<{ succeeded: number; failed: number }>;
  needsReEmbed(item: KnowledgeItem): boolean;  // model version changed or embedding null
}
```

### Implementation notes

- Uses Vercel AI SDK `embed()` from `@ai-sdk/openai`:
  ```typescript
  import { embed } from 'ai';
  import { openai } from '@ai-sdk/openai';
  const { embedding } = await embed({ model: openai.embedding('text-embedding-3-small'), value: text });
  ```
- Input text: `item.title + '\n' + item.summary + '\n' + JSON.stringify(item.content)` (same `searchText` field used by `SearchIndexer`)
- 3 retries with exponential backoff (100 ms, 400 ms, 1600 ms) on rate limit or transient error
- On permanent failure: log error, leave `embedding: null`, do not throw (never block publish)
- `needsReEmbed`: returns `true` if `item.embeddingModel !== config.embedding.model` or `item.embedding === null`

### Integration with knowledge route

In `src/routes/knowledge.ts`, after the existing `searchIndexer.upsert()` call on publish/update:

```typescript
// fire-and-forget — do not await, never block HTTP response
// ponytail: inline async embed; replace with a job queue (Bull/BeeQueue) when
//           publish latency or retry reliability becomes a concern
embeddingPipeline.embedItem(item.id).catch(err => logger.error({ err }, 'embed failed'));
```

### Rebuild endpoint

`POST /knowledge/embeddings/rebuild` — re-embeds all PUBLISHED items where `needsReEmbed` is true, in batches of 50. Returns `{ queued: number }`. Useful when the model changes.

### Logging

Log per-item: `{ itemId, model, durationMs, success: boolean }`. On failure log full error.

---

## 4. PM-032 — VectorSearchService

**File:** `src/modules/retrieval/vector-search.ts`

### Responsibility

Embed a query string, fetch candidate embeddings from MongoDB, compute cosine similarity, return top-K ranked results.

### Interface

```typescript
interface VectorSearchResult {
  knowledgeId: string;
  score: number;          // cosine similarity 0–1
  type: string;
  title: string;
  summary: string;
}

interface VectorSearchService {
  search(query: string, projectId: string, opts?: {
    k?: number;           // default: 20
    statusFilter?: string[];  // default: ['PUBLISHED']
    typeFilter?: string[];
  }): Promise<VectorSearchResult[]>;
}
```

### Implementation notes

- Embed query using the same `EmbeddingPipeline` embed call (reuse, don't duplicate)
- Fetch from MongoDB: `{ projectId, status: { $in: statusFilter }, embedding: { $ne: null } }` — **project scope always enforced**
- Cosine similarity: `dot(a, b) / (|a| * |b|)` — implement as a pure utility in `src/lib/math.ts` (one exported function, no dep)
- Sort descending by score, return top-K
- If `config.embedding` is null → return `[]` (graceful no-op)

```typescript
// ponytail: O(n) cosine scan per query, fine to ~10k items per project;
// upgrade to MongoDB Atlas $vectorSearch or Qdrant when per-project
// item count measurably degrades latency (profile first)
```

### Cross-project leak test

The `projectId` filter is applied in the MongoDB query (not post-filter). Test: insert items in two projects; search in project A; assert no results from project B appear.

---

## 5. PM-033 — HybridRetriever

**File:** `src/modules/retrieval/hybrid-retriever.ts`

### Responsibility

Merge lexical (`SearchIndexer`) + semantic (`VectorSearchService`) + metadata signals into a single ranked candidate list.

### Interface

```typescript
interface HybridSearchResult {
  knowledgeId: string;
  rrfScore: number;
  type: string;
  title: string;
  summary: string;
  matchedSignals: ('text' | 'vector' | 'exact')[];
}

interface SearchOptions {
  query: string;
  projectId: string;
  typeFilter?: string[];
  statusFilter?: string[];   // default: ['PUBLISHED']
  limit?: number;            // default: 20
}

interface HybridRetriever {
  search(opts: SearchOptions): Promise<HybridSearchResult[]>;
}
```

### Fusion: Reciprocal Rank Fusion (RRF)

RRF score formula: `Σ 1 / (k + rank_i)` where `k = 60` (standard default).

1. Run `SearchIndexer.search()` and `VectorSearchService.search()` **in parallel** (`Promise.all`)
2. Assign ranks within each result list
3. Sum RRF contributions per `knowledgeId`
4. **Exact identifier boost:** if query matches a title exactly (case-insensitive), add `1/1` to that item's RRF score
5. **Freshness penalty:** multiply final RRF score by `0.8` for STALE items
6. **Pre-filters:** `typeFilter` and `statusFilter` passed to both underlying services before merge

### Search API

```
GET /search?q=&projectId=&type=&status=&limit=
```

Returns: `{ results: HybridSearchResult[], query: string, total: number }`

This route is **internal** (requires auth middleware, no public exposure).

### MCP tool wiring

`knowledge.search` MCP tool calls `HybridRetriever.search()`. The tool schema already exists at `specs/mcp/tools/knowledge.search.json`.

---

## 6. PM-034 — Reranker

**File:** `src/modules/retrieval/reranker.ts`

### Responsibility

Optional second-pass scoring on top-20 candidates. Improves precision before context assembly.

### Interface

```typescript
interface RerankedResult extends HybridSearchResult {
  rerankerScore: number | null;  // null if reranker not active
}

interface Reranker {
  rerank(query: string, candidates: HybridSearchResult[]): Promise<RerankedResult[]>;
  readonly available: boolean;
}
```

### Implementation

Two strategies, selected by env at startup:

| Strategy | Condition | Behavior |
|----------|-----------|----------|
| `CohereReranker` | `COHERE_API_KEY` set | POST to `https://api.cohere.com/v2/rerank`; model `rerank-v3.5`; top-20 only |
| `PassthroughReranker` | no key | returns input unchanged with `rerankerScore: null` |

`CohereReranker` failure (network error, 4xx/5xx) → log error + fall back to input order, never throw. The `Reranker` returned by factory is always the `PassthroughReranker` shape; callers need no guard.

Logs per call: `{ strategy, candidateCount, durationMs, fallback: boolean }`.

Cohere HTTP call is a plain `fetch` — no new SDK needed.

---

## 7. PM-035 — RelationExpander

**File:** `src/modules/retrieval/relation-expander.ts`

### Responsibility

After reranking, augment the result set by traversing the `relations` graph from each direct hit up to `depth` hops, surfacing items the query didn't match directly.

### Interface

```typescript
interface ExpandedItem {
  knowledgeId: string;
  type: string;
  title: string;
  summary: string;
  expandedVia: string;          // predicate label, e.g. 'depends_on'
  hopDepth: number;             // 1 or 2
  rerankerScore: null;
  rrfScore: 0;                  // expanded items have no search score
  matchedSignals: [];
}

interface RelationExpander {
  expand(directResults: RerankedResult[], projectId: string, opts?: {
    depth?: number;           // default: 2
    maxExpanded?: number;     // default: 10
    statusFilter?: string[];  // default: ['PUBLISHED']
  }): Promise<(RerankedResult | ExpandedItem)[]>;
}
```

### Implementation notes

- Uses existing `relation-repository.ts` — calls `findBySubject(id)` and `findByObject(id)` for each hop
- BFS, not DFS — breadth-first respects hop depth naturally
- Deduplicate: skip any `knowledgeId` already in `directResults`
- Fetch full `KnowledgeItem` for each expanded ID to get type, title, summary, status
- Apply `statusFilter` and `projectId` check when fetching expanded items — project scope enforced
- Cap: stop BFS queue once `maxExpanded` items collected
- At depth=2, the queue can grow fast — the `maxExpanded` cap prevents blowup

---

## 8. PM-036 — ContextAssembler

**File:** `src/modules/retrieval/context-assembler.ts`

### Responsibility

Take reranked + expanded items and produce a structured, evidence-backed context payload for agents. Enforce token budget. Signal insufficient evidence.

### Context item type

```typescript
interface ContextItem {
  knowledgeId: string;
  type: string;
  title: string;
  status: string;
  relevantContent: Record<string, unknown>;
  sources: Array<{ type: string; url: string; title: string }>;
  relations: Array<{ predicate: string; relatedTitle: string }>;
  version: number;
  lastVerifiedAt: string | null;
  freshnessWarning: boolean;      // true when status === 'STALE'
}

interface AssembledContext {
  items: ContextItem[];
  insufficient_evidence: boolean;
  knowledgeGapId: string | null;  // set when insufficient_evidence is true
  totalTokenEstimate: number;
}

interface ContextAssembler {
  assemble(
    query: string,
    items: (RerankedResult | ExpandedItem)[],
    projectId: string,
    orgId: string,
    opts?: { tokenBudget?: number }  // default: 8000 tokens estimated
  ): Promise<AssembledContext>;
}
```

### Implementation notes

- Fetch full `KnowledgeItem` for each result (batch by IDs to avoid N+1)
- Attach `sources`: load from `sources` collection by `item.sourceIds`
- Attach `relations`: call `relation-repository.findBySubject(id)` for each item; include 1-hop only with predicate label + related item title
- `freshnessWarning`: `item.status === 'STALE'`
- Token budget: estimate `JSON.stringify(contextItem).length / 4` tokens per item; truncate lower-ranked items once budget exceeded
- Insufficient evidence: if `items.length === 0` after filtering OR all items are STALE+low-score → set `insufficient_evidence: true`, create a `KnowledgeGap` record, return `items: []`
- Knowledge gap creation: reuse existing `KnowledgeGap` insert logic from `knowledge.ts`

### Integration: replace `/knowledge/ask`

In `src/routes/knowledge.ts`, replace the current naive `.includes()` fallback:

```typescript
// Before: string match + manual KnowledgeGap creation
// After:
const candidates = await hybridRetriever.search({ query, projectId, ... });
const reranked = await reranker.rerank(query, candidates);
const expanded = await relationExpander.expand(reranked, projectId);
const context = await contextAssembler.assemble(query, expanded, projectId, orgId);
return reply.send(context);
```

---

## 9. File layout

All files land in `src/modules/retrieval/` — no new top-level modules.

```
src/modules/retrieval/
  entities.ts                   (existing — SearchRecord)
  search-indexer.ts             (existing — PM-030)
  embedding-pipeline.ts         (new — PM-031)
  vector-search.ts              (new — PM-032)
  hybrid-retriever.ts           (new — PM-033)
  reranker.ts                   (new — PM-034)
  relation-expander.ts          (new — PM-035)
  context-assembler.ts          (new — PM-036)

src/lib/
  math.ts                       (new — cosine similarity utility)

src/config/index.ts             (modified — embedding config block)
src/modules/knowledge-core/entities.ts  (modified — 3 new fields on KnowledgeItem)
src/lib/indexes.ts              (modified — sparse index on knowledge_items)
src/routes/knowledge.ts         (modified — wire pipeline, replace /ask)
```

---

## 10. Error handling summary

| Failure | Behavior |
|---------|----------|
| Embedding API down | Log, leave `embedding: null`, publish succeeds |
| VectorSearch with no embeddings | Returns `[]`, hybrid falls back to text-only |
| Reranker API down | Log, return hybrid order unchanged |
| RelationExpander DB error | Log, return direct results unchanged |
| ContextAssembler with 0 items | Return `insufficient_evidence: true` + create KnowledgeGap |
| `config.embedding` null | All embedding/vector features disabled gracefully |

---

## 11. Testing

Each module gets a colocated Vitest unit test (`*.test.ts`):

- `embedding-pipeline.test.ts` — mock `embed()`, assert retry behavior, assert fire-and-forget doesn't throw
- `vector-search.test.ts` — unit test cosine math; assert project scope filter
- `hybrid-retriever.test.ts` — unit test RRF formula; assert freshness penalty
- `reranker.test.ts` — assert passthrough when no key; assert fallback on Cohere error
- `relation-expander.test.ts` — assert BFS depth; assert dedup; assert maxExpanded cap
- `context-assembler.test.ts` — assert `insufficient_evidence` path; assert token budget truncation
- `src/lib/math.test.ts` — assert cosine similarity correctness on known vectors

Integration: the existing `POST /knowledge` → PUBLISHED flow test gets extended to assert `embedding` is eventually set on the item.
