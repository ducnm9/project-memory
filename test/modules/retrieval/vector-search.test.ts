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
    const { db } = createFakeDb({ knowledge_items: [itemA, itemB] as never[] });
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
    const { db } = createFakeDb({ knowledge_items: [itemOtherProject] as never[] });
    const svc = new VectorSearchService(db, EMBEDDING_CONFIG);

    const results = await svc.search('org_1', 'auth', 'proj_1');
    expect(results).toHaveLength(0);
  });

  it('skips items with null embeddings', async () => {
    const item = makeItem({ embedding: null });
    const { db } = createFakeDb({ knowledge_items: [item] as never[] });
    const svc = new VectorSearchService(db, EMBEDDING_CONFIG);

    const results = await svc.search('org_1', 'auth', 'proj_1');
    expect(results).toHaveLength(0);
  });

  it('returns [] when embedding config is null', async () => {
    const item = makeItem({ embedding: [1, 0, 0] });
    const { db } = createFakeDb({ knowledge_items: [item] as never[] });
    const svc = new VectorSearchService(db, null);

    const results = await svc.search('org_1', 'auth', 'proj_1');
    expect(results).toHaveLength(0);
  });

  it('respects statusFilter', async () => {
    const published = makeItem({ status: 'PUBLISHED', embedding: [1, 0, 0], embeddingModel: 'text-embedding-3-small' });
    const stale = makeItem({ status: 'STALE', embedding: [1, 0, 0], embeddingModel: 'text-embedding-3-small' });
    const { db } = createFakeDb({ knowledge_items: [published, stale] as never[] });
    const svc = new VectorSearchService(db, EMBEDDING_CONFIG);

    const results = await svc.search('org_1', 'auth', 'proj_1', { statusFilter: ['PUBLISHED'] });
    expect(results).toHaveLength(1);
    expect(results[0].knowledgeId).toBe(published.id);
  });

  it('respects k limit', async () => {
    const items = Array.from({ length: 5 }, () =>
      makeItem({ embedding: [1, 0, 0], embeddingModel: 'text-embedding-3-small' })
    );
    const { db } = createFakeDb({ knowledge_items: items as never[] });
    const svc = new VectorSearchService(db, EMBEDDING_CONFIG);

    const results = await svc.search('org_1', 'auth', 'proj_1', { k: 3 });
    expect(results).toHaveLength(3);
  });
});
