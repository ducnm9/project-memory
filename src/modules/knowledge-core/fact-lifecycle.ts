import { InvalidStatusTransitionError } from "../../lib/errors.js";
import type { FactStatus } from "./fact-entities.js";

/** Status a newly created fact carries. */
export const INITIAL_FACT_STATUS: FactStatus = "PROPOSED";

/** The fact lifecycle graph; terminal states map to []. */
const TRANSITIONS: Record<FactStatus, readonly FactStatus[]> = {
  PROPOSED: ["ACCEPTED", "REJECTED"],
  ACCEPTED: ["DEPRECATED"],
  REJECTED: [],
  DEPRECATED: [],
};

export function canFactTransition(from: FactStatus, to: FactStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertFactTransition(from: FactStatus, to: FactStatus): void {
  if (!canFactTransition(from, to)) throw new InvalidStatusTransitionError(from, to);
}
