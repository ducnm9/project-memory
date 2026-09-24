import type { Db } from 'mongodb';
import type { KnowledgeItem } from '../knowledge-core/entities.js';
import type { AppConfig } from '../../config/index.js';
import { VectorSearchService } from '../retrieval/vector-search.js';

const READ_OPTS = { projection: { _id: 0 } } as const;

export type DuplicateSignal = 'exact_title' | 'semantic' | 'source_overlap';

export interface DuplicateResult {
  /** true = hard block (exact match or score > 0.92), false = soft warning (0.85–0.92) */
  duplicate: boolean;
  existingId: string;
  reason: DuplicateSignal;
  similarityScore?: number;
}

/** SEMANTIC_HARD: cosine ≥ this → block. SEMANTIC_SOFT: ≥ this → warn. */
const SEMANTIC_HARD = 0.92;
const SEMANTIC_SOFT = 0.85;

export class DuplicateDetector {
  constructor(
    private readonly db: Db,
    private readonly embeddingConfig?: AppConfig['embedding'],
  ) {}

  async detect(
    orgId: string,
    projectId: string,
    type: string,
    title: string,
    summary: string,
    sourceIds: string[],
  ): Promise<DuplicateResult | null> {
    const col = this.db.collection<KnowledgeItem>('knowledge_items');

    // Fetch all items of same type in project once
    const existing = (await col
      .find({ organizationId: orgId, projectId, type } as unknown as Partial<KnowledgeItem>, READ_OPTS)
      .toArray()) as KnowledgeItem[];

    // 1. Exact title match (case-insensitive)
    const titleLower = title.trim().toLowerCase();
    const exactMatch = existing.find((i) => i.title.trim().toLowerCase() === titleLower);
    if (exactMatch) {
      return { duplicate: true, existingId: exactMatch.id, reason: 'exact_title' };
    }

    // 2. Source overlap > 50%
    if (sourceIds.length > 0) {
      for (const item of existing) {
        if (item.sourceIds.length === 0) continue;
        const shared = sourceIds.filter((s) => item.sourceIds.includes(s)).length;
        const overlapRatio = shared / Math.min(sourceIds.length, item.sourceIds.length);
        if (overlapRatio > 0.5) {
          return { duplicate: false, existingId: item.id, reason: 'source_overlap', similarityScore: overlapRatio };
        }
      }
    }

    // 3. Semantic similarity (skip if embedding not configured)
    const vectorService = new VectorSearchService(this.db, this.embeddingConfig ?? null);
    const semantic = await vectorService.search(orgId, `${title} ${summary}`, projectId, {
      k: 5,
      statusFilter: ['PUBLISHED', 'ACCEPTED'],
      typeFilter: [type],
    });

    for (const r of semantic) {
      if (r.score >= SEMANTIC_HARD) {
        return { duplicate: true, existingId: r.knowledgeId, reason: 'semantic', similarityScore: r.score };
      }
      if (r.score >= SEMANTIC_SOFT) {
        return { duplicate: false, existingId: r.knowledgeId, reason: 'semantic', similarityScore: r.score };
      }
    }

    return null;
  }
}
