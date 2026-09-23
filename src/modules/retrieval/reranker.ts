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
