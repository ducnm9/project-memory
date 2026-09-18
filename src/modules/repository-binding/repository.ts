import type { Db } from "mongodb";
import { newRepositoryId, type Repository, type RepositoryConnector } from "./entities.js";

const READ_OPTS = { projection: { _id: 0 } } as const;

export interface CreateRepositoryInput {
  organizationId: string;
  projectId: string;
  url: string;
  host: string;
  path: string;
  connector: RepositoryConnector;
  defaultBranch: string | null;
  createdBy: string;
}

export interface RepositoryStore {
  createRepository(input: CreateRepositoryInput): Promise<Repository>;
  findActiveByUrl(organizationId: string, url: string): Promise<Repository | null>;
  listActiveByProject(organizationId: string, projectId: string): Promise<Repository[]>;
  markUnbound(organizationId: string, projectId: string, id: string): Promise<boolean>;
}

export function createRepositoryStore(db: Db): RepositoryStore {
  const col = () => db.collection<Repository>("repositories");

  return {
    async createRepository(input) {
      const repository: Repository = {
        id: newRepositoryId(),
        organizationId: input.organizationId,
        projectId: input.projectId,
        url: input.url,
        host: input.host,
        path: input.path,
        connector: input.connector,
        defaultBranch: input.defaultBranch,
        createdAt: new Date().toISOString(),
        createdBy: input.createdBy,
        unboundAt: null,
      };
      await col().insertOne(repository);
      return repository;
    },
    async findActiveByUrl(organizationId, url) {
      return col().findOne(
        { organizationId, url, unboundAt: null },
        READ_OPTS,
      ) as Promise<Repository | null>;
    },
    async listActiveByProject(organizationId, projectId) {
      return col()
        .find({ organizationId, projectId, unboundAt: null }, READ_OPTS)
        .toArray() as Promise<Repository[]>;
    },
    async markUnbound(organizationId, projectId, id) {
      const res = await col().updateOne(
        { id, organizationId, projectId, unboundAt: null },
        { $set: { unboundAt: new Date().toISOString() } },
      );
      return res.matchedCount > 0;
    },
  };
}
