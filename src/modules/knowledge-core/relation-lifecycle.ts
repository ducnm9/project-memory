import { InvalidStatusTransitionError } from "../../lib/errors.js";
import type { RelationStatus } from "./relation-entities.js";

/** Status a newly created relation carries. */
export const INITIAL_RELATION_STATUS: RelationStatus = "PROPOSED";

/** The relation lifecycle graph; terminal states map to []. */
const TRANSITIONS: Record<RelationStatus, readonly RelationStatus[]> = {
  PROPOSED: ["ACCEPTED", "REJECTED"],
  ACCEPTED: ["DEPRECATED"],
  REJECTED: [],
  DEPRECATED: [],
};

export function canRelationTransition(from: RelationStatus, to: RelationStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertRelationTransition(from: RelationStatus, to: RelationStatus): void {
  if (!canRelationTransition(from, to)) throw new InvalidStatusTransitionError(from, to);
}
