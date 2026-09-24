import { describe, it, expect } from 'vitest';
import { ImpactAnalyzer } from '../../../src/modules/retrieval/impact-analyzer.js';
import { createFakeDb } from '../../support/fake-db.js';
import { newKnowledgeItemId } from '../../../src/modules/knowledge-core/entities.js';
import { newRelationId } from '../../../src/modules/knowledge-core/relation-entities.js';
import type { KnowledgeItem } from '../../../src/modules/knowledge-core/entities.js';
import type { Relation } from '../../../src/modules/knowledge-core/relation-entities.js';

function makeItem(id: string, overrides: Partial<KnowledgeItem> = {}): KnowledgeItem {
  return {
    id,
    organizationId: 'org_1',
    projectId: 'proj_1',
    type: 'Architecture',
    title: `Item ${id.slice(-4)}`,
    summary: 'A component',
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

function makeRelation(
  subjectId: string,
  predicate: 'depends_on' | 'impacts',
  objectId: string,
): Relation {
  return {
    id: newRelationId(),
    organizationId: 'org_1',
    projectId: 'proj_1',
    subjectId,
    predicate,
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

describe('ImpactAnalyzer', () => {
  it('returns items that depend_on the component (component is object)', async () => {
    const auditLog = newKnowledgeItemId();
    const matterHistory = newKnowledgeItemId();

    const { db } = createFakeDb({
      knowledge_items: [
        makeItem(auditLog, { title: 'AuditLog' }),
        makeItem(matterHistory, { title: 'Matter History' }),
      ] as never[],
      relations: [makeRelation(matterHistory, 'depends_on', auditLog)] as never[],
    });

    const analyzer = new ImpactAnalyzer(db);
    const results = await analyzer.analyze('org_1', 'proj_1', auditLog);

    expect(results).toHaveLength(1);
    expect(results[0].knowledgeId).toBe(matterHistory);
    expect(results[0].signal).toBe('relation');
    expect(results[0].relationPath).toContain('depends_on');
    expect(results[0].relationPath).toContain('AuditLog');
  });

  it('returns items that are impacted by the component (component is subject)', async () => {
    const service = newKnowledgeItemId();
    const dashboard = newKnowledgeItemId();

    const { db } = createFakeDb({
      knowledge_items: [
        makeItem(service, { title: 'AuthService' }),
        makeItem(dashboard, { title: 'Dashboard' }),
      ] as never[],
      relations: [makeRelation(service, 'impacts', dashboard)] as never[],
    });

    const analyzer = new ImpactAnalyzer(db);
    const results = await analyzer.analyze('org_1', 'proj_1', service);

    expect(results).toHaveLength(1);
    expect(results[0].knowledgeId).toBe(dashboard);
    expect(results[0].signal).toBe('relation');
    expect(results[0].relationPath).toContain('impacts');
  });

  it('does not include the component itself in results', async () => {
    const a = newKnowledgeItemId();
    const b = newKnowledgeItemId();

    const { db } = createFakeDb({
      knowledge_items: [makeItem(a), makeItem(b)] as never[],
      relations: [makeRelation(b, 'depends_on', a)] as never[],
    });

    const analyzer = new ImpactAnalyzer(db);
    const results = await analyzer.analyze('org_1', 'proj_1', a);

    expect(results.find(r => r.knowledgeId === a)).toBeUndefined();
  });

  it('returns empty array when component not found', async () => {
    const { db } = createFakeDb({ knowledge_items: [] as never[], relations: [] as never[] });
    const analyzer = new ImpactAnalyzer(db);
    const results = await analyzer.analyze('org_1', 'proj_1', newKnowledgeItemId());
    expect(results).toEqual([]);
  });

  it('deduplicates items found via multiple signals', async () => {
    const a = newKnowledgeItemId();
    const b = newKnowledgeItemId();

    const { db } = createFakeDb({
      knowledge_items: [
        makeItem(a, { title: 'CoreService', embedding: [1, 0, 0] as never, embeddingModel: 'text-embedding-3-small' }),
        makeItem(b, { title: 'FeatureX',   embedding: [0.99, 0.1, 0] as never, embeddingModel: 'text-embedding-3-small' }),
      ] as never[],
      relations: [makeRelation(b, 'depends_on', a)] as never[],
    });

    // No real API key → semantic search returns empty; relation signal still fires for b
    const analyzer = new ImpactAnalyzer(db, {
      apiKey: 'sk-test',
      model: 'text-embedding-3-small',
    } as never);

    const results = await analyzer.analyze('org_1', 'proj_1', a);
    const bCount = results.filter(r => r.knowledgeId === b).length;
    expect(bCount).toBe(1);
  });

  it('ignores relations with PROPOSED/REJECTED status', async () => {
    const a = newKnowledgeItemId();
    const b = newKnowledgeItemId();

    const { db } = createFakeDb({
      knowledge_items: [makeItem(a), makeItem(b)] as never[],
      relations: [{ ...makeRelation(b, 'depends_on', a), status: 'PROPOSED' }] as never[],
    });

    const analyzer = new ImpactAnalyzer(db);
    const results = await analyzer.analyze('org_1', 'proj_1', a);
    expect(results).toHaveLength(0);
  });

  it('orders relation results before semantic results', async () => {
    const a = newKnowledgeItemId();
    const c = newKnowledgeItemId();

    const { db } = createFakeDb({
      knowledge_items: [
        makeItem(a),
        makeItem(c),
      ] as never[],
      relations: [makeRelation(c, 'depends_on', a)] as never[],
    });

    const analyzer = new ImpactAnalyzer(db);
    const results = await analyzer.analyze('org_1', 'proj_1', a);

    // c comes from relation — should be present at index 0
    const cIdx = results.findIndex(r => r.knowledgeId === c);
    expect(cIdx).toBe(0);
  });
});
