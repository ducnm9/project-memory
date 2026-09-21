import { describe, expect, it } from "vitest";
import { createFakeDb, type Row } from "./fake-db.js";

interface FakeCollection {
  findOneAndUpdate(
    filter: Row,
    update: { $set?: Row; $inc?: Row },
  ): Promise<Row | null>;
  find(filter: Row): {
    sort(spec: Record<string, 1 | -1>): { toArray(): Promise<Row[]> };
    toArray(): Promise<Row[]>;
  };
}

describe("fake-db", () => {
  it("applies $inc in findOneAndUpdate", async () => {
    const { db } = createFakeDb({ things: [{ id: "a", organizationId: "o", count: 1 }] });
    const col = db.collection("things") as unknown as FakeCollection;
    const result = await col.findOneAndUpdate(
      { id: "a", organizationId: "o" },
      { $set: { name: "x" }, $inc: { count: 1 } },
    );
    expect(result?.count).toBe(2);
    expect(result?.name).toBe("x");
  });

  it("sort ascending on find", async () => {
    const { db } = createFakeDb({
      things: [
        { id: "a", organizationId: "o", v: 3 },
        { id: "b", organizationId: "o", v: 1 },
        { id: "c", organizationId: "o", v: 2 },
      ],
    });
    const col = db.collection("things") as unknown as FakeCollection;
    const result = await col.find({ organizationId: "o" }).sort({ v: 1 }).toArray();
    expect(result.map((r) => r.v)).toEqual([1, 2, 3]);
  });
});
