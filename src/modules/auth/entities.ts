import { ulid } from "ulid";
import { z } from "zod";

export type PrincipalRole = "ADMIN" | "REVIEWER" | "READER";

export interface ServiceToken {
  id: string;
  organizationId: string;
  name: string;
  prefix: string;
  hashedSecret: string;
  createdAt: string;
  revokedAt: string | null;
  role: PrincipalRole;
}

// Crockford base32 (ULID alphabet): no I, L, O, U.
export const tokenIdSchema = z.string().regex(/^tok_[0-9A-HJKMNP-TV-Z]{26}$/);

const nameSchema = z.string().trim().min(1);
export const createTokenBodySchema = z.object({
  name: nameSchema,
  role: z.enum(["ADMIN", "REVIEWER", "READER"]).default("READER"),
}).strict();

export function newTokenId(): string {
  return `tok_${ulid()}`;
}
