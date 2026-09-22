import { ulid } from "ulid";
import { z } from "zod";
import type { Fact } from "./fact-entities.js";

export interface FactVersion {
  id: string;
  organizationId: string;
  factId: string;
  version: number;
  snapshot: Fact;
  changedBy: string;
  changedAt: string;
  changeSummary: string;
}

// Crockford base32 (ULID alphabet): no I, L, O, U.
export const factVersionIdSchema = z.string().regex(/^fver_[0-9A-HJKMNP-TV-Z]{26}$/);

export function newFactVersionId(): string {
  return `fver_${ulid()}`;
}
