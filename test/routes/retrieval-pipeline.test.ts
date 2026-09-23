// test/routes/retrieval-pipeline.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('ai', () => ({ embed: vi.fn() }));

import { embed } from 'ai';
import { buildApp } from '../../src/app.js';
import { createFakeDb } from '../support/fake-db.js';
import { newKnowledgeItemId } from '../../src/modules/knowledge-core/entities.js';
import { hashSecret } from '../../src/modules/auth/secret.js';
import { newOrgId, newProjectId } from '../../src/modules/project-context/entities.js';
import type { KnowledgeItem } from '../../src/modules/knowledge-core/entities.js';

const mockEmbed = embed as ReturnType<typeof vi.fn>;

function base64Key(): string {
  return Buffer.from('0'.repeat(32)).toString('hex'); // 64-char hex
}

const ORG_ID = newOrgId();
const PROJECT_ID = newProjectId();

const TEST_CONFIG = {
  port: 3000,
  host: '0.0.0.0',
  nodeEnv: 'test' as const,
  logLevel: 'silent',
  mongodbUri: 'mongodb://localhost:27017',
  mongodbDbName: 'test',
  authAdminKey: 'admin-key',
  authTokenPepper: 'pepper',
  credentialEncryptionKey: base64Key(),
  llm: null,
  embedding: {
    provider: 'openai' as const,
    model: 'text-embedding-3-small',
    dimensions: 3,
    apiKey: 'sk-test',
  },
};

function makeItem(id: string, overrides: Partial<KnowledgeItem> = {}): KnowledgeItem {
  return {
    id,
    organizationId: ORG_ID,
    projectId: PROJECT_ID,
    type: 'Architecture',
    title: 'Auth flow',
    summary: 'JWT-based auth',
    content: {},
    status: 'PUBLISHED',
    version: 1,
    ownerId: 'tok_1',
    createdAt: '',
    updatedAt: '',
    lastVerifiedAt: null,
    sourceIds: [],
    embedding: [0.1, 0.2, 0.3],
    embeddingModel: 'text-embedding-3-small',
    embeddingUpdatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

async function buildTestApp(rows: Record<string, unknown[]> = {}) {
  const { db } = createFakeDb({
    organizations: [{ id: ORG_ID, name: 'Test Org', createdAt: '', updatedAt: '' }],
    projects: [{ id: PROJECT_ID, organizationId: ORG_ID, name: 'P1', createdAt: '', updatedAt: '' }],
    service_tokens: [{
      id: 'tok_1',
      organizationId: ORG_ID,
      name: 'Test',
      prefix: 'tok_1',
      hashedSecret: hashSecret('tok_1', 'pepper'),
      createdAt: '',
      revokedAt: null,
    }],
    search_records: [],
    knowledge_items: [],
    knowledge_gaps: [],
    relations: [],
    sources: [],
    ...rows,
  });
  const app = buildApp({ config: TEST_CONFIG, db });
  await app.ready();
  return app;
}

describe('GET /knowledge/ask — retrieval pipeline', () => {
  beforeEach(() => {
    mockEmbed.mockReset();
    mockEmbed.mockResolvedValue({ embedding: [0.1, 0.2, 0.3] });
  });

  it('returns context items for a known query', async () => {
    const id = newKnowledgeItemId();
    const app = await buildTestApp({
      knowledge_items: [makeItem(id)],
      search_records: [{
        id: 'srec_1', knowledgeId: id, organizationId: ORG_ID, projectId: PROJECT_ID,
        type: 'Architecture', status: 'PUBLISHED', title: 'Auth flow',
        searchText: 'Auth flow JWT-based auth', tags: [], ownerId: 'tok_1',
        lastVerifiedAt: null, updatedAt: '',
      }],
    });

    const resp = await app.inject({
      method: 'GET',
      url: `/knowledge/ask?projectId=${PROJECT_ID}&question=auth`,
      headers: { 'x-organization-id': ORG_ID, authorization: 'Bearer tok_1' },
    });

    expect(resp.statusCode).toBe(200);
    const body = JSON.parse(resp.body);
    expect(body.items).toBeDefined();
  });

  it('returns insufficient_evidence for unknown query', async () => {
    const app = await buildTestApp();

    const resp = await app.inject({
      method: 'GET',
      url: `/knowledge/ask?projectId=${PROJECT_ID}&question=completely+unknown+topic`,
      headers: { 'x-organization-id': ORG_ID, authorization: 'Bearer tok_1' },
    });

    expect(resp.statusCode).toBe(200);
    const body = JSON.parse(resp.body);
    expect(body.insufficient_evidence).toBe(true);
    expect(body.knowledgeGapId).toBeTruthy();
  });
});

describe('POST /knowledge/embeddings/rebuild', () => {
  beforeEach(() => {
    mockEmbed.mockReset();
    mockEmbed.mockResolvedValue({ embedding: [0.1, 0.2, 0.3] });
  });

  it('embeds all published items that need re-embedding', async () => {
    const id = newKnowledgeItemId();
    const app = await buildTestApp({
      knowledge_items: [makeItem(id, { embedding: null, embeddingModel: null })],
    });

    const resp = await app.inject({
      method: 'POST',
      url: `/knowledge/embeddings/rebuild?projectId=${PROJECT_ID}`,
      headers: { 'x-organization-id': ORG_ID, authorization: 'Bearer tok_1' },
    });

    expect(resp.statusCode).toBe(200);
    const body = JSON.parse(resp.body);
    expect(body.queued).toBe(1);
  });
});
