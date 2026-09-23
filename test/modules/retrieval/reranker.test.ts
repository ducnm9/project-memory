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
