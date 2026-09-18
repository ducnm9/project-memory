import { createHmac, randomBytes } from "node:crypto";

export const SECRET_PREFIX = "pmk_";

/**
 * Generate a service-token secret. The plaintext `secret` is returned to the
 * caller exactly once; only its hash is persisted. `prefix` is a non-secret
 * display identifier: SECRET_PREFIX + the first 8 chars of the random part.
 */
export function generateSecret(): { secret: string; prefix: string } {
  const random = randomBytes(32).toString("base64url");
  const secret = `${SECRET_PREFIX}${random}`;
  const prefix = `${SECRET_PREFIX}${random.slice(0, 8)}`;
  return { secret, prefix };
}

/** Hex HMAC-SHA-256 of the secret keyed by the server-side pepper. */
export function hashSecret(secret: string, pepper: string): string {
  return createHmac("sha256", pepper).update(secret).digest("hex");
}
