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
