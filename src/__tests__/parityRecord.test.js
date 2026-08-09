// The parity record's contract (lib/parityRecord.js): every service end files
// an end-of-night verdict — fold(log) vs final board — into the settings
// store, newest first, capped; and NOTHING that fails inside it can ever
// affect ending a service.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/stateStore.js", () => ({
  readStateKey: vi.fn(async () => null),
  saveStateKey: vi.fn(async () => ({ ok: true })),
}));
vi.mock("../lib/eventLog.js", () => ({
  drainServiceEvents: vi.fn(async () => ({ ok: true, uploaded: 0 })),
  readServiceEvents: vi.fn(async () => []),
}));
vi.mock("../lib/clientDiagnostics.js", () => ({
  recordClientDiagnostic: vi.fn(),
}));

import { readStateKey, saveStateKey } from "../lib/stateStore.js";
import { drainServiceEvents, readServiceEvents } from "../lib/eventLog.js";
import { recordClientDiagnostic } from "../lib/clientDiagnostics.js";
import { readParityRecord, recordEndOfServiceParity, PARITY_RECORD_KEY } from "../lib/parityRecord.js";

const card = (id, over = {}) => ({
  id, active: false, resName: "", guests: 2, arrivedAt: null,
  seats: [], kitchenLog: {}, bottleWines: [], ...over,
});
const seat = (id, over = {}) => ({
  id, water: "—", pairing: "", aperitifs: [], glasses: [], cocktails: [],
  spirits: [], beers: [], extras: {}, optionalPairings: {}, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  readStateKey.mockResolvedValue(null);
  saveStateKey.mockResolvedValue({ ok: true });
  drainServiceEvents.mockResolvedValue({ ok: true, uploaded: 0 });
  readServiceEvents.mockResolvedValue([]);
});

describe("recordEndOfServiceParity", () => {
  it("files a green verdict when the fold matches the final board", async () => {
    readServiceEvents.mockResolvedValue([
      { type: "party_seated", table_id: 1, payload: { resName: "Anna", guests: 2, arrivedAt: "19:00" } },
      { type: "seat_water_set", table_id: 1, payload: { seatId: 1, to: "STILL" } },
    ]);
    const entry = await recordEndOfServiceParity({
      serviceId: "svc-9", label: "09.08. VEČERJA", reason: "manual",
      cards: [card(1, { active: true, guests: 2, seats: [seat(1, { water: "STILL" }), seat(2)] })],
    });
    expect(entry).toMatchObject({
      serviceId: "svc-9", label: "09.08. VEČERJA", reason: "manual",
      events: 2, compared: 1, matches: 1, divergentTables: [],
    });
    expect(drainServiceEvents).toHaveBeenCalled(); // this device's queue flushed first
    expect(saveStateKey).toHaveBeenCalledWith(PARITY_RECORD_KEY, { entries: [entry] });
    expect(recordClientDiagnostic).not.toHaveBeenCalled();
  });

  it("files a red verdict naming the tables and records a diagnostic", async () => {
    readServiceEvents.mockResolvedValue([
      { type: "party_seated", table_id: 3, payload: { guests: 2 } },
      { type: "seat_water_set", table_id: 3, payload: { seatId: 1, to: "SPARKLING" } },
    ]);
    const entry = await recordEndOfServiceParity({
      serviceId: "svc-9", reason: "rollover",
      cards: [card(3, { active: true, guests: 2, seats: [seat(1, { water: "STILL" })] })],
    });
    expect(entry.divergentTables).toEqual([3]);
    expect(entry.matches).toBe(0);
    expect(recordClientDiagnostic).toHaveBeenCalledWith(
      "logbook parity divergence (end of night)", expect.any(Error),
    );
    expect(saveStateKey).toHaveBeenCalled();
  });

  it("prepends to the existing record and caps it", async () => {
    const old = Array.from({ length: 30 }, (_, i) => ({ serviceId: `old-${i}` }));
    readStateKey.mockResolvedValue({ entries: old });
    await recordEndOfServiceParity({ serviceId: "svc-new", cards: [] });
    const saved = saveStateKey.mock.calls[0][1].entries;
    expect(saved).toHaveLength(24);
    expect(saved[0].serviceId).toBe("svc-new");
    expect(saved[1].serviceId).toBe("old-0");
  });

  it("never throws: read failure, drain failure, refused save, missing service", async () => {
    readServiceEvents.mockRejectedValue(new Error("log unreachable"));
    expect(await recordEndOfServiceParity({ serviceId: "svc-9", cards: [] })).toBeNull();
    expect(saveStateKey).not.toHaveBeenCalled();

    readServiceEvents.mockResolvedValue([]);
    drainServiceEvents.mockRejectedValue(new Error("offline"));
    expect(await recordEndOfServiceParity({ serviceId: "svc-9", cards: [] })).not.toBeNull();

    saveStateKey.mockResolvedValue({ ok: false, error: new Error("no workspace") });
    expect(await recordEndOfServiceParity({ serviceId: "svc-9", cards: [] })).toBeNull();

    expect(await recordEndOfServiceParity({ serviceId: null, cards: [] })).toBeNull();
  });
});

describe("readParityRecord", () => {
  it("returns entries when stored, [] on garbage or read failure", async () => {
    readStateKey.mockResolvedValue({ entries: [{ serviceId: "s1" }] });
    expect(await readParityRecord()).toEqual([{ serviceId: "s1" }]);

    readStateKey.mockResolvedValue("not-an-object");
    expect(await readParityRecord()).toEqual([]);

    readStateKey.mockRejectedValue(new Error("no active workspace"));
    expect(await readParityRecord()).toEqual([]);
  });
});
