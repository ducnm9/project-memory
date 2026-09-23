import type { Db } from "mongodb";
import { newSearchRecordId, type SearchRecord } from "./entities.js";
import type { KnowledgeItem } from "../knowledge-core/entities.js";

const READ_OPTS = { projection: { _id: 0 } } as const;

export class SearchIndexer {
  constructor(private readonly db: Db) {}

  private col() {
    return this.db.collection<SearchRecord>("search_records");
  }

  async upsert(item: KnowledgeItem): Promise<void> {
    const searchText = buildSearchText(item);
    const now = new Date().toISOString();
    const existing = await this.col().findOne(
      { organizationId: item.organizationId, knowledgeId: item.id } as Partial<SearchRecord>,
      READ_OPTS,
    );
    if (existing) {
      await this.col().updateOne(
        { organizationId: item.organizationId, knowledgeId: item.id } as Partial<SearchRecord>,
        {
          $set: {
            type: item.type,
            status: item.status,
            title: item.title,
            searchText,
            ownerId: item.ownerId,
            lastVerifiedAt: item.lastVerifiedAt,
            updatedAt: now,
          },
        },
      );
    } else {
      const record: SearchRecord = {
        id: newSearchRecordId(),
        knowledgeId: item.id,
        organizationId: item.organizationId,
        projectId: item.projectId,
        type: item.type,
        status: item.status,
        title: item.title,
        searchText,
        tags: [],
        ownerId: item.ownerId,
        lastVerifiedAt: item.lastVerifiedAt,
        updatedAt: now,
      };
      await this.col().insertOne({ ...record });
    }
  }

  async remove(orgId: string, knowledgeId: string): Promise<void> {
    await this.col().deleteOne({ organizationId: orgId, knowledgeId } as Partial<SearchRecord>);
  }

  async rebuild(orgId: string, projectId: string, items: KnowledgeItem[]): Promise<void> {
    for (const item of items) {
      await this.upsert(item);
    }
    // Remove stale records not in the provided items set
    const knowledgeIds = new Set(items.map((i) => i.id));
    const existing = (await this.col()
      .find({ organizationId: orgId, projectId } as Partial<SearchRecord>, READ_OPTS)
      .toArray()) as SearchRecord[];
    for (const rec of existing) {
      if (!knowledgeIds.has(rec.knowledgeId)) {
        await this.remove(orgId, rec.knowledgeId);
      }
    }
  }

  async search(orgId: string, projectId: string, query: string): Promise<SearchRecord[]> {
    return this.col()
      .find(
        { organizationId: orgId, projectId, $text: { $search: query } } as unknown as Partial<SearchRecord>,
        READ_OPTS,
      )
      .toArray() as Promise<SearchRecord[]>;
  }
}

function buildSearchText(item: KnowledgeItem): string {
  const parts = [item.title, item.summary];
  for (const v of Object.values(item.content)) {
    if (typeof v === "string") parts.push(v);
  }
  return parts.filter(Boolean).join(" ");
}
