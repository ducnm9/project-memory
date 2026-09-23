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
        try {
          // ponytail: no retry in batch path — one failure = skip; use embedItem for retried single embeds
          const model = openai.embedding(this.config.model);
          const result = await embed({ model, value: buildEmbedText(item) });
          await col.findOneAndUpdate(
            { id, organizationId: orgId },
            { $set: { embedding: result.embedding, embeddingModel: this.config.model, embeddingUpdatedAt: new Date().toISOString() } },
          );
          succeeded++;
        } catch {
          failed++;
        }
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
  // ponytail: 3 total attempts (2 retries); increase delays array for more retries
  const delays = [100, 400];
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
