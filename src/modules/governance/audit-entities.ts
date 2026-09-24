import { ulid } from "ulid";

export type AuditEventType =
  | "CREATE"
  | "UPDATE"
  | "DEPRECATE"
  | "RELATION_CREATE"
  | "RELATION_UPDATE"
  | "RELATION_DELETE"
  | "APPROVE"
  | "REJECT"
  | "VERIFY"
  | "MARK_STALE"
  | "REQUEST_CHANGES"
  | "RESOLVE_CONFLICT";

export type AuditTargetType = "knowledge" | "relation" | "fact";

export interface AuditEvent {
  id: string;
  organizationId: string;
  eventType: AuditEventType;
  targetId: string;
  targetType: AuditTargetType;
  actorId: string;
  actorName: string; // denormalized display name (fallback to actorId)
  timestamp: string; // ISO 8601
  reason?: string;
  sourceId?: string;
  previousVersion?: number;
  newVersion?: number;
}

export function newAuditEventId(): string {
  return `aevt_${ulid()}`;
}
