import type { Db } from "mongodb";

export type Row = Record<string, unknown>;
export type Collections = Record<string, Row[]>;

export interface FakeDb {
  db: Db;
  rows: Collections;
}

/** Exact-equality match only: every filter the knowledge code issues is flat. */
function matches(row: Row, filter: Row): boolean {
  return Object.entries(filter).every(([key, value]) => row[key] === value);
}

/** Mirrors the repository's `projection: { _id: 0 }` on reads. */
function stripId(row: Row): Row {
  const copy = { ...row };
  delete copy._id;
  return copy;
}

export function createFakeDb(seed: Collections = {}): FakeDb {
  const rows: Collections = Object.fromEntries(
    Object.entries(seed).map(([name, list]) => [name, [...list]]),
  );

  const db = {
    collection: (name: string) => {
      const list = (rows[name] ??= []);
      return {
        insertOne: async (doc: Row) => {
          const stored = { _id: `fake_${list.length}`, ...doc };
          Object.assign(doc, { _id: stored._id });
          list.push(stored);
          return {};
        },
        findOne: async (filter: Row) => {
          const found = list.find((r) => matches(r, filter));
          return found ? stripId(found) : null;
        },
        find: (filter: Row) => ({
          toArray: async () => list.filter((r) => matches(r, filter)).map(stripId),
        }),
        findOneAndUpdate: async (filter: Row, update: { $set: Row }) => {
          const row = list.find((r) => matches(r, filter));
          if (!row) return null;
          Object.assign(row, update.$set);
          return stripId(row);
        },
        deleteOne: async (filter: Row) => {
          const index = list.findIndex((r) => matches(r, filter));
          if (index === -1) return { deletedCount: 0 };
          list.splice(index, 1);
          return { deletedCount: 1 };
        },
      };
    },
  } as unknown as Db;

  return { db, rows };
}
