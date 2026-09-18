import type { Db, Document, Filter, FindCursor, WithId } from "mongodb";
import type { ProjectContext } from "../modules/project-context/context.js";

export interface ScopedCollection<T extends Document> {
  find(filter?: Filter<T>): FindCursor<WithId<T>>;
  findOne(filter?: Filter<T>): Promise<WithId<T> | null>;
  insertOne(doc: T): Promise<unknown>;
}

export function scopedCollection<T extends Document>(
  db: Db,
  name: string,
  ctx: ProjectContext,
): ScopedCollection<T> {
  const col = db.collection<T>(name);
  // Deduplicate so org-shared scope (projectId null) yields { $in: [null] }.
  const projectValues = Array.from(new Set([ctx.projectId, null]));
  const tenant = { organizationId: ctx.organizationId, projectId: { $in: projectValues } };

  const withTenant = (filter?: Filter<T>): Filter<T> =>
    ({ ...(filter ?? {}), ...tenant }) as Filter<T>;

  return {
    find: (filter) => col.find(withTenant(filter)),
    findOne: (filter) => col.findOne(withTenant(filter)),
    insertOne: (doc) =>
      col.insertOne({
        ...doc,
        organizationId: ctx.organizationId,
        projectId: ctx.projectId,
      } as unknown as Parameters<typeof col.insertOne>[0]),
  };
}
