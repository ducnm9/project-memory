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
  // Use the seed object itself as the live store: copy each collection's array
  // (so caller-owned seed arrays aren't mutated) but keep writes — including new
  // collections created on first insert — visible on the returned `rows`.
  const rows: Collections = seed;
  for (const [name, list] of Object.entries(seed)) rows[name] = [...list];

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
        find: (filter: Row) => {
          let sortKey: string | null = null;
          let sortDir: 1 | -1 = 1;
          function toArray() {
            let results = list.filter((r) => matches(r, filter)).map(stripId);
            if (sortKey) {
              const key = sortKey;
              const dir = sortDir;
              results = results.sort((a, b) => {
                const av = a[key] as number;
                const bv = b[key] as number;
                return dir * (av < bv ? -1 : av > bv ? 1 : 0);
              });
            }
            return Promise.resolve(results);
          }
          return {
            sort: (spec: Record<string, 1 | -1>) => {
              const [key, dir] = Object.entries(spec)[0];
              sortKey = key;
              sortDir = dir;
              return { toArray };
            },
            toArray,
          };
        },
        findOneAndUpdate: async (filter: Row, update: { $set?: Row; $inc?: Row }) => {
          const row = list.find((r) => matches(r, filter));
          if (!row) return null;
          if (update.$set) Object.assign(row, update.$set);
          if (update.$inc) {
            for (const [key, delta] of Object.entries(update.$inc)) {
              row[key] = ((row[key] as number) ?? 0) + (delta as number);
            }
          }
          return stripId(row);
        },
        deleteOne: async (filter: Row) => {
          const index = list.findIndex((r) => matches(r, filter));
          if (index === -1) return { deletedCount: 0 };
          list.splice(index, 1);
          return { deletedCount: 1 };
        },
        updateMany: async (filter: Row, update: { $set?: Row }) => {
          const matching = list.filter((r) => matches(r, filter));
          for (const row of matching) {
            if (update.$set) Object.assign(row, update.$set);
          }
          return { matchedCount: matching.length, modifiedCount: matching.length };
        },
      };
    },
  } as unknown as Db;

  return { db, rows };
}
