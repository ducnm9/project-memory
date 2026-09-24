import { describe, it, expect } from 'vitest';
import { ContradictionDetector } from '../../../src/modules/governance/contradiction-detector.js';
import { createFakeDb } from '../../support/fake-db.js';

describe('ContradictionDetector', () => {
  it('returns empty array when LLM not configured', async () => {
    const { db } = createFakeDb({ knowledge_items: [] as never[] });
    const detector = new ContradictionDetector(db, undefined, undefined);
    const result = await detector.detect('org_1', 'proj_1', 'Decision', 'Use Redis', 'Redis for caching.', {});
    expect(result).toEqual([]);
  });

  it('returns empty array when no semantically similar items found', async () => {
    const { db } = createFakeDb({ knowledge_items: [] as never[] });
    // LLM configured but no embedding → VectorSearchService returns [] → nothing to compare
    const detector = new ContradictionDetector(
      db,
      { provider: 'openai', model: 'gpt-4o-mini', apiKey: 'sk-test' } as never,
      undefined,
    );
    const result = await detector.detect('org_1', 'proj_1', 'Decision', 'Use Redis', 'Redis for caching.', {});
    expect(result).toEqual([]);
  });
});
