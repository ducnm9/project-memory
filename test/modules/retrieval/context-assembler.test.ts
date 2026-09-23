import { describe, it, expect } from 'vitest';
import { ContextAssembler } from '../../../src/modules/retrieval/context-assembler.js';
import { createFakeDb } from '../../support/fake-db.js';
import { newKnowledgeItemId } from '../../../src/modules/knowledge-core/entities.js';
import { newRelationId } from '../../../src/modules/knowledge-core/relation-entities.js';
import type { KnowledgeItem } from '../../../src/modules/knowledge-core/entities.js';
import type { Relation } from '../../../src/modules/knowledge-core/relation-entities.js';
import type { RerankedResult } from '../../../src/modules/retrieval/reranker.js';

function makeItem(id: string, overrides: Partial<KnowledgeItem> = {}): KnowledgeItem {
  return {
    id,
    organizationId: 'org_1',
    projectId: 'proj_1',
    type: 'Architecture',
    title: 'Auth flow',
    summary: 'Describes auth',
    content: { detail: 'JWT tokens' },
    status: 'PUBLISHED',
    version: 3,
    ownerId: 'tok_1',
    createdAt: '',
    updatedAt: '',
    lastVerifiedAt: '2026-01-01T00:00:00.000Z',
    sourceIds: [],
    embedding: null,
    embeddingModel: null,
    embeddingUpdatedAt: null,
    ...overrides,
  };
}

function makeReranked(id: string, overrides: Partial<RerankedResult> = {}): RerankedResult {
  return {
    knowledgeId: id,
    rrfScore: 0.8,
    type: 'Architecture',
    title: 'Auth flow',
    summary: 'Describes auth',
    matchedSignals: ['text'],
    isStale: false,
    rerankerScore: 0.9,
    ...overrides,
  };
}

describe('ContextAssembler', () => {
  it('builds context items with type, status, content, version, lastVerifiedAt', async () => {
    const id = newKnowledgeItemId();
    const { db } = createFakeDb({
      knowledge_items: [makeItem(id)] as never[],
      sources: [],
      relations: [],
    });

    const assembler = new ContextAssembler(db);
    const result = await assembler.assemble('auth query', [makeReranked(id)], 'org_1', 'proj_1');

    expect(result.insufficient_evidence).toBe(false);
    expect(result.knowledgeGapId).toBeNull();
    expect(result.items).toHaveLength(1);

    const item = result.items[0];
    expect(item.knowledgeId).toBe(id);
    expect(item.type).toBe('Architecture');
    expect(item.status).toBe('PUBLISHED');
    expect(item.version).toBe(3);
    expect(item.lastVerifiedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(item.freshnessWarning).toBe(false);
    expect(item.relevantContent).toEqual({ detail: 'JWT tokens' });
  });

  it('sets freshnessWarning: true for STALE items', async () => {
    const id = newKnowledgeItemId();
    const { db } = createFakeDb({
      knowledge_items: [makeItem(id, { status: 'STALE' })] as never[],
      sources: [],
      relations: [],
    });

    const assembler = new ContextAssembler(db);
    const result = await assembler.assemble('q', [makeReranked(id, { isStale: true })], 'org_1', 'proj_1');
    expect(result.items[0].freshnessWarning).toBe(true);
  });

  it('attaches 1-hop relations', async () => {
    const a = newKnowledgeItemId();
    const b = newKnowledgeItemId();
    const relation: Relation = {
      id: newRelationId(),
      organizationId: 'org_1',
      projectId: 'proj_1',
      subjectId: a,
      predicate: 'depends_on',
      objectId: b,
      status: 'ACCEPTED',
      version: 1,
      ownerId: 'tok_1',
      reviewerId: null,
      sourceIds: [],
      createdAt: '',
      updatedAt: '',
      lastVerifiedAt: null,
    };
    const { db } = createFakeDb({
      knowledge_items: [makeItem(a), makeItem(b, { title: 'AuditLog' })] as never[],
      sources: [],
      relations: [relation] as never[],
    });

    const assembler = new ContextAssembler(db);
    const result = await assembler.assemble('q', [makeReranked(a)], 'org_1', 'proj_1');
    expect(result.items[0].relations).toEqual([{ predicate: 'depends_on', relatedTitle: 'AuditLog' }]);
  });

  it('returns insufficient_evidence and creates KnowledgeGap when no candidates', async () => {
    const { db } = createFakeDb({ knowledge_items: [], sources: [], relations: [], knowledge_gaps: [] });
    const assembler = new ContextAssembler(db);
    const result = await assembler.assemble('unknown query', [], 'org_1', 'proj_1');

    expect(result.insufficient_evidence).toBe(true);
    expect(result.knowledgeGapId).toBeTruthy();
    expect(result.items).toHaveLength(0);
  });

  it('enforces token budget by truncating lower-ranked items', async () => {
    const ids = Array.from({ length: 5 }, () => newKnowledgeItemId());
    const items = ids.map(id => makeItem(id, { content: { text: 'x'.repeat(500) } }));
    const { db } = createFakeDb({ knowledge_items: items as never[], sources: [], relations: [] });

    const assembler = new ContextAssembler(db);
    // Very small token budget — should truncate
    const result = await assembler.assemble(
      'q',
      ids.map(id => makeReranked(id)),
      'org_1',
      'proj_1',
      { tokenBudget: 200 },
    );

    expect(result.items.length).toBeLessThan(5);
  });
});
