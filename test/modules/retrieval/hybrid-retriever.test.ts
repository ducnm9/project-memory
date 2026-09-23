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
