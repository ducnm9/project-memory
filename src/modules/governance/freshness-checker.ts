import type { Db, Filter } from "mongodb";
import type { KnowledgeItem, KnowledgeType } from "../knowledge-core/entities.js";
import type { FreshnessConfig } from "./freshness-config.js";
import { getTtlDays } from "./freshness-config.js";
import { newAuditEventId } from "./audit-entities.js";
import type { AuditEvent, AuditTargetType } from "./audit-entities.js";

const READ_OPTS = { projection: { _id: 0 } } as const;

export class FreshnessChecker {
  constructor(private readonly db: Db) {}

  async check(
    orgId: string,
    projectId: string,
    config: FreshnessConfig,
  ): Promise<{ marked: number }> {
    const col = this.db.collection<KnowledgeItem>("knowledge_items");
    const auditCol = this.db.collection<AuditEvent>("audit_events");
    const items = await col
      .find(
        { organizationId: orgId, projectId, status: "PUBLISHED" } as Filter<KnowledgeItem>,
        READ_OPTS,
      )
      .toArray() as KnowledgeItem[];

    const now = Date.now();
    let marked = 0;

    for (const item of items) {
      const ttlMs = getTtlDays(config, item.type as KnowledgeType) * 24 * 60 * 60 * 1000;
      const verifiedAt = item.lastVerifiedAt ? new Date(item.lastVerifiedAt).getTime() : 0;
      if (now - verifiedAt < ttlMs) continue;

      await col.findOneAndUpdate(
        { id: item.id, organizationId: orgId } as Filter<KnowledgeItem>,
        { $set: { status: "STALE", updatedAt: new Date().toISOString() } },
      );
      await auditCol.insertOne({
        id: newAuditEventId(),
        organizationId: orgId,
        eventType: "MARK_STALE",
        targetId: item.id,
        targetType: "knowledge" as AuditTargetType,
        actorId: "system",
        actorName: "system",
        timestamp: new Date().toISOString(),
      });
      marked++;
    }

    return { marked };
  }
}
