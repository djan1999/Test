import { describe, it, expect, beforeEach } from "vitest";
import { enqueue, readQueue, removeAt, updateAt, writeQueue } from "../lib/syncQueue.js";

beforeEach(() => { writeQueue([]); });

describe("syncQueue updateAt (offline-queue retry bookkeeping)", () => {
  it("replaces the item at the given index and persists it", () => {
    enqueue({ table: "reservations", op: "insert", payload: { id: "a" } });
    enqueue({ table: "reservations", op: "insert", payload: { id: "b" } });

    updateAt(0, { table: "reservations", op: "insert", payload: { id: "a" }, attempts: 3 });

    const items = readQueue();
    expect(items).toHaveLength(2);
    expect(items[0].attempts).toBe(3);
    expect(items[1].attempts).toBeUndefined();
  });

  it("ignores out-of-range indexes", () => {
    enqueue({ table: "reservations", op: "insert", payload: { id: "a" } });
    updateAt(5, { poisoned: true });
    updateAt(-1, { poisoned: true });
    expect(readQueue()).toEqual([{ table: "reservations", op: "insert", payload: { id: "a" } }]);
  });

  it("supports the flush retry flow: bump attempts, then drop at the cap", () => {
    enqueue({ table: "service_tables", op: "upsert", payload: { table_id: 1 } });
    enqueue({ table: "service_tables", op: "upsert", payload: { table_id: 2 } });

    // Simulate repeated failed flushes of the head job.
    for (let i = 0; i < 7; i++) {
      const item = readQueue()[0];
      updateAt(0, { ...item, attempts: (item.attempts || 0) + 1 });
    }
    expect(readQueue()[0].attempts).toBe(7);

    // Eighth failure hits the cap → the job is dropped, the rest survive.
    removeAt(0);
    const items = readQueue();
    expect(items).toHaveLength(1);
    expect(items[0].payload.table_id).toBe(2);
  });
});
