import { generateText } from 'ai';
import type { Db } from 'mongodb';
import type { AppConfig } from '../../config/index.js';
import type { KnowledgeItem } from '../knowledge-core/entities.js';
import { VectorSearchService } from '../retrieval/vector-search.js';
import { createLLMModel } from '../../lib/llm.js';

const READ_OPTS = { projection: { _id: 0 } } as const;

export interface ContradictionResult {
  conflictingId: string;
  explanation: string;
}

export class ContradictionDetector {
  constructor(
    private readonly db: Db,
    private readonly llmConfig?: AppConfig['llm'],
    private readonly embeddingConfig?: AppConfig['embedding'],
  ) {}

  async detect(
    orgId: string,
    projectId: string,
    type: string,
    title: string,
    summary: string,
    content: Record<string, unknown>,
  ): Promise<ContradictionResult[]> {
    // Without LLM, graceful no-op
    const llmModel = createLLMModel({ llm: this.llmConfig ?? null });
    if (!llmModel) return [];

    try {
      // Find semantically similar published items to compare against
      const vectorService = new VectorSearchService(this.db, this.embeddingConfig ?? null);
      const candidates = await vectorService.search(
        orgId,
        `${title} ${summary}`,
        projectId,
        { k: 5, statusFilter: ['PUBLISHED'], typeFilter: [type] },
      );

      if (candidates.length === 0) return [];

      const col = this.db.collection<KnowledgeItem>('knowledge_items');
      const contradictions: ContradictionResult[] = [];

      for (const candidate of candidates) {
        if (candidate.score < 0.7) continue; // Only compare semantically close items

        const existing = (await col.findOne(
          { id: candidate.knowledgeId, organizationId: orgId } as unknown as Partial<KnowledgeItem>,
          READ_OPTS,
        )) as KnowledgeItem | null;
        if (!existing) continue;

        const prompt = [
          `You are a knowledge consistency checker.`,
          `New proposal (${type}): "${title}"\nSummary: ${summary}\nContent: ${JSON.stringify(content)}`,
          ``,
          `Existing item (${existing.type}): "${existing.title}"\nSummary: ${existing.summary}\nContent: ${JSON.stringify(existing.content)}`,
          ``,
          `Do these two items contradict each other? Reply with exactly one of:`,
          `- NO_CONTRADICTION`,
          `- CONTRADICTION: <one-sentence explanation>`,
        ].join('\n');

        const { text } = await generateText({ model: llmModel, prompt, maxTokens: 80 });
        const trimmed = text.trim();

        if (trimmed.startsWith('CONTRADICTION:')) {
          contradictions.push({
            conflictingId: existing.id,
            explanation: trimmed.replace(/^CONTRADICTION:\s*/i, '').trim(),
          });
        }
      }

      return contradictions;
    } catch {
      // Never let contradiction detection block proposal creation
      return [];
    }
  }
}
