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
    const { db, rows } = createFakeDb({ knowledge_items: [item as never] });
    const pipeline = new EmbeddingPipeline(db, EMBEDDING_CONFIG);

    await pipeline.embedItem('org_1', item.id);

    const stored = rows['knowledge_items'][0] as unknown as KnowledgeItem;
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
    const { db, rows } = createFakeDb({ knowledge_items: [item as never] });
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
    const { db } = createFakeDb({ knowledge_items: items as never[] });
    const pipeline = new EmbeddingPipeline(db, EMBEDDING_CONFIG);
    const result = await pipeline.embedBatch('org_1', items.map(i => i.id));
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(1);
  });
});
