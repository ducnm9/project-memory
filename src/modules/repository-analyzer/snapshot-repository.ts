import { ulid } from "ulid";
import type { Db } from "mongodb";
import type { ProjectSnapshot } from "./entities.js";

export interface StoredProjectSnapshot extends ProjectSnapshot {
  id: string;
  organizationId: string;
  projectId: string;
  version: number;
  archivedAt: string | null;
}

export interface ProjectSnapshotStore {
  save(orgId: string, projectId: string, snapshot: ProjectSnapshot): Promise<StoredProjectSnapshot>;
  findCurrent(orgId: string, projectId: string): Promise<StoredProjectSnapshot | null>;
  findHistory(orgId: string, projectId: string): Promise<StoredProjectSnapshot[]>;
}

const READ_OPTS = { projection: { _id: 0 } } as const;

export function createProjectSnapshotStore(db: Db): ProjectSnapshotStore {
  const col = () => db.collection<StoredProjectSnapshot>("project_snapshots");

  return {
    async save(orgId, projectId, snapshot) {
      const current = await col().findOne(
        { organizationId: orgId, projectId, archivedAt: null },
        READ_OPTS,
      ) as StoredProjectSnapshot | null;

      const version = current ? current.version + 1 : 1;

      if (current) {
        await col().updateMany(
          { organizationId: orgId, projectId, archivedAt: null },
          { $set: { archivedAt: new Date().toISOString() } },
        );
      }

      const stored: StoredProjectSnapshot = {
        ...snapshot,
        id: `snap_${ulid()}`,
        organizationId: orgId,
        projectId,
        version,
        archivedAt: null,
      };
      await col().insertOne({ ...stored });
      return stored;
    },

    async findCurrent(orgId, projectId) {
      return col().findOne(
        { organizationId: orgId, projectId, archivedAt: null },
        READ_OPTS,
      ) as Promise<StoredProjectSnapshot | null>;
    },

    async findHistory(orgId, projectId) {
      return col()
        .find({ organizationId: orgId, projectId }, READ_OPTS)
        .sort({ version: -1 })
        .toArray() as Promise<StoredProjectSnapshot[]>;
    },
  };
}
