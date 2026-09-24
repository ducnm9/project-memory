import type { Db } from 'mongodb';
import type { KnowledgeItem } from '../knowledge-core/entities.js';
import type { Relation } from '../knowledge-core/relation-entities.js';
import type { AppConfig } from '../../config/index.js';
import { VectorSearchService } from './vector-search.js';

const READ_OPTS = { projection: { _id: 0 } } as const;

export interface ImpactResult {
  knowledgeId: string;
  type: string;
  title: string;
  summary: string;
  /** How this item was identified as affected */
  signal: 'relation' | 'semantic';
  /** Human-readable dependency path, present for relation signal only */
  relationPath?: string;
  /** Cosine similarity score, present for semantic signal only */
  score?: number;
}

export class ImpactAnalyzer {
  constructor(
    private readonly db: Db,
    private readonly embeddingConfig?: AppConfig['embedding'],
  ) {}

  async analyze(
    orgId: string,
    projectId: string,
    componentId: string,
  ): Promise<ImpactResult[]> {
    const itemCol = this.db.collection<KnowledgeItem>('knowledge_items');
    const relCol = this.db.collection<Relation>('relations');

    // Fetch the component itself to get its title/summary for semantic search
    const component = (await itemCol.findOne(
      { id: componentId, organizationId: orgId, projectId } as unknown as Partial<KnowledgeItem>,
      READ_OPTS,
    )) as KnowledgeItem | null;

    if (!component) return [];

    const seen = new Set<string>([componentId]);
    const results: ImpactResult[] = [];

    // Signal 1: explicit relation graph
    // - component is subjectId + predicate 'impacts' → objectId items are directly impacted
    // - component is objectId + predicate 'depends_on' → subjectId items are impacted (they rely on component)
    const relations = (await relCol
      .find(
        { organizationId: orgId, projectId, status: 'ACCEPTED' } as unknown as Partial<Relation>,
        READ_OPTS,
      )
      .toArray()) as Relation[];

    for (const rel of relations) {
      let affectedId: string | null = null;

      if (rel.predicate === 'impacts' && rel.subjectId === componentId) {
        affectedId = rel.objectId;
      } else if (rel.predicate === 'depends_on' && rel.objectId === componentId) {
        affectedId = rel.subjectId;
      }

      if (!affectedId || seen.has(affectedId)) continue;
      seen.add(affectedId);

      const item = (await itemCol.findOne(
        { id: affectedId, organizationId: orgId, projectId } as unknown as Partial<KnowledgeItem>,
        READ_OPTS,
      )) as KnowledgeItem | null;

      if (!item) continue;

      // Build a readable path using actual item title
      const readablePath =
        rel.predicate === 'impacts'
          ? `${component.title} impacts ${item.title} via ${rel.id}`
          : `${item.title} depends_on ${component.title} via ${rel.id}`;

      results.push({
        knowledgeId: item.id,
        type: item.type,
        title: item.title,
        summary: item.summary,
        signal: 'relation',
        relationPath: readablePath,
      });
    }

    // Signal 2: semantic similarity
    const vectorService = new VectorSearchService(this.db, this.embeddingConfig ?? null);
    const semantic = await vectorService.search(
      orgId,
      `${component.title} ${component.summary}`,
      projectId,
      { k: 10, statusFilter: ['PUBLISHED', 'ACCEPTED', 'STALE'] },
    );

    for (const r of semantic) {
      if (seen.has(r.knowledgeId)) continue;
      seen.add(r.knowledgeId);
      results.push({
        knowledgeId: r.knowledgeId,
        type: r.type,
        title: r.title,
        summary: r.summary,
        signal: 'semantic',
        score: r.score,
      });
    }

    // Relation hits first (more direct), then semantic by score descending
    return results.sort((a, b) => {
      if (a.signal === 'relation' && b.signal !== 'relation') return -1;
      if (b.signal === 'relation' && a.signal !== 'relation') return 1;
      return (b.score ?? 0) - (a.score ?? 0);
    });
  }
}
