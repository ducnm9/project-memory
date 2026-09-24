import { describe, it, expect } from 'vitest';
import { DuplicateDetector } from '../../../src/modules/governance/duplicate-detector.js';
import { createFakeDb } from '../../support/fake-db.js';
import { newKnowledgeItemId } from '../../../src/modules/knowledge-core/entities.js';
import type { KnowledgeItem } from '../../../src/modules/knowledge-core/entities.js';

function makeItem(id: string, overrides: Partial<KnowledgeItem> = {}): KnowledgeItem {
  return {
    id,
    organizationId: 'org_1',
    projectId: 'proj_1',
    type: 'Decision',
    title: 'Use PostgreSQL',
    summary: 'We chose PostgreSQL as our database.',
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

describe('DuplicateDetector', () => {
  it('returns null when no existing items', async () => {
    const { db } = createFakeDb({ knowledge_items: [] as never[] });
    const detector = new DuplicateDetector(db);
    const result = await detector.detect('org_1', 'proj_1', 'Decision', 'Use Redis', 'Redis for caching.', []);
    expect(result).toBeNull();
  });

  it('detects exact title match (case-insensitive)', async () => {
    const id = newKnowledgeItemId();
    const { db } = createFakeDb({
      knowledge_items: [makeItem(id, { title: 'Use PostgreSQL' })] as never[],
    });
    const detector = new DuplicateDetector(db);
    const result = await detector.detect('org_1', 'proj_1', 'Decision', 'use postgresql', 'Some summary.', []);
    expect(result).not.toBeNull();
    expect(result!.duplicate).toBe(true);
    expect(result!.existingId).toBe(id);
    expect(result!.reason).toBe('exact_title');
  });

  it('detects source overlap > 50%', async () => {
    const id = newKnowledgeItemId();
    const sharedSrc = 'src_01J000000000000000000000001';
    const { db } = createFakeDb({
      knowledge_items: [makeItem(id, { title: 'Different Title', sourceIds: [sharedSrc] })] as never[],
    });
    const detector = new DuplicateDetector(db);
    const result = await detector.detect('org_1', 'proj_1', 'Decision', 'New Proposal', 'Summary.', [sharedSrc]);
    expect(result).not.toBeNull();
    expect(result!.reason).toBe('source_overlap');
    expect(result!.duplicate).toBe(false);
  });

  it('returns null when no source overlap', async () => {
    const id = newKnowledgeItemId();
    const { db } = createFakeDb({
      knowledge_items: [makeItem(id, {
        title: 'Other',
        sourceIds: ['src_01J000000000000000000000002'],
      })] as never[],
    });
    const detector = new DuplicateDetector(db);
    const result = await detector.detect('org_1', 'proj_1', 'Decision', 'New Title', 'Summary.', ['src_01J000000000000000000000003']);
    expect(result).toBeNull();
  });

  it('does not match items from other projects', async () => {
    const id = newKnowledgeItemId();
    const { db } = createFakeDb({
      knowledge_items: [makeItem(id, { title: 'Use PostgreSQL', projectId: 'proj_other' })] as never[],
    });
    const detector = new DuplicateDetector(db);
    const result = await detector.detect('org_1', 'proj_1', 'Decision', 'Use PostgreSQL', 'Summary.', []);
    expect(result).toBeNull();
  });

  it('returns null when embedding not configured (no semantic check)', async () => {
    const { db } = createFakeDb({ knowledge_items: [] as never[] });
    const detector = new DuplicateDetector(db, undefined);
    const result = await detector.detect('org_1', 'proj_1', 'Decision', 'Some Title', 'Summary.', []);
    expect(result).toBeNull();
  });
});
