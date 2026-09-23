import { describe, it, expect } from 'vitest';
import { RelationExpander } from '../../../src/modules/retrieval/relation-expander.js';
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
    title: `Item ${id.slice(-4)}`,
    summary: 'desc',
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

function makeRelation(subjectId: string, objectId: string): Relation {
  return {
    id: newRelationId(),
    organizationId: 'org_1',
    projectId: 'proj_1',
    subjectId,
    predicate: 'depends_on',
    objectId,
    status: 'ACCEPTED',
    version: 1,
    ownerId: 'tok_1',
    reviewerId: null,
    sourceIds: [],
    createdAt: '',
    updatedAt: '',
    lastVerifiedAt: null,
  };
}

function makeDirectResult(id: string): RerankedResult {
  return {
    knowledgeId: id,
    rrfScore: 0.8,
    type: 'Architecture',
    title: `Item ${id.slice(-4)}`,
    summary: 'desc',
    matchedSignals: ['text'],
    isStale: false,
    rerankerScore: null,
  };
}

describe('RelationExpander', () => {
  it('expands direct results by 1 hop via relations', async () => {
    const matterHistory = newKnowledgeItemId();
    const auditLog = newKnowledgeItemId();

    const { db } = createFakeDb({
      knowledge_items: [makeItem(matterHistory), makeItem(auditLog)] as never[],
      relations: [makeRelation(matterHistory, auditLog)] as never[],
    });

    const expander = new RelationExpander(db);
    const results = await expander.expand([makeDirectResult(matterHistory)], 'org_1', 'proj_1');

    // auditLog should appear as an expanded result
    const auditItem = results.find(r => r.knowledgeId === auditLog);
    expect(auditItem).toBeDefined();
    expect((auditItem as { expandedVia?: string }).expandedVia).toBe('depends_on');
  });

  it('does not duplicate items already in direct results', async () => {
    const a = newKnowledgeItemId();
    const b = newKnowledgeItemId();

    const { db } = createFakeDb({
      knowledge_items: [makeItem(a), makeItem(b)] as never[],
      relations: [makeRelation(a, b)] as never[],
    });

    const expander = new RelationExpander(db);
    // Both a and b are in direct results
    const results = await expander.expand(
      [makeDirectResult(a), makeDirectResult(b)],
      'org_1',
      'proj_1',
    );

    const bCount = results.filter(r => r.knowledgeId === b).length;
    expect(bCount).toBe(1); // no duplicate
  });

  it('respects maxExpanded cap', async () => {
    const hub = newKnowledgeItemId();
    const spokes = Array.from({ length: 15 }, () => newKnowledgeItemId());

    const { db } = createFakeDb({
      knowledge_items: [makeItem(hub), ...spokes.map(id => makeItem(id))] as never[],
      relations: spokes.map(id => makeRelation(hub, id)) as never[],
    });

    const expander = new RelationExpander(db);
    const results = await expander.expand(
      [makeDirectResult(hub)],
      'org_1',
      'proj_1',
      { maxExpanded: 5 },
    );

    const expandedItems = results.filter(r => (r as { hopDepth?: number }).hopDepth);
    expect(expandedItems.length).toBeLessThanOrEqual(5);
  });

  it('does not expand items from other projects', async () => {
    const a = newKnowledgeItemId();
    const b = newKnowledgeItemId();

    const { db } = createFakeDb({
      knowledge_items: [makeItem(a), makeItem(b, { projectId: 'proj_other' })] as never[],
      relations: [makeRelation(a, b)] as never[],
    });

    const expander = new RelationExpander(db);
    const results = await expander.expand([makeDirectResult(a)], 'org_1', 'proj_1');
    expect(results.find(r => r.knowledgeId === b)).toBeUndefined();
  });

  it('expands 2 hops when depth=2 (default)', async () => {
    const a = newKnowledgeItemId();
    const b = newKnowledgeItemId();
    const c = newKnowledgeItemId();

    const { db } = createFakeDb({
      knowledge_items: [makeItem(a), makeItem(b), makeItem(c)] as never[],
      relations: [makeRelation(a, b), makeRelation(b, c)] as never[],
    });

    const expander = new RelationExpander(db);
    const results = await expander.expand([makeDirectResult(a)], 'org_1', 'proj_1');

    expect(results.find(r => r.knowledgeId === b)).toBeDefined();
    expect(results.find(r => r.knowledgeId === c)).toBeDefined();
    const cItem = results.find(r => r.knowledgeId === c) as { hopDepth?: number };
    expect(cItem.hopDepth).toBe(2);
  });
});
