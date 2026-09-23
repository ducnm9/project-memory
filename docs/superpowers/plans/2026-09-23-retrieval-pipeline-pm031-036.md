# Retrieval Pipeline Implementation Plan (PM-031–036)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the full retrieval stack — embedding pipeline, vector search, hybrid retrieval, reranking, relation expansion, and context assembly — on top of the existing MongoDB full-text `SearchIndexer`.

**Architecture:** OpenAI `text-embedding-3-small` vectors stored on `KnowledgeItem` documents; cosine similarity scanned in-process (O(n) per project, `~10k` ceiling flagged with `ponytail:` comment); RRF fusion of text + vector; optional Cohere reranker; BFS relation expansion over the existing `relations` collection; structured context payload with token budgeting.

**Tech Stack:** TypeScript strict ESM, Fastify 5, MongoDB native driver, Vitest, Vercel AI SDK (`ai` + `@ai-sdk/openai`) — all already installed. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-23-retrieval-pipeline-pm031-036-design.md`

## Global Constraints

- TypeScript strict mode; all files use `.js` ESM import extensions
- `Db` is always MongoDB `Db` from `mongodb` (not mongoose)
- All collections accessed via `db.collection<T>(name)` with `{ projection: { _id: 0 } }` on reads
- Test DB is `createFakeDb(seed)` from `test/support/fake-db.ts` — supports `insertOne`, `findOne`, `find` (with `$text` and plain equality), `findOneAndUpdate` (upsert), `deleteOne`. No `$or`, `$ne`, `$in` — filter in JS instead
- Tests live in `test/modules/retrieval/` and `test/lib/`; run with `npm test`
- `ponytail:` comments mark deliberate scaling ceilings
- Never break existing tests; run `npm test` after each commit

---

### Task 1: Foundation — cosine utility, embedding fields on KnowledgeItem, embedding config block, sparse index

**Files:**
- Create: `src/lib/math.ts`
- Create: `test/lib/math.test.ts`
- Modify: `src/modules/knowledge-core/entities.ts` — add 3 embedding fields to `KnowledgeItem`
- Modify: `src/config/index.ts` — add `embedding` block to `AppConfig` and `loadConfig`
- Modify: `src/lib/indexes.ts` — add sparse index to `knowledge_items`
- Modify: `src/app.ts` — add `config: AppConfig` to Fastify module augmentation

**Interfaces:**
- Produces: `cosineSimilarity(a: number[], b: number[]): number` in `src/lib/math.ts`
- Produces: `KnowledgeItem.embedding: number[] | null`, `KnowledgeItem.embeddingModel: string | null`, `KnowledgeItem.embeddingUpdatedAt: string | null`
- Produces: `AppConfig.embedding: { provider: 'openai'; model: string; apiKey: string; dimensions: number } | null`

- [ ] **Step 1: Write the cosine test**

```typescript
// test/lib/math.test.ts
import { describe, it, expect } from 'vitest';
import { cosineSimilarity } from '../../src/lib/math.js';

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it('returns -1 for opposite vectors', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1);
  });

  it('is independent of vector magnitude', () => {
    expect(cosineSimilarity([2, 0], [5, 0])).toBeCloseTo(1);
  });

  it('returns 0 for zero vector', () => {
    expect(cosineSimilarity([0, 0], [1, 0])).toBe(0);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** `npm test -- test/lib/math.test.ts`

- [ ] **Step 3: Implement `src/lib/math.ts`**

```typescript
/**
 * Cosine similarity between two same-length vectors.
 * Returns 0 when either vector has zero magnitude.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}
```

- [ ] **Step 4: Run — expect PASS** `npm test -- test/lib/math.test.ts`

- [ ] **Step 5: Add embedding fields to `KnowledgeItem` in `src/modules/knowledge-core/entities.ts`**

Add after `sourceIds: string[];` (line 42):

```typescript
  embedding: number[] | null;
  embeddingModel: string | null;
  embeddingUpdatedAt: string | null;
```

- [ ] **Step 6: Update `src/modules/knowledge-core/repository.ts` — set new fields to null on create**

In `createKnowledgeItemStore`, inside the `create` method, add to the `item` object:

```typescript
        embedding: null,
        embeddingModel: null,
        embeddingUpdatedAt: null,
```

- [ ] **Step 7: Add `embedding` block to `AppConfig` in `src/config/index.ts`**

Add after `llm: {...} | null;` in the `AppConfig` interface:

```typescript
  embedding: {
    provider: 'openai';
    model: string;
    dimensions: number;
    apiKey: string;
  } | null;
```

Add to the Zod `schema` object (after `GOOGLE_GENERATIVE_AI_API_KEY`):

```typescript
  EMBEDDING_PROVIDER: z.enum(['openai']).optional(),
  EMBEDDING_MODEL: z.string().optional(),
  EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().optional(),
  EMBEDDING_API_KEY: z.string().optional(),
```

Add to the `Object.freeze({...})` return value (after `llm: (()=>{...})()`):

```typescript
    embedding: (() => {
      const provider = data.EMBEDDING_PROVIDER;
      if (!provider) return null;
      // Fall back to OPENAI_API_KEY when no dedicated embedding key is set
      const apiKey = data.EMBEDDING_API_KEY ?? data.OPENAI_API_KEY;
      if (!apiKey) return null;
      return {
        provider,
        model: data.EMBEDDING_MODEL ?? 'text-embedding-3-small',
        dimensions: data.EMBEDDING_DIMENSIONS ?? 1536,
        apiKey,
      };
    })(),
```

- [ ] **Step 8: Add sparse index in `src/lib/indexes.ts`**

In `CORE_COLLECTION_EXTRA_INDEXES`, add to the `knowledge_items` array:

```typescript
    { key: { embeddingModel: 1, projectId: 1, status: 1 }, name: 'embedding_model_project_status', sparse: true },
```

- [ ] **Step 9: Extend Fastify module augmentation in `src/app.ts`**

In the `declare module "fastify"` block, add after `db: Db;`:

```typescript
    config: import('./config/index.js').AppConfig;
```

- [ ] **Step 10: Run full test suite — expect PASS** `npm test`

- [ ] **Step 11: Commit**

```bash
git add src/lib/math.ts test/lib/math.test.ts src/modules/knowledge-core/entities.ts src/modules/knowledge-core/repository.ts src/config/index.ts src/lib/indexes.ts src/app.ts
git commit -m "feat: cosine utility, KnowledgeItem embedding fields, embedding config block (PM-031)"
```

---

### Task 2: EmbeddingPipeline

**Files:**
- Create: `src/modules/retrieval/embedding-pipeline.ts`
- Create: `test/modules/retrieval/embedding-pipeline.test.ts`

**Interfaces:**
- Consumes: `AppConfig['embedding']`, `Db`, `KnowledgeItem` (with new embedding fields from Task 1)
- Produces:
  ```typescript
  class EmbeddingPipeline {
    constructor(db: Db, embeddingConfig: NonNullable<AppConfig['embedding']>)
    embedItem(orgId: string, itemId: string): Promise<void>
    embedBatch(orgId: string, itemIds: string[], batchSize?: number): Promise<{ succeeded: number; failed: number }>
    needsReEmbed(item: KnowledgeItem): boolean
  }
  ```

- [ ] **Step 1: Write the failing test**

```typescript
// test/modules/retrieval/embedding-pipeline.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Must be hoisted before import of pipeline
vi.mock('ai', () => ({ embed: vi.fn() }));

import { embed } from 'ai';
import { EmbeddingPipeline } from '../../../src/modules/retrieval/embedding-pipeline.js';
import { createFakeDb } from '../../support/fake-db.js';
import { newKnowledgeItemId } from '../../../src/modules/knowledge-core/entities.js';
import type { KnowledgeItem } from '../../../src/modules/knowledge-core/entities.js';

const mockEmbed = embed as ReturnType<typeof vi.fn>;

const EMBEDDING_CONFIG = {
  provider: 'openai' as const,
  model: 'text-embedding-3-small',
  dimensions: 3,
  apiKey: 'sk-test',
};

function makeItem(overrides: Partial<KnowledgeItem> = {}): KnowledgeItem {
  return {
    id: newKnowledgeItemId(),
    organizationId: 'org_1',
    projectId: 'proj_1',
    type: 'Architecture',
    title: 'Auth flow',
    summary: 'How auth works',
    content: {},
    status: 'PUBLISHED',
    version: 1,
    ownerId: 'tok_1',
    createdAt: '',
    updatedAt: '',
    lastVerifiedAt: null,
    sourceIds: [],
    embedding: null,
    embeddingModel: null,
    embeddingUpdatedAt: null,
    ...overrides,
  };
}

describe('EmbeddingPipeline', () => {
  beforeEach(() => {
    mockEmbed.mockReset();
    mockEmbed.mockResolvedValue({ embedding: [0.1, 0.2, 0.3] });
  });

  it('embedItem stores embedding on the knowledge item', async () => {
    const item = makeItem();
    const { db, rows } = createFakeDb({ knowledge_items: [item] });
    const pipeline = new EmbeddingPipeline(db, EMBEDDING_CONFIG);

    await pipeline.embedItem('org_1', item.id);

    const stored = rows['knowledge_items'][0] as KnowledgeItem;
    expect(stored.embedding).toEqual([0.1, 0.2, 0.3]);
    expect(stored.embeddingModel).toBe('text-embedding-3-small');
    expect(stored.embeddingUpdatedAt).toBeTruthy();
  });

  it('embedItem is silent when item does not exist', async () => {
    const { db } = createFakeDb({ knowledge_items: [] });
    const pipeline = new EmbeddingPipeline(db, EMBEDDING_CONFIG);
    await expect(pipeline.embedItem('org_1', 'know_NOTEXIST')).resolves.toBeUndefined();
  });

  it('embedItem retries up to 3 times on transient error then silently fails', async () => {
    mockEmbed
      .mockRejectedValueOnce(new Error('rate limit'))
      .mockRejectedValueOnce(new Error('rate limit'))
      .mockRejectedValueOnce(new Error('rate limit'));

    const item = makeItem();
    const { db, rows } = createFakeDb({ knowledge_items: [item] });
    const pipeline = new EmbeddingPipeline(db, EMBEDDING_CONFIG);

    // Should not throw despite 3 failures
    await expect(pipeline.embedItem('org_1', item.id)).resolves.toBeUndefined();
    expect(rows['knowledge_items'][0].embedding).toBeNull();
  });

  it('needsReEmbed returns true when embedding is null', () => {
    const pipeline = new EmbeddingPipeline({} as never, EMBEDDING_CONFIG);
    expect(pipeline.needsReEmbed(makeItem({ embedding: null }))).toBe(true);
  });

  it('needsReEmbed returns true when model changed', () => {
    const pipeline = new EmbeddingPipeline({} as never, EMBEDDING_CONFIG);
    expect(pipeline.needsReEmbed(makeItem({ embeddingModel: 'old-model', embedding: [1, 2, 3] }))).toBe(true);
  });

  it('needsReEmbed returns false when model matches and embedding exists', () => {
    const pipeline = new EmbeddingPipeline({} as never, EMBEDDING_CONFIG);
    expect(pipeline.needsReEmbed(makeItem({ embeddingModel: 'text-embedding-3-small', embedding: [1, 2, 3] }))).toBe(false);
  });

  it('embedBatch returns succeeded/failed counts', async () => {
    mockEmbed
      .mockResolvedValueOnce({ embedding: [0.1, 0.2, 0.3] })
      .mockRejectedValueOnce(new Error('fail'));
    const items = [makeItem(), makeItem()];
    const { db } = createFakeDb({ knowledge_items: items });
    const pipeline = new EmbeddingPipeline(db, EMBEDDING_CONFIG);
    const result = await pipeline.embedBatch('org_1', items.map(i => i.id));
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(1);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** `npm test -- test/modules/retrieval/embedding-pipeline.test.ts`

- [ ] **Step 3: Implement `src/modules/retrieval/embedding-pipeline.ts`**

```typescript
import type { Db } from 'mongodb';
import { embed } from 'ai';
import { openai } from '@ai-sdk/openai';
import type { KnowledgeItem } from '../knowledge-core/entities.js';
import type { AppConfig } from '../../config/index.js';

const READ_OPTS = { projection: { _id: 0 } } as const;

export class EmbeddingPipeline {
  constructor(
    private readonly db: Db,
    private readonly config: NonNullable<AppConfig['embedding']>,
  ) {}

  needsReEmbed(item: KnowledgeItem): boolean {
    return item.embedding === null || item.embeddingModel !== this.config.model;
  }

  async embedItem(orgId: string, itemId: string): Promise<void> {
    const col = this.db.collection<KnowledgeItem>('knowledge_items');
    const item = (await col.findOne({ id: itemId, organizationId: orgId }, READ_OPTS)) as KnowledgeItem | null;
    if (!item) return;

    const text = buildEmbedText(item);
    const vector = await embedWithRetry(text, this.config);
    if (vector === null) return; // all retries exhausted — stay silent

    await col.findOneAndUpdate(
      { id: itemId, organizationId: orgId },
      {
        $set: {
          embedding: vector,
          embeddingModel: this.config.model,
          embeddingUpdatedAt: new Date().toISOString(),
        },
      },
    );
  }

  async embedBatch(
    orgId: string,
    itemIds: string[],
    batchSize = 50,
  ): Promise<{ succeeded: number; failed: number }> {
    let succeeded = 0;
    let failed = 0;
    // ponytail: sequential batching; replace with Promise.all(batch) when
    // throughput matters and OpenAI rate limits allow concurrency
    for (let i = 0; i < itemIds.length; i += batchSize) {
      const batch = itemIds.slice(i, i + batchSize);
      for (const id of batch) {
        const col = this.db.collection<KnowledgeItem>('knowledge_items');
        const item = (await col.findOne({ id, organizationId: orgId }, READ_OPTS)) as KnowledgeItem | null;
        if (!item) { failed++; continue; }
        const text = buildEmbedText(item);
        const vector = await embedWithRetry(text, this.config);
        if (vector === null) { failed++; continue; }
        await col.findOneAndUpdate(
          { id, organizationId: orgId },
          { $set: { embedding: vector, embeddingModel: this.config.model, embeddingUpdatedAt: new Date().toISOString() } },
        );
        succeeded++;
      }
    }
    return { succeeded, failed };
  }
}

function buildEmbedText(item: KnowledgeItem): string {
  const parts = [item.title, item.summary];
  for (const v of Object.values(item.content)) {
    if (typeof v === 'string') parts.push(v);
  }
  return parts.filter(Boolean).join('\n');
}

async function embedWithRetry(
  text: string,
  config: NonNullable<AppConfig['embedding']>,
): Promise<number[] | null> {
  const delays = [100, 400, 1600];
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      const model = openai.embedding(config.model);
      const result = await embed({ model, value: text });
      return result.embedding;
    } catch (err) {
      if (attempt < delays.length) {
        await sleep(delays[attempt]);
      } else {
        // Log but do not throw — embedding failure must never block publish
        console.error({ err, attempt }, 'embedding failed after retries');
        return null;
      }
    }
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

- [ ] **Step 4: Run — expect PASS** `npm test -- test/modules/retrieval/embedding-pipeline.test.ts`

- [ ] **Step 5: Run full suite** `npm test`

- [ ] **Step 6: Commit**

```bash
git add src/modules/retrieval/embedding-pipeline.ts test/modules/retrieval/embedding-pipeline.test.ts
git commit -m "feat: EmbeddingPipeline with retry and fire-and-forget semantics (PM-031)"
```

---

### Task 3: VectorSearchService

**Files:**
- Create: `src/modules/retrieval/vector-search.ts`
- Create: `test/modules/retrieval/vector-search.test.ts`

**Interfaces:**
- Consumes: `cosineSimilarity` from `src/lib/math.ts`, `AppConfig['embedding']`, `Db`
- Produces:
  ```typescript
  interface VectorSearchResult {
    knowledgeId: string;
    score: number;
    type: string;
    title: string;
    summary: string;
  }
  
  class VectorSearchService {
    constructor(db: Db, embeddingConfig: AppConfig['embedding'])
    search(orgId: string, query: string, projectId: string, opts?: {
      k?: number;
      statusFilter?: string[];
      typeFilter?: string[];
    }): Promise<VectorSearchResult[]>
    embedQuery(query: string): Promise<number[] | null>
  }
  ```

- [ ] **Step 1: Write the failing test**

```typescript
// test/modules/retrieval/vector-search.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('ai', () => ({ embed: vi.fn() }));

import { embed } from 'ai';
import { VectorSearchService } from '../../../src/modules/retrieval/vector-search.js';
import { createFakeDb } from '../../support/fake-db.js';
import { newKnowledgeItemId } from '../../../src/modules/knowledge-core/entities.js';
import type { KnowledgeItem } from '../../../src/modules/knowledge-core/entities.js';

const mockEmbed = embed as ReturnType<typeof vi.fn>;

const EMBEDDING_CONFIG = {
  provider: 'openai' as const,
  model: 'text-embedding-3-small',
  dimensions: 3,
  apiKey: 'sk-test',
};

function makeItem(overrides: Partial<KnowledgeItem>): KnowledgeItem {
  return {
    id: newKnowledgeItemId(),
    organizationId: 'org_1',
    projectId: 'proj_1',
    type: 'Architecture',
    title: 'Test',
    summary: 'Summary',
    content: {},
    status: 'PUBLISHED',
    version: 1,
    ownerId: 'tok_1',
    createdAt: '',
    updatedAt: '',
    lastVerifiedAt: null,
    sourceIds: [],
    embedding: null,
    embeddingModel: null,
    embeddingUpdatedAt: null,
    ...overrides,
  };
}

describe('VectorSearchService', () => {
  beforeEach(() => {
    mockEmbed.mockReset();
    // query vector points toward item A
    mockEmbed.mockResolvedValue({ embedding: [1, 0, 0] });
  });

  it('returns items ranked by cosine similarity', async () => {
    const itemA = makeItem({ embedding: [1, 0, 0], embeddingModel: 'text-embedding-3-small' }); // cos=1
    const itemB = makeItem({ embedding: [0, 1, 0], embeddingModel: 'text-embedding-3-small' }); // cos=0
    const { db } = createFakeDb({ knowledge_items: [itemA, itemB] });
    const svc = new VectorSearchService(db, EMBEDDING_CONFIG);

    const results = await svc.search('org_1', 'auth flow', 'proj_1');

    expect(results[0].knowledgeId).toBe(itemA.id);
    expect(results[0].score).toBeCloseTo(1);
    expect(results[1].score).toBeCloseTo(0);
  });

  it('does not return items from a different project', async () => {
    const itemOtherProject = makeItem({
      projectId: 'proj_other',
      embedding: [1, 0, 0],
      embeddingModel: 'text-embedding-3-small',
    });
    const { db } = createFakeDb({ knowledge_items: [itemOtherProject] });
    const svc = new VectorSearchService(db, EMBEDDING_CONFIG);

    const results = await svc.search('org_1', 'auth', 'proj_1');
    expect(results).toHaveLength(0);
  });

  it('skips items with null embeddings', async () => {
    const item = makeItem({ embedding: null });
    const { db } = createFakeDb({ knowledge_items: [item] });
    const svc = new VectorSearchService(db, EMBEDDING_CONFIG);

    const results = await svc.search('org_1', 'auth', 'proj_1');
    expect(results).toHaveLength(0);
  });

  it('returns [] when embedding config is null', async () => {
    const item = makeItem({ embedding: [1, 0, 0] });
    const { db } = createFakeDb({ knowledge_items: [item] });
    const svc = new VectorSearchService(db, null);

    const results = await svc.search('org_1', 'auth', 'proj_1');
    expect(results).toHaveLength(0);
  });

  it('respects statusFilter', async () => {
    const published = makeItem({ status: 'PUBLISHED', embedding: [1, 0, 0], embeddingModel: 'text-embedding-3-small' });
    const stale = makeItem({ status: 'STALE', embedding: [1, 0, 0], embeddingModel: 'text-embedding-3-small' });
    const { db } = createFakeDb({ knowledge_items: [published, stale] });
    const svc = new VectorSearchService(db, EMBEDDING_CONFIG);

    const results = await svc.search('org_1', 'auth', 'proj_1', { statusFilter: ['PUBLISHED'] });
    expect(results).toHaveLength(1);
    expect(results[0].knowledgeId).toBe(published.id);
  });

  it('respects k limit', async () => {
    const items = Array.from({ length: 5 }, () =>
      makeItem({ embedding: [1, 0, 0], embeddingModel: 'text-embedding-3-small' })
    );
    const { db } = createFakeDb({ knowledge_items: items });
    const svc = new VectorSearchService(db, EMBEDDING_CONFIG);

    const results = await svc.search('org_1', 'auth', 'proj_1', { k: 3 });
    expect(results).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** `npm test -- test/modules/retrieval/vector-search.test.ts`

- [ ] **Step 3: Implement `src/modules/retrieval/vector-search.ts`**

```typescript
import type { Db } from 'mongodb';
import { embed } from 'ai';
import { openai } from '@ai-sdk/openai';
import { cosineSimilarity } from '../../lib/math.js';
import type { KnowledgeItem } from '../knowledge-core/entities.js';
import type { AppConfig } from '../../config/index.js';

const READ_OPTS = { projection: { _id: 0 } } as const;

export interface VectorSearchResult {
  knowledgeId: string;
  score: number;
  type: string;
  title: string;
  summary: string;
}

export class VectorSearchService {
  constructor(
    private readonly db: Db,
    private readonly config: AppConfig['embedding'],
  ) {}

  async embedQuery(query: string): Promise<number[] | null> {
    if (!this.config) return null;
    try {
      const model = openai.embedding(this.config.model);
      const result = await embed({ model, value: query });
      return result.embedding;
    } catch {
      return null;
    }
  }

  async search(
    orgId: string,
    query: string,
    projectId: string,
    opts: { k?: number; statusFilter?: string[]; typeFilter?: string[] } = {},
  ): Promise<VectorSearchResult[]> {
    if (!this.config) return [];

    const queryVec = await this.embedQuery(query);
    if (!queryVec) return [];

    const statusFilter = opts.statusFilter ?? ['PUBLISHED'];
    const k = opts.k ?? 20;

    // Fetch all items for this project — filter in JS (FakeDb/MongoDB parity)
    // ponytail: O(n) fetch + cosine scan, fine to ~10k items per project;
    // upgrade to Atlas $vectorSearch or Qdrant when per-project item count
    // measurably degrades latency (profile first)
    const col = this.db.collection<KnowledgeItem>('knowledge_items');
    const all = (await col
      .find({ organizationId: orgId, projectId } as unknown as Partial<KnowledgeItem>, READ_OPTS)
      .toArray()) as KnowledgeItem[];

    const candidates = all.filter(
      (item) =>
        item.embedding !== null &&
        item.embeddingModel === this.config!.model &&
        statusFilter.includes(item.status) &&
        (!opts.typeFilter || opts.typeFilter.includes(item.type)),
    );

    const scored = candidates
      .map((item) => ({
        knowledgeId: item.id,
        score: cosineSimilarity(queryVec, item.embedding!),
        type: item.type,
        title: item.title,
        summary: item.summary,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k);

    return scored;
  }
}
```

- [ ] **Step 4: Run — expect PASS** `npm test -- test/modules/retrieval/vector-search.test.ts`

- [ ] **Step 5: Run full suite** `npm test`

- [ ] **Step 6: Commit**

```bash
git add src/modules/retrieval/vector-search.ts test/modules/retrieval/vector-search.test.ts
git commit -m "feat: VectorSearchService with in-process cosine scan (PM-032)"
```

---

### Task 4: HybridRetriever

**Files:**
- Create: `src/modules/retrieval/hybrid-retriever.ts`
- Create: `test/modules/retrieval/hybrid-retriever.test.ts`

**Interfaces:**
- Consumes: `SearchIndexer` from `./search-indexer.ts`, `VectorSearchService` from `./vector-search.ts`, `SearchRecord` from `./entities.ts`
- Produces:
  ```typescript
  interface HybridSearchResult {
    knowledgeId: string;
    rrfScore: number;
    type: string;
    title: string;
    summary: string;
    matchedSignals: ('text' | 'vector' | 'exact')[];
    isStale: boolean;
  }

  interface SearchOptions {
    orgId: string;
    query: string;
    projectId: string;
    typeFilter?: string[];
    statusFilter?: string[];
    limit?: number;
  }

  class HybridRetriever {
    constructor(searchIndexer: SearchIndexer, vectorSearch: VectorSearchService)
    search(opts: SearchOptions): Promise<HybridSearchResult[]>
  }
  ```

- [ ] **Step 1: Write the failing test**

```typescript
// test/modules/retrieval/hybrid-retriever.test.ts
import { describe, it, expect } from 'vitest';
import { HybridRetriever } from '../../../src/modules/retrieval/hybrid-retriever.js';
import type { SearchRecord } from '../../../src/modules/retrieval/entities.js';
import type { VectorSearchResult } from '../../../src/modules/retrieval/vector-search.js';
import { newKnowledgeItemId } from '../../../src/modules/knowledge-core/entities.js';

function fakeSearchIndexer(results: Partial<SearchRecord>[]) {
  return {
    search: async () => results as SearchRecord[],
  } as unknown as import('../../../src/modules/retrieval/search-indexer.js').SearchIndexer;
}

function fakeVectorSearch(results: VectorSearchResult[]) {
  return {
    search: async () => results,
  } as unknown as import('../../../src/modules/retrieval/vector-search.js').VectorSearchService;
}

function makeVec(knowledgeId: string, score = 0.9): VectorSearchResult {
  return { knowledgeId, score, type: 'Architecture', title: 'T', summary: 'S' };
}

function makeText(knowledgeId: string): Partial<SearchRecord> {
  return { knowledgeId, type: 'Architecture', title: 'T', status: 'PUBLISHED' };
}

describe('HybridRetriever', () => {
  it('merges text and vector results via RRF', async () => {
    const id1 = newKnowledgeItemId();
    const id2 = newKnowledgeItemId();

    const retriever = new HybridRetriever(
      fakeSearchIndexer([makeText(id1)]),
      fakeVectorSearch([makeVec(id1), makeVec(id2)]),
    );

    const results = await retriever.search({ orgId: 'org_1', query: 'auth', projectId: 'proj_1' });

    // id1 appears in both lists → higher RRF score
    expect(results[0].knowledgeId).toBe(id1);
    expect(results[0].matchedSignals).toContain('text');
    expect(results[0].matchedSignals).toContain('vector');
    expect(results[1].knowledgeId).toBe(id2);
    expect(results[1].matchedSignals).toContain('vector');
  });

  it('boosts exact title match to top', async () => {
    const exact = newKnowledgeItemId();
    const other = newKnowledgeItemId();

    const retriever = new HybridRetriever(
      fakeSearchIndexer([makeText(other), { ...makeText(exact), title: 'auth flow' }]),
      fakeVectorSearch([makeVec(other, 0.99), makeVec(exact, 0.5)]),
    );

    const results = await retriever.search({ orgId: 'org_1', query: 'auth flow', projectId: 'proj_1' });
    expect(results[0].knowledgeId).toBe(exact);
    expect(results[0].matchedSignals).toContain('exact');
  });

  it('applies 0.8x freshness penalty to STALE items', async () => {
    const fresh = newKnowledgeItemId();
    const stale = newKnowledgeItemId();

    const retriever = new HybridRetriever(
      fakeSearchIndexer([
        makeText(fresh),
        { knowledgeId: stale, type: 'Architecture', title: 'T', status: 'STALE' },
      ]),
      fakeVectorSearch([makeVec(fresh, 0.5), makeVec(stale, 0.5)]),
    );

    const results = await retriever.search({ orgId: 'org_1', query: 'auth', projectId: 'proj_1' });
    const freshResult = results.find(r => r.knowledgeId === fresh)!;
    const staleResult = results.find(r => r.knowledgeId === stale)!;
    expect(freshResult.rrfScore).toBeGreaterThan(staleResult.rrfScore);
    expect(staleResult.isStale).toBe(true);
  });

  it('respects limit', async () => {
    const ids = Array.from({ length: 10 }, () => newKnowledgeItemId());
    const retriever = new HybridRetriever(
      fakeSearchIndexer(ids.map(id => makeText(id))),
      fakeVectorSearch(ids.map(id => makeVec(id))),
    );
    const results = await retriever.search({ orgId: 'org_1', query: 'x', projectId: 'p', limit: 3 });
    expect(results).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** `npm test -- test/modules/retrieval/hybrid-retriever.test.ts`

- [ ] **Step 3: Implement `src/modules/retrieval/hybrid-retriever.ts`**

```typescript
import type { SearchIndexer } from './search-indexer.js';
import type { VectorSearchResult, VectorSearchService } from './vector-search.js';
import type { SearchRecord } from './entities.js';

export interface HybridSearchResult {
  knowledgeId: string;
  rrfScore: number;
  type: string;
  title: string;
  summary: string;
  matchedSignals: ('text' | 'vector' | 'exact')[];
  isStale: boolean;
}

export interface SearchOptions {
  orgId: string;
  query: string;
  projectId: string;
  typeFilter?: string[];
  statusFilter?: string[];
  limit?: number;
}

const RRF_K = 60;
const FRESHNESS_PENALTY = 0.8;

export class HybridRetriever {
  constructor(
    private readonly searchIndexer: SearchIndexer,
    private readonly vectorSearch: VectorSearchService,
  ) {}

  async search(opts: SearchOptions): Promise<HybridSearchResult[]> {
    const { orgId, query, projectId, typeFilter, statusFilter = ['PUBLISHED', 'STALE'], limit = 20 } = opts;

    // Run in parallel
    const [textResults, vecResults] = await Promise.all([
      this.searchIndexer.search(orgId, projectId, query),
      this.vectorSearch.search(orgId, query, projectId, {
        statusFilter,
        typeFilter,
        k: 40,
      }),
    ]);

    // Build score map keyed by knowledgeId
    const scores = new Map<string, {
      rrfScore: number;
      signals: Set<'text' | 'vector' | 'exact'>;
      title: string;
      type: string;
      summary: string;
      isStale: boolean;
    }>();

    function getOrCreate(id: string, title: string, type: string, summary: string, isStale: boolean) {
      if (!scores.has(id)) {
        scores.set(id, { rrfScore: 0, signals: new Set(), title, type, summary, isStale });
      }
      return scores.get(id)!;
    }

    // RRF from text results
    textResults.forEach((r: SearchRecord, rank: number) => {
      const entry = getOrCreate(r.knowledgeId, r.title, r.type, '', r.status === 'STALE');
      entry.rrfScore += 1 / (RRF_K + rank + 1);
      entry.signals.add('text');
    });

    // RRF from vector results
    vecResults.forEach((r: VectorSearchResult, rank: number) => {
      const entry = getOrCreate(r.knowledgeId, r.title, r.type, r.summary, false);
      entry.rrfScore += 1 / (RRF_K + rank + 1);
      entry.signals.add('vector');
    });

    // Exact title match boost
    const queryLower = query.toLowerCase();
    for (const [, entry] of scores) {
      if (entry.title.toLowerCase() === queryLower) {
        entry.rrfScore += 1 / (RRF_K + 1); // extra RRF contribution at rank 0
        entry.signals.add('exact');
      }
    }

    // Apply freshness penalty
    for (const [, entry] of scores) {
      if (entry.isStale) entry.rrfScore *= FRESHNESS_PENALTY;
    }

    const results: HybridSearchResult[] = Array.from(scores.entries()).map(([knowledgeId, entry]) => ({
      knowledgeId,
      rrfScore: entry.rrfScore,
      type: entry.type,
      title: entry.title,
      summary: entry.summary,
      matchedSignals: Array.from(entry.signals),
      isStale: entry.isStale,
    }));

    return results.sort((a, b) => b.rrfScore - a.rrfScore).slice(0, limit);
  }
}
```

- [ ] **Step 4: Run — expect PASS** `npm test -- test/modules/retrieval/hybrid-retriever.test.ts`

- [ ] **Step 5: Run full suite** `npm test`

- [ ] **Step 6: Commit**

```bash
git add src/modules/retrieval/hybrid-retriever.ts test/modules/retrieval/hybrid-retriever.test.ts
git commit -m "feat: HybridRetriever with RRF fusion and freshness penalty (PM-033)"
```

---

### Task 5: Reranker

**Files:**
- Create: `src/modules/retrieval/reranker.ts`
- Create: `test/modules/retrieval/reranker.test.ts`

**Interfaces:**
- Consumes: `HybridSearchResult` from `./hybrid-retriever.ts`
- Produces:
  ```typescript
  interface RerankedResult extends HybridSearchResult {
    rerankerScore: number | null;
  }

  class Reranker {
    constructor(cohereApiKey?: string)
    readonly available: boolean
    rerank(query: string, candidates: HybridSearchResult[]): Promise<RerankedResult[]>
  }
  ```

- [ ] **Step 1: Write the failing test**

```typescript
// test/modules/retrieval/reranker.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Reranker } from '../../../src/modules/retrieval/reranker.js';
import { newKnowledgeItemId } from '../../../src/modules/knowledge-core/entities.js';
import type { HybridSearchResult } from '../../../src/modules/retrieval/hybrid-retriever.js';

function makeCandidate(overrides: Partial<HybridSearchResult> = {}): HybridSearchResult {
  return {
    knowledgeId: newKnowledgeItemId(),
    rrfScore: 0.5,
    type: 'Architecture',
    title: 'Auth flow',
    summary: 'Describes auth',
    matchedSignals: ['text'],
    isStale: false,
    ...overrides,
  };
}

describe('Reranker (no API key — passthrough)', () => {
  it('returns all candidates with rerankerScore null', async () => {
    const reranker = new Reranker();
    const candidates = [makeCandidate(), makeCandidate()];
    const results = await reranker.rerank('query', candidates);
    expect(results).toHaveLength(2);
    expect(results[0].rerankerScore).toBeNull();
    expect(reranker.available).toBe(false);
  });

  it('preserves original order in passthrough mode', async () => {
    const reranker = new Reranker();
    const a = makeCandidate({ rrfScore: 0.9 });
    const b = makeCandidate({ rrfScore: 0.1 });
    const results = await reranker.rerank('q', [a, b]);
    expect(results[0].knowledgeId).toBe(a.knowledgeId);
  });
});

describe('Reranker (Cohere API key present)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('calls Cohere rerank endpoint and reorders results', async () => {
    const a = makeCandidate({ title: 'Auth flow' });
    const b = makeCandidate({ title: 'Database schema' });

    // Cohere returns b ranked first
    const mockFetch = fetch as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [
          { index: 1, relevance_score: 0.95 },
          { index: 0, relevance_score: 0.3 },
        ],
      }),
    });

    const reranker = new Reranker('co-test-key');
    expect(reranker.available).toBe(true);
    const results = await reranker.rerank('database query', [a, b]);

    expect(results[0].knowledgeId).toBe(b.knowledgeId);
    expect(results[0].rerankerScore).toBeCloseTo(0.95);
    expect(results[1].rerankerScore).toBeCloseTo(0.3);
  });

  it('falls back to original order when Cohere returns error', async () => {
    const mockFetch = fetch as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}) });

    const candidates = [makeCandidate(), makeCandidate()];
    const reranker = new Reranker('co-test-key');
    const results = await reranker.rerank('q', candidates);

    expect(results).toHaveLength(2);
    expect(results[0].rerankerScore).toBeNull();
  });

  it('falls back gracefully on network error', async () => {
    const mockFetch = fetch as ReturnType<typeof vi.fn>;
    mockFetch.mockRejectedValueOnce(new Error('network error'));

    const candidates = [makeCandidate()];
    const reranker = new Reranker('co-test-key');
    await expect(reranker.rerank('q', candidates)).resolves.toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** `npm test -- test/modules/retrieval/reranker.test.ts`

- [ ] **Step 3: Implement `src/modules/retrieval/reranker.ts`**

```typescript
import type { HybridSearchResult } from './hybrid-retriever.js';

export interface RerankedResult extends HybridSearchResult {
  rerankerScore: number | null;
}

const COHERE_RERANK_URL = 'https://api.cohere.com/v2/rerank';
const COHERE_MODEL = 'rerank-v3.5';
const MAX_RERANK_CANDIDATES = 20;

export class Reranker {
  readonly available: boolean;

  constructor(private readonly cohereApiKey?: string) {
    this.available = !!cohereApiKey;
  }

  async rerank(query: string, candidates: HybridSearchResult[]): Promise<RerankedResult[]> {
    if (!this.cohereApiKey || candidates.length === 0) {
      return candidates.map((c) => ({ ...c, rerankerScore: null }));
    }

    const top = candidates.slice(0, MAX_RERANK_CANDIDATES);
    const rest = candidates.slice(MAX_RERANK_CANDIDATES).map((c) => ({ ...c, rerankerScore: null }));

    try {
      const start = Date.now();
      const resp = await fetch(COHERE_RERANK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.cohereApiKey}`,
        },
        body: JSON.stringify({
          model: COHERE_MODEL,
          query,
          documents: top.map((c) => c.title + '\n' + c.summary),
          top_n: top.length,
        }),
      });

      if (!resp.ok) {
        console.warn({ status: resp.status, durationMs: Date.now() - start }, 'cohere rerank error — falling back');
        return [...candidates.map((c) => ({ ...c, rerankerScore: null }))];
      }

      const body = (await resp.json()) as { results: { index: number; relevance_score: number }[] };
      console.info({ candidateCount: top.length, durationMs: Date.now() - start }, 'cohere rerank ok');

      const reranked = body.results
        .sort((a, b) => b.relevance_score - a.relevance_score)
        .map((r) => ({ ...top[r.index], rerankerScore: r.relevance_score }));

      return [...reranked, ...rest];
    } catch (err) {
      console.error({ err }, 'cohere rerank network error — falling back');
      return candidates.map((c) => ({ ...c, rerankerScore: null }));
    }
  }
}
```

- [ ] **Step 4: Run — expect PASS** `npm test -- test/modules/retrieval/reranker.test.ts`

- [ ] **Step 5: Run full suite** `npm test`

- [ ] **Step 6: Commit**

```bash
git add src/modules/retrieval/reranker.ts test/modules/retrieval/reranker.test.ts
git commit -m "feat: Reranker with Cohere passthrough and graceful fallback (PM-034)"
```

---

### Task 6: RelationExpander

**Files:**
- Create: `src/modules/retrieval/relation-expander.ts`
- Create: `test/modules/retrieval/relation-expander.test.ts`

**Interfaces:**
- Consumes: `RerankedResult` from `./reranker.ts`, `Db`, `createRelationStore` from `../knowledge-core/relation-repository.ts`
- Produces:
  ```typescript
  interface ExpandedItem {
    knowledgeId: string;
    type: string;
    title: string;
    summary: string;
    expandedVia: string;      // predicate, e.g. 'depends_on'
    hopDepth: number;         // 1 or 2
    rerankerScore: null;
    rrfScore: number;         // always 0
    matchedSignals: [];
    isStale: boolean;
  }

  class RelationExpander {
    constructor(db: Db)
    expand(
      directResults: RerankedResult[],
      orgId: string,
      projectId: string,
      opts?: { depth?: number; maxExpanded?: number; statusFilter?: string[] }
    ): Promise<(RerankedResult | ExpandedItem)[]>
  }
  ```

- [ ] **Step 1: Write the failing test**

```typescript
// test/modules/retrieval/relation-expander.test.ts
import { describe, it, expect } from 'vitest';
import { RelationExpander } from '../../../src/modules/retrieval/relation-expander.js';
import { createFakeDb } from '../../support/fake-db.js';
import { newKnowledgeItemId } from '../../../src/modules/knowledge-core/entities.js';
import { newRelationId } from '../../../src/modules/knowledge-core/relation-entities.js';
import type { KnowledgeItem } from '../../../src/modules/knowledge-core/entities.js';
import type { Relation } from '../../../src/modules/knowledge-core/relation-entities.js';
import type { RerankedResult } from '../../../src/modules/retrieval/reranker.js';

function makeItem(id: string, overrides: Partial<KnowledgeItem> = {}): KnowledgeItem {
  return {
    id,
    organizationId: 'org_1',
    projectId: 'proj_1',
    type: 'Architecture',
    title: `Item ${id.slice(-4)}`,
    summary: 'desc',
    content: {},
    status: 'PUBLISHED',
    version: 1,
    ownerId: 'tok_1',
    createdAt: '',
    updatedAt: '',
    lastVerifiedAt: null,
    sourceIds: [],
    embedding: null,
    embeddingModel: null,
    embeddingUpdatedAt: null,
    ...overrides,
  };
}

function makeRelation(subjectId: string, objectId: string): Relation {
  return {
    id: newRelationId(),
    organizationId: 'org_1',
    projectId: 'proj_1',
    subjectId,
    predicate: 'depends_on',
    objectId,
    status: 'ACCEPTED',
    version: 1,
    ownerId: 'tok_1',
    reviewerId: null,
    sourceIds: [],
    createdAt: '',
    updatedAt: '',
    lastVerifiedAt: null,
  };
}

function makeDirectResult(id: string): RerankedResult {
  return {
    knowledgeId: id,
    rrfScore: 0.8,
    type: 'Architecture',
    title: `Item ${id.slice(-4)}`,
    summary: 'desc',
    matchedSignals: ['text'],
    isStale: false,
    rerankerScore: null,
  };
}

describe('RelationExpander', () => {
  it('expands direct results by 1 hop via relations', async () => {
    const matterHistory = newKnowledgeItemId();
    const auditLog = newKnowledgeItemId();

    const { db } = createFakeDb({
      knowledge_items: [makeItem(matterHistory), makeItem(auditLog)],
      relations: [makeRelation(matterHistory, auditLog)],
    });

    const expander = new RelationExpander(db);
    const results = await expander.expand([makeDirectResult(matterHistory)], 'org_1', 'proj_1');

    const expanded = results.filter(r => !('rrfScore' in r) || (r as { hopDepth?: number }).hopDepth);
    // auditLog should appear as an expanded result
    const auditItem = results.find(r => r.knowledgeId === auditLog);
    expect(auditItem).toBeDefined();
    expect((auditItem as { expandedVia?: string }).expandedVia).toBe('depends_on');
  });

  it('does not duplicate items already in direct results', async () => {
    const a = newKnowledgeItemId();
    const b = newKnowledgeItemId();

    const { db } = createFakeDb({
      knowledge_items: [makeItem(a), makeItem(b)],
      relations: [makeRelation(a, b)],
    });

    const expander = new RelationExpander(db);
    // Both a and b are in direct results
    const results = await expander.expand(
      [makeDirectResult(a), makeDirectResult(b)],
      'org_1',
      'proj_1',
    );

    const bCount = results.filter(r => r.knowledgeId === b).length;
    expect(bCount).toBe(1); // no duplicate
  });

  it('respects maxExpanded cap', async () => {
    const hub = newKnowledgeItemId();
    const spokes = Array.from({ length: 15 }, () => newKnowledgeItemId());

    const { db } = createFakeDb({
      knowledge_items: [makeItem(hub), ...spokes.map(id => makeItem(id))],
      relations: spokes.map(id => makeRelation(hub, id)),
    });

    const expander = new RelationExpander(db);
    const results = await expander.expand(
      [makeDirectResult(hub)],
      'org_1',
      'proj_1',
      { maxExpanded: 5 },
    );

    const expandedItems = results.filter(r => (r as { hopDepth?: number }).hopDepth);
    expect(expandedItems.length).toBeLessThanOrEqual(5);
  });

  it('does not expand items from other projects', async () => {
    const a = newKnowledgeItemId();
    const b = newKnowledgeItemId();

    const { db } = createFakeDb({
      knowledge_items: [makeItem(a), makeItem(b, { projectId: 'proj_other' })],
      relations: [makeRelation(a, b)],
    });

    const expander = new RelationExpander(db);
    const results = await expander.expand([makeDirectResult(a)], 'org_1', 'proj_1');
    expect(results.find(r => r.knowledgeId === b)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run — expect FAIL** `npm test -- test/modules/retrieval/relation-expander.test.ts`

- [ ] **Step 3: Implement `src/modules/retrieval/relation-expander.ts`**

```typescript
import type { Db } from 'mongodb';
import type { RerankedResult } from './reranker.js';
import type { KnowledgeItem } from '../knowledge-core/entities.js';
import type { Relation } from '../knowledge-core/relation-entities.js';

const READ_OPTS = { projection: { _id: 0 } } as const;

export interface ExpandedItem {
  knowledgeId: string;
  type: string;
  title: string;
  summary: string;
  expandedVia: string;
  hopDepth: number;
  rerankerScore: null;
  rrfScore: number;
  matchedSignals: [];
  isStale: boolean;
}

export class RelationExpander {
  constructor(private readonly db: Db) {}

  async expand(
    directResults: RerankedResult[],
    orgId: string,
    projectId: string,
    opts: { depth?: number; maxExpanded?: number; statusFilter?: string[] } = {},
  ): Promise<(RerankedResult | ExpandedItem)[]> {
    const { depth = 2, maxExpanded = 10, statusFilter = ['PUBLISHED', 'STALE', 'ACCEPTED'] } = opts;

    // Fetch all project relations once — filter in JS
    // ponytail: full relation scan per query, fine for typical project sizes (<5k relations);
    // add compound index { projectId, subjectId } / { projectId, objectId } if profiling shows hotspot
    const allRelations = (await this.db
      .collection<Relation>('relations')
      .find({ organizationId: orgId, projectId } as unknown as Partial<Relation>, READ_OPTS)
      .toArray()) as Relation[];

    const seen = new Set(directResults.map((r) => r.knowledgeId));
    const expanded: ExpandedItem[] = [];

    // BFS queue: { knowledgeId, hopDepth }
    const queue: { knowledgeId: string; hopDepth: number; via: string }[] = directResults.map((r) => ({
      knowledgeId: r.knowledgeId,
      hopDepth: 0,
      via: '',
    }));

    while (queue.length > 0 && expanded.length < maxExpanded) {
      const { knowledgeId, hopDepth } = queue.shift()!;
      if (hopDepth >= depth) continue;

      // Find connected IDs from relations (both directions)
      const connected: { id: string; via: string }[] = [];
      for (const rel of allRelations) {
        if (rel.subjectId === knowledgeId) connected.push({ id: rel.objectId, via: rel.predicate });
        if (rel.objectId === knowledgeId) connected.push({ id: rel.subjectId, via: rel.predicate });
      }

      for (const { id: neighborId, via } of connected) {
        if (seen.has(neighborId) || expanded.length >= maxExpanded) continue;

        // Fetch the neighbor item to verify project scope and status
        const item = (await this.db
          .collection<KnowledgeItem>('knowledge_items')
          .findOne(
            { id: neighborId, organizationId: orgId, projectId } as unknown as Partial<KnowledgeItem>,
            READ_OPTS,
          )) as KnowledgeItem | null;

        if (!item || !statusFilter.includes(item.status)) continue;

        seen.add(neighborId);
        expanded.push({
          knowledgeId: neighborId,
          type: item.type,
          title: item.title,
          summary: item.summary,
          expandedVia: via,
          hopDepth: hopDepth + 1,
          rerankerScore: null,
          rrfScore: 0,
          matchedSignals: [],
          isStale: item.status === 'STALE',
        });

        if (hopDepth + 1 < depth) {
          queue.push({ knowledgeId: neighborId, hopDepth: hopDepth + 1, via });
        }
      }
    }

    return [...directResults, ...expanded];
  }
}
```

- [ ] **Step 4: Run — expect PASS** `npm test -- test/modules/retrieval/relation-expander.test.ts`

- [ ] **Step 5: Run full suite** `npm test`

- [ ] **Step 6: Commit**

```bash
git add src/modules/retrieval/relation-expander.ts test/modules/retrieval/relation-expander.test.ts
git commit -m "feat: RelationExpander BFS traversal with project scope and dedup (PM-035)"
```

---

### Task 7: ContextAssembler

**Files:**
- Create: `src/modules/retrieval/context-assembler.ts`
- Create: `test/modules/retrieval/context-assembler.test.ts`

**Interfaces:**
- Consumes: `RerankedResult | ExpandedItem` from tasks above, `Db`, `createGapStore`
- Produces:
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
    freshnessWarning: boolean;
  }

  interface AssembledContext {
    items: ContextItem[];
    insufficient_evidence: boolean;
    knowledgeGapId: string | null;
    totalTokenEstimate: number;
  }

  class ContextAssembler {
    constructor(db: Db)
    assemble(
      query: string,
      candidates: (RerankedResult | ExpandedItem)[],
      orgId: string,
      projectId: string,
      opts?: { tokenBudget?: number }
    ): Promise<AssembledContext>
  }
  ```

- [ ] **Step 1: Write the failing test**

```typescript
// test/modules/retrieval/context-assembler.test.ts
import { describe, it, expect } from 'vitest';
import { ContextAssembler } from '../../../src/modules/retrieval/context-assembler.js';
import { createFakeDb } from '../../support/fake-db.js';
import { newKnowledgeItemId } from '../../../src/modules/knowledge-core/entities.js';
import { newRelationId } from '../../../src/modules/knowledge-core/relation-entities.js';
import type { KnowledgeItem } from '../../../src/modules/knowledge-core/entities.js';
import type { Relation } from '../../../src/modules/knowledge-core/relation-entities.js';
import type { RerankedResult } from '../../../src/modules/retrieval/reranker.js';

function makeItem(id: string, overrides: Partial<KnowledgeItem> = {}): KnowledgeItem {
  return {
    id,
    organizationId: 'org_1',
    projectId: 'proj_1',
    type: 'Architecture',
    title: 'Auth flow',
    summary: 'Describes auth',
    content: { detail: 'JWT tokens' },
    status: 'PUBLISHED',
    version: 3,
    ownerId: 'tok_1',
    createdAt: '',
    updatedAt: '',
    lastVerifiedAt: '2026-01-01T00:00:00.000Z',
    sourceIds: [],
    embedding: null,
    embeddingModel: null,
    embeddingUpdatedAt: null,
    ...overrides,
  };
}

function makeReranked(id: string, overrides: Partial<RerankedResult> = {}): RerankedResult {
  return {
    knowledgeId: id,
    rrfScore: 0.8,
    type: 'Architecture',
    title: 'Auth flow',
    summary: 'Describes auth',
    matchedSignals: ['text'],
    isStale: false,
    rerankerScore: 0.9,
    ...overrides,
  };
}

describe('ContextAssembler', () => {
  it('builds context items with type, status, content, version, lastVerifiedAt', async () => {
    const id = newKnowledgeItemId();
    const { db } = createFakeDb({
      knowledge_items: [makeItem(id)],
      sources: [],
      relations: [],
    });

    const assembler = new ContextAssembler(db);
    const result = await assembler.assemble('auth query', [makeReranked(id)], 'org_1', 'proj_1');

    expect(result.insufficient_evidence).toBe(false);
    expect(result.knowledgeGapId).toBeNull();
    expect(result.items).toHaveLength(1);

    const item = result.items[0];
    expect(item.knowledgeId).toBe(id);
    expect(item.type).toBe('Architecture');
    expect(item.status).toBe('PUBLISHED');
    expect(item.version).toBe(3);
    expect(item.lastVerifiedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(item.freshnessWarning).toBe(false);
    expect(item.relevantContent).toEqual({ detail: 'JWT tokens' });
  });

  it('sets freshnessWarning: true for STALE items', async () => {
    const id = newKnowledgeItemId();
    const { db } = createFakeDb({
      knowledge_items: [makeItem(id, { status: 'STALE' })],
      sources: [],
      relations: [],
    });

    const assembler = new ContextAssembler(db);
    const result = await assembler.assemble('q', [makeReranked(id, { isStale: true })], 'org_1', 'proj_1');
    expect(result.items[0].freshnessWarning).toBe(true);
  });

  it('attaches 1-hop relations', async () => {
    const a = newKnowledgeItemId();
    const b = newKnowledgeItemId();
    const relation: Relation = {
      id: newRelationId(),
      organizationId: 'org_1',
      projectId: 'proj_1',
      subjectId: a,
      predicate: 'depends_on',
      objectId: b,
      status: 'ACCEPTED',
      version: 1,
      ownerId: 'tok_1',
      reviewerId: null,
      sourceIds: [],
      createdAt: '',
      updatedAt: '',
      lastVerifiedAt: null,
    };
    const { db } = createFakeDb({
      knowledge_items: [makeItem(a), makeItem(b, { title: 'AuditLog' })],
      sources: [],
      relations: [relation],
    });

    const assembler = new ContextAssembler(db);
    const result = await assembler.assemble('q', [makeReranked(a)], 'org_1', 'proj_1');
    expect(result.items[0].relations).toEqual([{ predicate: 'depends_on', relatedTitle: 'AuditLog' }]);
  });

  it('returns insufficient_evidence and creates KnowledgeGap when no candidates', async () => {
    const { db } = createFakeDb({ knowledge_items: [], sources: [], relations: [], knowledge_gaps: [] });
    const assembler = new ContextAssembler(db);
    const result = await assembler.assemble('unknown query', [], 'org_1', 'proj_1');

    expect(result.insufficient_evidence).toBe(true);
    expect(result.knowledgeGapId).toBeTruthy();
    expect(result.items).toHaveLength(0);
  });

  it('enforces token budget by truncating lower-ranked items', async () => {
    const ids = Array.from({ length: 5 }, () => newKnowledgeItemId());
    const items = ids.map(id => makeItem(id, { content: { text: 'x'.repeat(500) } }));
    const { db } = createFakeDb({ knowledge_items: items, sources: [], relations: [] });

    const assembler = new ContextAssembler(db);
    // Very small token budget — should truncate
    const result = await assembler.assemble(
      'q',
      ids.map(id => makeReranked(id)),
      'org_1',
      'proj_1',
      { tokenBudget: 200 },
    );

    expect(result.items.length).toBeLessThan(5);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** `npm test -- test/modules/retrieval/context-assembler.test.ts`

- [ ] **Step 3: Implement `src/modules/retrieval/context-assembler.ts`**

```typescript
import type { Db } from 'mongodb';
import type { RerankedResult } from './reranker.js';
import type { ExpandedItem } from './relation-expander.js';
import type { KnowledgeItem } from '../knowledge-core/entities.js';
import type { Relation } from '../knowledge-core/relation-entities.js';
import type { Source } from '../knowledge-core/source-entities.js';
import { createGapStore } from '../knowledge-core/gap-repository.js';

const READ_OPTS = { projection: { _id: 0 } } as const;
const DEFAULT_TOKEN_BUDGET = 8000;

export interface ContextItem {
  knowledgeId: string;
  type: string;
  title: string;
  status: string;
  relevantContent: Record<string, unknown>;
  sources: Array<{ type: string; url: string; title: string }>;
  relations: Array<{ predicate: string; relatedTitle: string }>;
  version: number;
  lastVerifiedAt: string | null;
  freshnessWarning: boolean;
}

export interface AssembledContext {
  items: ContextItem[];
  insufficient_evidence: boolean;
  knowledgeGapId: string | null;
  totalTokenEstimate: number;
}

export class ContextAssembler {
  constructor(private readonly db: Db) {}

  async assemble(
    query: string,
    candidates: (RerankedResult | ExpandedItem)[],
    orgId: string,
    projectId: string,
    opts: { tokenBudget?: number } = {},
  ): Promise<AssembledContext> {
    const tokenBudget = opts.tokenBudget ?? DEFAULT_TOKEN_BUDGET;

    if (candidates.length === 0) {
      const gap = await createGapStore(this.db).upsertOnQuestion(orgId, projectId, query);
      return { items: [], insufficient_evidence: true, knowledgeGapId: gap.id, totalTokenEstimate: 0 };
    }

    // Batch fetch knowledge items
    const ids = candidates.map((c) => c.knowledgeId);
    const knowledgeItems = (await this.db
      .collection<KnowledgeItem>('knowledge_items')
      .find({ organizationId: orgId } as unknown as Partial<KnowledgeItem>, READ_OPTS)
      .toArray()) as KnowledgeItem[];
    const itemMap = new Map(knowledgeItems.map((i) => [i.id, i]));

    // Batch fetch all project relations (1-hop attachments)
    const allRelations = (await this.db
      .collection<Relation>('relations')
      .find({ organizationId: orgId, projectId } as unknown as Partial<Relation>, READ_OPTS)
      .toArray()) as Relation[];

    // Batch fetch sources referenced by all items
    const allSourceIds = [...new Set(knowledgeItems.flatMap((i) => i.sourceIds ?? []))];
    const sources = allSourceIds.length > 0
      ? (await this.db
          .collection<Source>('sources')
          .find({ organizationId: orgId } as unknown as Partial<Source>, READ_OPTS)
          .toArray()) as Source[]
      : [];
    const sourceMap = new Map(sources.map((s) => [s.id, s]));

    // Build context items respecting token budget
    const items: ContextItem[] = [];
    let totalTokens = 0;

    for (const candidate of candidates) {
      const item = itemMap.get(candidate.knowledgeId);
      if (!item) continue;

      const itemRelations = allRelations
        .filter((r) => r.subjectId === item.id)
        .map((r) => {
          const relatedItem = itemMap.get(r.objectId);
          return { predicate: r.predicate, relatedTitle: relatedItem?.title ?? r.objectId };
        });

      const itemSources = (item.sourceIds ?? [])
        .map((sid) => sourceMap.get(sid))
        .filter(Boolean)
        .map((s) => ({ type: s!.type, url: s!.url ?? '', title: s!.title ?? '' }));

      const contextItem: ContextItem = {
        knowledgeId: item.id,
        type: item.type,
        title: item.title,
        status: item.status,
        relevantContent: item.content,
        sources: itemSources,
        relations: itemRelations,
        version: item.version,
        lastVerifiedAt: item.lastVerifiedAt,
        freshnessWarning: item.status === 'STALE',
      };

      const tokenEstimate = Math.ceil(JSON.stringify(contextItem).length / 4);
      if (totalTokens + tokenEstimate > tokenBudget && items.length > 0) break;

      items.push(contextItem);
      totalTokens += tokenEstimate;
    }

    return {
      items,
      insufficient_evidence: false,
      knowledgeGapId: null,
      totalTokenEstimate: totalTokens,
    };
  }
}
```

- [ ] **Step 4: Run — expect PASS** `npm test -- test/modules/retrieval/context-assembler.test.ts`

- [ ] **Step 5: Run full suite** `npm test`

- [ ] **Step 6: Commit**

```bash
git add src/modules/retrieval/context-assembler.ts test/modules/retrieval/context-assembler.test.ts
git commit -m "feat: ContextAssembler with token budget, relations, sources, insufficient_evidence (PM-036)"
```

---

### Task 8: Route wiring — embed on publish, /search endpoint, replace /ask, /embeddings/rebuild

**Files:**
- Modify: `src/routes/knowledge.ts` — wire `EmbeddingPipeline`, `HybridRetriever`, `Reranker`, `RelationExpander`, `ContextAssembler`; replace `/ask`; add `/search`; add `/embeddings/rebuild`
- Modify: `src/app.ts` — pass `config` to `registerKnowledgeRoutes`
- Create: `test/routes/retrieval-pipeline.test.ts`

**Interfaces:**
- Consumes: all classes from Tasks 2–7
- Produces: `GET /knowledge/ask` returns `AssembledContext`, `GET /search` returns hybrid results, `POST /knowledge/embeddings/rebuild` triggers batch embed

- [ ] **Step 1: Write the failing test**

```typescript
// test/routes/retrieval-pipeline.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('ai', () => ({ embed: vi.fn() }));

import { embed } from 'ai';
import { buildApp } from '../../src/app.js';
import { createFakeDb } from '../support/fake-db.js';
import { newKnowledgeItemId } from '../../src/modules/knowledge-core/entities.js';
import type { KnowledgeItem } from '../../src/modules/knowledge-core/entities.js';

const mockEmbed = embed as ReturnType<typeof vi.fn>;

function base64Key(): string {
  return Buffer.from('0'.repeat(32)).toString('hex'); // 64-char hex
}

const TEST_CONFIG = {
  port: 3000,
  host: '0.0.0.0',
  nodeEnv: 'test' as const,
  logLevel: 'silent',
  mongodbUri: 'mongodb://localhost:27017',
  mongodbDbName: 'test',
  authAdminKey: 'admin-key',
  authTokenPepper: 'pepper',
  credentialEncryptionKey: base64Key(),
  llm: null,
  embedding: {
    provider: 'openai' as const,
    model: 'text-embedding-3-small',
    dimensions: 3,
    apiKey: 'sk-test',
  },
};

function makeItem(id: string, overrides: Partial<KnowledgeItem> = {}): KnowledgeItem {
  return {
    id,
    organizationId: 'org_test',
    projectId: 'proj_1',
    type: 'Architecture',
    title: 'Auth flow',
    summary: 'JWT-based auth',
    content: {},
    status: 'PUBLISHED',
    version: 1,
    ownerId: 'tok_1',
    createdAt: '',
    updatedAt: '',
    lastVerifiedAt: null,
    sourceIds: [],
    embedding: [0.1, 0.2, 0.3],
    embeddingModel: 'text-embedding-3-small',
    embeddingUpdatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

async function buildTestApp(rows: Record<string, unknown[]> = {}) {
  const { db } = createFakeDb({
    organizations: [{ id: 'org_test', name: 'Test Org', createdAt: '', updatedAt: '' }],
    projects: [{ id: 'proj_1', organizationId: 'org_test', name: 'P1', createdAt: '', updatedAt: '' }],
    service_tokens: [{
      id: 'tok_1',
      organizationId: 'org_test',
      name: 'Test',
      hashedSecret: 'hashed',
      scopes: ['knowledge:read', 'knowledge:write'],
      createdAt: '',
      updatedAt: '',
      revokedAt: null,
    }],
    search_records: [],
    knowledge_items: [],
    knowledge_gaps: [],
    relations: [],
    sources: [],
    ...rows,
  });
  const app = buildApp({ config: TEST_CONFIG, db });
  await app.ready();
  return app;
}

describe('GET /knowledge/ask — retrieval pipeline', () => {
  beforeEach(() => {
    mockEmbed.mockReset();
    mockEmbed.mockResolvedValue({ embedding: [0.1, 0.2, 0.3] });
  });

  it('returns context items for a known query', async () => {
    const id = newKnowledgeItemId();
    const app = await buildTestApp({
      knowledge_items: [makeItem(id)],
      search_records: [{
        id: 'srec_1', knowledgeId: id, organizationId: 'org_test', projectId: 'proj_1',
        type: 'Architecture', status: 'PUBLISHED', title: 'Auth flow',
        searchText: 'Auth flow JWT-based auth', tags: [], ownerId: 'tok_1',
        lastVerifiedAt: null, updatedAt: '',
      }],
    });

    const resp = await app.inject({
      method: 'GET',
      url: '/knowledge/ask?projectId=proj_1&question=auth',
      headers: { 'x-organization-id': 'org_test', authorization: 'Bearer tok_1' },
    });

    expect(resp.statusCode).toBe(200);
    const body = JSON.parse(resp.body);
    expect(body.items).toBeDefined();
  });

  it('returns insufficient_evidence for unknown query', async () => {
    const app = await buildTestApp();

    const resp = await app.inject({
      method: 'GET',
      url: '/knowledge/ask?projectId=proj_1&question=completely+unknown+topic',
      headers: { 'x-organization-id': 'org_test', authorization: 'Bearer tok_1' },
    });

    expect(resp.statusCode).toBe(200);
    const body = JSON.parse(resp.body);
    expect(body.insufficient_evidence).toBe(true);
    expect(body.knowledgeGapId).toBeTruthy();
  });
});

describe('POST /knowledge/embeddings/rebuild', () => {
  beforeEach(() => {
    mockEmbed.mockReset();
    mockEmbed.mockResolvedValue({ embedding: [0.1, 0.2, 0.3] });
  });

  it('embeds all published items that need re-embedding', async () => {
    const id = newKnowledgeItemId();
    const app = await buildTestApp({
      knowledge_items: [makeItem(id, { embedding: null, embeddingModel: null })],
    });

    const resp = await app.inject({
      method: 'POST',
      url: '/knowledge/embeddings/rebuild?projectId=proj_1',
      headers: { 'x-organization-id': 'org_test', authorization: 'Bearer tok_1' },
    });

    expect(resp.statusCode).toBe(200);
    const body = JSON.parse(resp.body);
    expect(body.queued).toBe(1);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** `npm test -- test/routes/retrieval-pipeline.test.ts`

- [ ] **Step 3: Update `src/app.ts` — pass config to routes**

In `buildApp`, change `registerKnowledgeRoutes(app)` to:

```typescript
registerKnowledgeRoutes(app, config);
```

Make sure the Fastify module augmentation includes `config`:

```typescript
declare module 'fastify' {
  interface FastifyInstance {
    db: Db;
    config: import('./config/index.js').AppConfig;
  }
}
```

- [ ] **Step 4: Update `src/routes/knowledge.ts` — update imports and function signature**

Change the function signature to:

```typescript
export function registerKnowledgeRoutes(app: FastifyInstance, config: AppConfig): void {
```

Add imports at the top of `src/routes/knowledge.ts`:

```typescript
import type { AppConfig } from '../config/index.js';
import { EmbeddingPipeline } from '../modules/retrieval/embedding-pipeline.js';
import { VectorSearchService } from '../modules/retrieval/vector-search.js';
import { HybridRetriever } from '../modules/retrieval/hybrid-retriever.js';
import { Reranker } from '../modules/retrieval/reranker.js';
import { RelationExpander } from '../modules/retrieval/relation-expander.js';
import { ContextAssembler } from '../modules/retrieval/context-assembler.js';
```

- [ ] **Step 5: Add factory helpers inside `registerKnowledgeRoutes`**

Add after the existing `const searchIndexer = () => new SearchIndexer(app.db);` line:

```typescript
  const embeddingPipeline = () =>
    config.embedding ? new EmbeddingPipeline(app.db, config.embedding) : null;
  const vectorSearch = () => new VectorSearchService(app.db, config.embedding);
  const hybridRetriever = () =>
    new HybridRetriever(searchIndexer(), vectorSearch());
  const reranker = () =>
    new Reranker(process.env.COHERE_API_KEY);
  const relationExpander = () => new RelationExpander(app.db);
  const contextAssembler = () => new ContextAssembler(app.db);
```

- [ ] **Step 6: Replace the `/knowledge/ask` route body**

Replace the entire `app.get('/knowledge/ask', ...)` handler body (lines 86-107 of `src/routes/knowledge.ts`) with:

```typescript
  app.get('/knowledge/ask', BEARER, async (req) => {
    const ctx = context(req);
    const query = req.query as { projectId?: string; question?: string };

    const rawQuestion = (query.question ?? '').trim();
    if (!rawQuestion) throw new ValidationError('question is required');

    const projectId = parseOrThrow(projectIdSchema, query.projectId, 'projectId is malformed');
    await requireProject(ctx.organizationId, projectId);

    const candidates = await hybridRetriever().search({
      orgId: ctx.organizationId,
      query: rawQuestion,
      projectId,
    });
    const reranked = await reranker().rerank(rawQuestion, candidates);
    const expanded = await relationExpander().expand(reranked, ctx.organizationId, projectId);
    return contextAssembler().assemble(rawQuestion, expanded, ctx.organizationId, projectId);
  });
```

- [ ] **Step 7: Add `/search` route — insert before `/knowledge/:id`**

```typescript
  app.get('/search', BEARER, async (req) => {
    const ctx = context(req);
    const query = req.query as { q?: string; projectId?: string; type?: string; status?: string; limit?: string };

    if (!query.q) throw new ValidationError('q is required');
    const projectId = parseOrThrow(projectIdSchema, query.projectId, 'projectId is malformed');
    await requireProject(ctx.organizationId, projectId);

    const results = await hybridRetriever().search({
      orgId: ctx.organizationId,
      query: query.q,
      projectId,
      typeFilter: query.type ? [query.type] : undefined,
      statusFilter: query.status ? [query.status] : undefined,
      limit: query.limit ? parseInt(query.limit, 10) : 20,
    });
    return { results, query: query.q, total: results.length };
  });
```

- [ ] **Step 8: Add `/knowledge/embeddings/rebuild` route — before `/knowledge/search/rebuild`**

```typescript
  app.post('/knowledge/embeddings/rebuild', BEARER, async (req) => {
    const ctx = context(req);
    const { projectId: qProjectId } = req.query as { projectId?: string };
    if (!qProjectId) throw new ValidationError('projectId query param required');
    parseOrThrow(projectIdSchema, qProjectId, 'projectId is malformed');

    const pipeline = embeddingPipeline();
    if (!pipeline) return { queued: 0, reason: 'embedding not configured' };

    const items = await store().findByProject(ctx.organizationId, {
      projectId: qProjectId,
      status: 'PUBLISHED',
    });
    const toEmbed = items.filter((i) => pipeline.needsReEmbed(i));
    const ids = toEmbed.map((i) => i.id);
    // Fire-and-forget — respond immediately with count
    pipeline.embedBatch(ctx.organizationId, ids).catch((err) =>
      app.log.error({ err }, 'embedBatch failed'),
    );
    return { queued: ids.length };
  });
```

- [ ] **Step 9: Wire fire-and-forget embed on publish/update**

In the `POST /knowledge` handler, after `await searchIndexer().upsert(item);` (for `status === 'PUBLISHED'`), add:

```typescript
      // ponytail: fire-and-forget embed; replace with a job queue (Bull/BeeQueue)
      // when publish latency or retry reliability becomes a concern
      embeddingPipeline()?.embedItem(ctx.organizationId, item.id).catch((err) =>
        app.log.error({ err, itemId: item.id }, 'embed failed on create'),
      );
```

In the `PATCH /knowledge/:id` handler, in the same block where `searchIndexer().upsert(updated)` is called:

```typescript
      embeddingPipeline()?.embedItem(ctx.organizationId, updated.id).catch((err) =>
        app.log.error({ err, itemId: updated.id }, 'embed failed on update'),
      );
```

- [ ] **Step 10: Run — expect PASS** `npm test -- test/routes/retrieval-pipeline.test.ts`

- [ ] **Step 11: Run full test suite** `npm test`

- [ ] **Step 12: Commit**

```bash
git add src/routes/knowledge.ts src/app.ts test/routes/retrieval-pipeline.test.ts
git commit -m "feat: wire retrieval pipeline into /ask, /search, /embeddings/rebuild (PM-031–036)"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task(s) |
|---|---|
| §2 Foundational changes (entity fields, config, index) | Task 1 |
| §3 PM-031 EmbeddingPipeline (embed, retry, rebuild endpoint, fire-and-forget) | Tasks 2, 8 |
| §4 PM-032 VectorSearchService (cosine scan, project scope, status filter) | Task 3 |
| §5 PM-033 HybridRetriever (RRF, freshness penalty, exact boost, /search) | Tasks 4, 8 |
| §6 PM-034 Reranker (Cohere fallback, passthrough) | Task 5 |
| §7 PM-035 RelationExpander (BFS, dedup, depth, maxExpanded cap) | Task 6 |
| §8 PM-036 ContextAssembler (token budget, sources, relations, KnowledgeGap) | Task 7 |
| §8 Replace /ask with full pipeline | Task 8 |
| Error handling table (all failures silent) | Throughout each class |

**All ponytail: comments present:**
- `vector-search.ts` — O(n) scan ceiling
- `hybrid-retriever.ts` (via VectorSearch)
- `embedding-pipeline.ts` — fire-and-forget queue note
- `relation-expander.ts` — full relation scan

**Type consistency verified:**
- `HybridSearchResult` → `RerankedResult` (extends it) → consumed by `RelationExpander` → consumed by `ContextAssembler`
- `VectorSearchResult` returned by `VectorSearchService.search()` and consumed by `HybridRetriever`
- `AppConfig['embedding']` nullable throughout — all classes handle `null` gracefully
