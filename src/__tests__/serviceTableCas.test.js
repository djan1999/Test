import { describe, it, expect, vi } from "vitest";
import { saveServiceTableWithCas } from "../lib/serviceTableCas.js";

// Minimal supabase-client stand-in: one readable server row + a recording RPC.
function makeClient(serverRow, rpcResult = true) {
  const rpc = vi.fn(async () => ({ data: rpcResult, error: null }));
  return {
    rpc,
    from: () => ({
      select: () => {
        const chain = {
          eq: () => chain,
          maybeSingle: async () => ({ data: serverRow, error: null }),
        };
        return chain;
      },
    }),
  };
}

const workedTable = {
  id: 9, active: true, resName: "Shawn McKenna", resTime: "17:30",
  kitchenLog: {},
  bottleWines: [],
  seats: [
    { id: 1, water: "OC", pairing: "", aperitifs: [{ name: "Brut Nature ŽČ" }], glasses: [], cocktails: [], spirits: [], beers: [], extras: {}, optionalPairings: {} },
    { id: 2, water: "OC", pairing: "", aperitifs: [{ name: "Brut Nature ŽČ" }], glasses: [], cocktails: [], spirits: [], beers: [], extras: {}, optionalPairings: {} },
  ],
};

// The reservation skeleton a freshly-reset device rebuilds: party + active
// flag, but zero worked content.
const skeletonTable = {
  id: 9, active: true, resName: "Shawn McKenna", resTime: "17:30",
  kitchenLog: {},
  bottleWines: [],
  seats: [
    { id: 1, water: "—", pairing: "", aperitifs: [], glasses: [], cocktails: [], spirits: [], beers: [], extras: { cake: { ordered: false, pairing: "—" } }, optionalPairings: {} },
    { id: 2, water: "—", pairing: "", aperitifs: [], glasses: [], cocktails: [], spirits: [], beers: [], extras: { cake: { ordered: false, pairing: "—" } }, optionalPairings: {} },
  ],
};

const args = (client, data, ancestor) => ({
  client, workspaceId: "ws-a", serviceId: "svc-1", tableId: 9, data, ancestor,
});

describe("saveServiceTableWithCas — un-synced overwrite guard (24.07 incident)", () => {
  it("REGRESSION: a no-ancestor skeleton write may NOT replace a worked server table", async () => {
    const client = makeClient({ data: workedTable, updated_at: "2026-07-23T20:00:00Z" });
    await expect(saveServiceTableWithCas(args(client, skeletonTable, null))).rejects.toMatchObject({
      code: "MILKA_TABLE_CONFLICT",
      conflict: "unsynced-overwrite",
    });
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("a no-ancestor write onto a party-only server row (no worked content) still saves", async () => {
    const client = makeClient({ data: skeletonTable, updated_at: "2026-07-23T20:00:00Z" });
    const result = await saveServiceTableWithCas(args(client, { ...skeletonTable, notes: "arrived" }, null));
    expect(result.conflict).toBeNull();
    expect(client.rpc).toHaveBeenCalledTimes(1);
  });

  it("a no-ancestor write that itself carries worked content is allowed through the fold", async () => {
    const client = makeClient({ data: workedTable, updated_at: "2026-07-23T20:00:00Z" });
    const mine = JSON.parse(JSON.stringify(workedTable));
    mine.seats[0].aperitifs.push({ name: "Dry Martini" });
    const result = await saveServiceTableWithCas(args(client, mine, null));
    expect(result.conflict).toBeNull();
    expect(client.rpc).toHaveBeenCalledTimes(1);
  });

  it("a write WITH an ancestor takes the normal fold path (guard does not fire)", async () => {
    const client = makeClient({ data: workedTable, updated_at: "2026-07-23T20:00:00Z" });
    const mine = JSON.parse(JSON.stringify(workedTable));
    mine.notes = "dessert wave";
    const result = await saveServiceTableWithCas(args(client, mine, workedTable));
    expect(result.conflict).toBeNull();
    expect(client.rpc).toHaveBeenCalledTimes(1);
  });

  it("a no-ancestor write onto an EMPTY slot (no server row) inserts normally", async () => {
    const client = makeClient(null);
    const result = await saveServiceTableWithCas(args(client, skeletonTable, null));
    expect(result.conflict).toBeNull();
    expect(client.rpc).toHaveBeenCalledTimes(1);
  });
});

// The blank boot scaffold every device seeds its baselines with — a real
// (non-null) ancestor that nevertheless proves the device never saw the row.
const blankBootTable = {
  id: 9, active: false, resName: "", resTime: "", guests: 2,
  kitchenLog: {}, bottleWines: [], restrictions: [], seats: [],
};

describe("saveServiceTableWithCas — content-less ancestor guard (08.08 incident)", () => {
  it("REGRESSION: a template write with a BLANK (non-null) ancestor may NOT replace a worked server table", async () => {
    // The 08.08 wipe: a joining device's reconcile rebuilt reservation
    // templates and its autosave sent them with the blank boot scaffold as
    // ancestor. Non-null, so the 24.07 null check passed — and the seat fold
    // (no per-seat ancestor) replaced the worked seats with template seats.
    const client = makeClient({ data: workedTable, updated_at: "2026-08-08T20:00:00Z" });
    await expect(saveServiceTableWithCas(args(client, skeletonTable, blankBootTable))).rejects.toMatchObject({
      code: "MILKA_TABLE_CONFLICT",
      conflict: "unsynced-overwrite",
    });
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("a blank-ancestor write that itself carries worked content still folds through", async () => {
    const client = makeClient({ data: workedTable, updated_at: "2026-08-08T20:00:00Z" });
    const mine = JSON.parse(JSON.stringify(workedTable));
    mine.seats[0].aperitifs.push({ name: "Dry Martini" });
    const result = await saveServiceTableWithCas(args(client, mine, blankBootTable));
    expect(result.conflict).toBeNull();
    expect(client.rpc).toHaveBeenCalledTimes(1);
  });

  it("a blank-ancestor skeleton write onto a party-only server row (no worked content) still saves", async () => {
    // Seating a walk-in on a genuinely quiet table keeps working — the guard
    // only defends WORKED content.
    const client = makeClient({ data: skeletonTable, updated_at: "2026-08-08T20:00:00Z" });
    const result = await saveServiceTableWithCas(args(client, { ...skeletonTable, notes: "arrived" }, blankBootTable));
    expect(result.conflict).toBeNull();
    expect(client.rpc).toHaveBeenCalledTimes(1);
  });
});
