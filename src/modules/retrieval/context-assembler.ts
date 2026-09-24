import type { Db } from 'mongodb';
import type { RerankedResult } from './reranker.js';
import type { ExpandedItem } from './relation-expander.js';
import type { KnowledgeItem } from '../knowledge-core/entities.js';
import type { Relation } from '../knowledge-core/relation-entities.js';
import type { Source } from '../knowledge-core/source-entities.js';
import { createGapStore } from '../knowledge-core/gap-repository.js';

const READ_OPTS = { projection: { _id: 0 } } as const;
const DEFAULT_TOKEN_BUDGET = 8000;

export interface ContextItem {
  knowledgeId: string;
  type: string;
  title: string;
  status: string;
  relevantContent: Record<string, unknown>;
  sources: Array<{ type: string; url: string; title: string }>;
  relations: Array<{ predicate: string; relatedTitle: string }>;
  version: number;
  lastVerifiedAt: string | null;
  freshnessWarning: boolean;
}

export interface AssembledContext {
  items: ContextItem[];
  insufficient_evidence: boolean;
  knowledgeGapId: string | null;
  totalTokenEstimate: number;
}

export class ContextAssembler {
  constructor(private readonly db: Db) {}

  async assemble(
    query: string,
    candidates: (RerankedResult | ExpandedItem)[],
    orgId: string,
    projectId: string,
    opts: { tokenBudget?: number } = {},
  ): Promise<AssembledContext> {
    const tokenBudget = opts.tokenBudget ?? DEFAULT_TOKEN_BUDGET;

    if (candidates.length === 0) {
      const gap = await createGapStore(this.db).upsertOnQuestion(orgId, projectId, query);
      return { items: [], insufficient_evidence: true, knowledgeGapId: gap.id, totalTokenEstimate: 0 };
    }

    const knowledgeItems = (await this.db
      .collection<KnowledgeItem>('knowledge_items')
      .find({ organizationId: orgId, projectId } as unknown as Partial<KnowledgeItem>, READ_OPTS)
      .toArray()) as KnowledgeItem[];
    const itemMap = new Map(knowledgeItems.map((i) => [i.id, i]));

    const allRelations = (await this.db
      .collection<Relation>('relations')
      .find({ organizationId: orgId, projectId } as unknown as Partial<Relation>, READ_OPTS)
      .toArray()) as Relation[];

    const allSourceIds = [...new Set(knowledgeItems.flatMap((i) => i.sourceIds ?? []))];
    const allSources = allSourceIds.length > 0
      ? (await this.db
          .collection<Source>('sources')
          .find({ organizationId: orgId, projectId } as unknown as Partial<Source>, READ_OPTS)
          .toArray()) as Source[]
      : [];
    const sources = allSources.filter((s) => allSourceIds.includes(s.id));
    const sourceMap = new Map(sources.map((s) => [s.id, s]));

    const items: ContextItem[] = [];
    let totalTokens = 0;

    for (const candidate of candidates) {
      const item = itemMap.get(candidate.knowledgeId);
      if (!item) continue;

      const itemRelations = allRelations
        .filter((r) => r.subjectId === item.id)
        .map((r) => {
          const relatedItem = itemMap.get(r.objectId);
          return { predicate: r.predicate, relatedTitle: relatedItem?.title ?? r.objectId };
        });

      const itemSources = (item.sourceIds ?? [])
        .map((sid) => sourceMap.get(sid))
        .filter(Boolean)
        .map((s) => ({
          type: s!.type,
          url: s!.locator,
          // ponytail: title not on Source; use metadata.title if present, else locator
          title: typeof s!.metadata?.title === 'string' ? s!.metadata.title : s!.locator,
        }));

      const contextItem: ContextItem = {
        knowledgeId: item.id,
        type: item.type,
        title: item.title,
        status: item.status,
        relevantContent: item.content,
        sources: itemSources,
        relations: itemRelations,
        version: item.version,
        lastVerifiedAt: item.lastVerifiedAt,
        freshnessWarning: item.status === 'STALE',
      };

      const tokenEstimate = Math.ceil(JSON.stringify(contextItem).length / 4);
      if (totalTokens + tokenEstimate > tokenBudget && items.length > 0) break;

      items.push(contextItem);
      totalTokens += tokenEstimate;
    }

    return {
      items,
      insufficient_evidence: false,
      knowledgeGapId: null,
      totalTokenEstimate: totalTokens,
    };
  }
}
