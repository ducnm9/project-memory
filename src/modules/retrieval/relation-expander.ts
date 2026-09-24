import type { Db } from 'mongodb';
import type { RerankedResult } from './reranker.js';
import type { KnowledgeItem } from '../knowledge-core/entities.js';
import type { Relation } from '../knowledge-core/relation-entities.js';

const READ_OPTS = { projection: { _id: 0 } } as const;

export interface ExpandedItem {
  knowledgeId: string;
  type: string;
  title: string;
  summary: string;
  expandedVia: string;
  hopDepth: number;
  rerankerScore: null;
  rrfScore: number;
  matchedSignals: [];
  isStale: boolean;
}

export class RelationExpander {
  constructor(private readonly db: Db) {}

  async expand(
    directResults: RerankedResult[],
    orgId: string,
    projectId: string,
    opts: { depth?: number; maxExpanded?: number; statusFilter?: string[] } = {},
  ): Promise<(RerankedResult | ExpandedItem)[]> {
    try {
      const { depth = 2, maxExpanded = 10, statusFilter = ['PUBLISHED', 'STALE', 'ACCEPTED'] } = opts;

      // Fetch all project relations once — filter in JS
      // ponytail: full relation scan per query, fine for typical project sizes (<5k relations);
      // add compound index { projectId, subjectId } / { projectId, objectId } if profiling shows hotspot
      const allRelations = (await this.db
        .collection<Relation>('relations')
        .find({ organizationId: orgId, projectId } as unknown as Partial<Relation>, READ_OPTS)
        .toArray()) as Relation[];

      const seen = new Set(directResults.map((r) => r.knowledgeId));
      const expanded: ExpandedItem[] = [];

      // BFS queue: { knowledgeId, hopDepth }
      const queue: { knowledgeId: string; hopDepth: number; via: string }[] = directResults.map((r) => ({
        knowledgeId: r.knowledgeId,
        hopDepth: 0,
        via: '',
      }));

      while (queue.length > 0 && expanded.length < maxExpanded) {
        const { knowledgeId, hopDepth } = queue.shift()!;
        if (hopDepth >= depth) continue;

        // Find connected IDs from relations (both directions)
        const connected: { id: string; via: string }[] = [];
        for (const rel of allRelations) {
          if (rel.subjectId === knowledgeId) connected.push({ id: rel.objectId, via: rel.predicate });
          if (rel.objectId === knowledgeId) connected.push({ id: rel.subjectId, via: rel.predicate });
        }

        for (const { id: neighborId, via } of connected) {
          if (seen.has(neighborId) || expanded.length >= maxExpanded) continue;

          // Fetch the neighbor item to verify project scope and status
          const item = (await this.db
            .collection<KnowledgeItem>('knowledge_items')
            .findOne(
              { id: neighborId, organizationId: orgId, projectId } as unknown as Partial<KnowledgeItem>,
              READ_OPTS,
            )) as KnowledgeItem | null;

          if (!item || !statusFilter.includes(item.status)) continue;

          seen.add(neighborId);
          expanded.push({
            knowledgeId: neighborId,
            type: item.type,
            title: item.title,
            summary: item.summary,
            expandedVia: via,
            hopDepth: hopDepth + 1,
            rerankerScore: null,
            rrfScore: 0,
            matchedSignals: [],
            isStale: item.status === 'STALE',
          });

          if (hopDepth + 1 < depth) {
            queue.push({ knowledgeId: neighborId, hopDepth: hopDepth + 1, via });
          }
        }
      }

      return [...directResults, ...expanded];
    } catch (err) {
      console.error({ err }, 'relation expansion failed — returning direct results');
      return [...directResults];
    }
  }
}
