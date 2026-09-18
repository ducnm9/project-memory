import { InvalidStatusTransitionError } from "../../lib/errors.js";
import type { KnowledgeStatus } from "./entities.js";

/** Statuses a newly created item may carry. */
export const INITIAL_STATUSES = ["DISCOVERED", "PROPOSED"] as const;

/** The literal domain lifecycle graph; terminal states map to []. */
const TRANSITIONS: Record<KnowledgeStatus, readonly KnowledgeStatus[]> = {
  DISCOVERED: ["PROPOSED"],
  PROPOSED: ["VALIDATING"],
  VALIDATING: ["REJECTED", "ACCEPTED"],
  ACCEPTED: ["PUBLISHED"],
  PUBLISHED: ["UPDATED", "STALE", "DEPRECATED"],
  REJECTED: [],
  UPDATED: [],
  STALE: [],
  DEPRECATED: [],
};

export function canTransition(from: KnowledgeStatus, to: KnowledgeStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: KnowledgeStatus, to: KnowledgeStatus): void {
  if (!canTransition(from, to)) throw new InvalidStatusTransitionError(from, to);
}

export function isInitialStatus(status: KnowledgeStatus): boolean {
  return (INITIAL_STATUSES as readonly KnowledgeStatus[]).includes(status);
}
