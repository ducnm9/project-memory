import type { Db } from 'mongodb';
import { embed } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
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
      const model = createOpenAI({ apiKey: this.config.apiKey }).embedding(this.config.model);
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
