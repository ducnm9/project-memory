import { ForbiddenScopeError, UnauthorizedError } from "../../lib/errors.js";
import { hashSecret } from "./secret.js";
import type { TokenRepository } from "./repository.js";
import type { PrincipalRole } from "./entities.js";

export interface Actor {
  actorId: string;
  organizationId: string;
  type: "service";
  role: PrincipalRole;
}

const ROLE_ORDER: PrincipalRole[] = ["READER", "REVIEWER", "ADMIN"];

export function requireRole(actor: Actor | undefined, min: PrincipalRole): void {
  if (!actor) throw new ForbiddenScopeError("missing credentials");
  if (ROLE_ORDER.indexOf(actor.role) < ROLE_ORDER.indexOf(min)) {
    throw new ForbiddenScopeError(`requires ${min} role`);
  }
}

const BEARER = "Bearer ";

export function parseBearer(header: string | undefined): string {
  if (header === undefined || !header.startsWith(BEARER)) {
    throw new UnauthorizedError("missing or malformed credentials");
  }
  const secret = header.slice(BEARER.length).trim();
  if (secret.length === 0) {
    throw new UnauthorizedError("missing or malformed credentials");
  }
  return secret;
}

export async function resolveActor(
  repo: TokenRepository,
  pepper: string,
  header: string | undefined,
): Promise<Actor> {
  const secret = parseBearer(header);
  const token = await repo.findActiveByHash(hashSecret(secret, pepper));
  if (!token) {
    throw new UnauthorizedError("invalid credentials");
  }
  return {
    actorId: token.id,
    organizationId: token.organizationId,
    type: "service",
    role: token.role ?? "READER",
  };
}
