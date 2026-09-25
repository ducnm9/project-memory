import type { Db } from "mongodb";
import { newTokenId, type PrincipalRole, type ServiceToken } from "./entities.js";
import { generateSecret, hashSecret } from "./secret.js";

const READ_OPTS = { projection: { _id: 0 } } as const;
const LIST_OPTS = { projection: { _id: 0, hashedSecret: 0 } } as const;

export type PublicToken = Omit<ServiceToken, "hashedSecret">;

export interface TokenRepository {
  createToken(organizationId: string, name: string, role?: PrincipalRole): Promise<{ token: ServiceToken; secret: string }>;
  findActiveByHash(hashedSecret: string): Promise<ServiceToken | null>;
  listTokens(organizationId: string): Promise<PublicToken[]>;
  revokeToken(organizationId: string, id: string): Promise<boolean>;
}

export function createTokenRepository(db: Db, pepper: string): TokenRepository {
  const col = () => db.collection<ServiceToken>("service_tokens");

  return {
    async createToken(organizationId, name, role: PrincipalRole = "READER") {
      const { secret, prefix } = generateSecret();
      const token: ServiceToken = {
        id: newTokenId(),
        organizationId,
        name,
        prefix,
        hashedSecret: hashSecret(secret, pepper),
        createdAt: new Date().toISOString(),
        revokedAt: null,
        role,
      };
      await col().insertOne(token);
      return { token, secret };
    },
    async findActiveByHash(hashedSecret) {
      return col().findOne({ hashedSecret, revokedAt: null }, READ_OPTS) as Promise<ServiceToken | null>;
    },
    async listTokens(organizationId) {
      return col().find({ organizationId }, LIST_OPTS).toArray() as Promise<PublicToken[]>;
    },
    async revokeToken(organizationId, id) {
      const res = await col().updateOne(
        { id, organizationId, revokedAt: null },
        { $set: { revokedAt: new Date().toISOString() } },
      );
      return res.matchedCount > 0;
    },
  };
}
