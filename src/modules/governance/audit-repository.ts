import type { Db } from "mongodb";
import { newAuditEventId, type AuditEvent } from "./audit-entities.js";

const READ_OPTS = { projection: { _id: 0 } } as const;

export interface AppendAuditInput {
  organizationId: string;
  eventType: AuditEvent["eventType"];
  targetId: string;
  targetType: AuditEvent["targetType"];
  actorId: string;
  actorName: string;
  reason?: string;
  sourceId?: string;
  previousVersion?: number;
  newVersion?: number;
}

export interface AuditEventStore {
  append(input: AppendAuditInput): Promise<AuditEvent>;
  listByTarget(organizationId: string, targetId: string): Promise<AuditEvent[]>;
}

export function createAuditEventStore(db: Db): AuditEventStore {
  const col = () => db.collection<AuditEvent>("audit_events");

  return {
    async append(input) {
      const record: AuditEvent = {
        id: newAuditEventId(),
        organizationId: input.organizationId,
        eventType: input.eventType,
        targetId: input.targetId,
        targetType: input.targetType,
        actorId: input.actorId,
        actorName: input.actorName,
        timestamp: new Date().toISOString(),
        reason: input.reason,
        sourceId: input.sourceId,
        previousVersion: input.previousVersion,
        newVersion: input.newVersion,
      };
      await col().insertOne({ ...record });
      return record;
    },

    async listByTarget(organizationId, targetId) {
      return col()
        .find({ organizationId, targetId }, READ_OPTS)
        .sort({ timestamp: 1 })
        .toArray() as Promise<AuditEvent[]>;
    },
  };
}
