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
  readAllServiceEvents: vi.fn(async () => []),
}));
vi.mock("../lib/clientDiagnostics.js", () => ({
  recordClientDiagnostic: vi.fn(),
}));

import { readStateKey, saveStateKey } from "../lib/stateStore.js";
import { drainServiceEvents, readAllServiceEvents } from "../lib/eventLog.js";
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
  readAllServiceEvents.mockResolvedValue([]);
});

describe("recordEndOfServiceParity", () => {
  it("files a green verdict when the fold matches the final board", async () => {
    readAllServiceEvents.mockResolvedValue([
      { type: "party_seated", table_id: 1, payload: { resName: "Anna", guests: 2, arrivedAt: "19:00" } },
      { type: "seat_water_set", table_id: 1, payload: { seatId: 1, to: "STILL" } },
    ]);
    const entry = await recordEndOfServiceParity({
      serviceId: "svc-9", label: "09.08. VEČERJA", reason: "manual",
      cards: [card(1, {
        active: true, resName: "Anna", guests: 2, arrivedAt: "19:00",
        seats: [seat(1, { water: "STILL" }), seat(2)],
      })],
    });
    expect(entry).toMatchObject({
      serviceId: "svc-9", label: "09.08. VEČERJA", reason: "manual",
      events: 2, compared: 1, matches: 1, divergentTables: [],
    });
    expect(drainServiceEvents).toHaveBeenCalled(); // this device's queue flushed first
    expect(saveStateKey).toHaveBeenCalledWith(PARITY_RECORD_KEY, { entries: [entry] });
    expect(recordClientDiagnostic).not.toHaveBeenCalled();
  });

  it("a concurrent tiebreak is filed but does NOT alarm (both sides keep the seat)", async () => {
    // party seated on both sides, seat 1 present on both — only the water value
    // was tie-broke differently. Nothing lost, so no content-loss diagnostic.
    readAllServiceEvents.mockResolvedValue([
      { type: "party_seated", table_id: 3, payload: { resName: "Anna", guests: 2 } },
      { type: "seat_water_set", table_id: 3, payload: { seatId: 1, to: "SPARKLING" } },
    ]);
    const entry = await recordEndOfServiceParity({
      serviceId: "svc-9", reason: "rollover",
      cards: [card(3, { active: true, resName: "Anna", guests: 2, seats: [seat(1, { water: "STILL" })] })],
    });
    expect(entry.divergentTables).toEqual([3]);
    expect(entry.contentLossTables).toEqual([]);
    expect(entry.tiebreakTables).toEqual([3]);
    expect(recordClientDiagnostic).not.toHaveBeenCalled();
    expect(saveStateKey).toHaveBeenCalled();
  });

  it("a real content loss (a wiped party) IS filed and alarms", async () => {
    readAllServiceEvents.mockResolvedValue([
      { type: "party_seated", table_id: 3, payload: { resName: "Anna", guests: 2 } },
      { type: "seat_water_set", table_id: 3, payload: { seatId: 1, to: "SPARKLING" } },
    ]);
    const entry = await recordEndOfServiceParity({
      serviceId: "svc-9", reason: "rollover",
      cards: [card(3)], // board blank — the party vanished
    });
    expect(entry.contentLossTables).toEqual([3]);
    expect(entry.matches).toBe(0);
    expect(recordClientDiagnostic).toHaveBeenCalledWith(
      "logbook parity CONTENT LOSS (end of night)", expect.any(Error),
    );
    expect(saveStateKey).toHaveBeenCalled();
  });

  it("abstains entirely when the log holds ZERO facts (a pre-logbook service is not graded)", async () => {
    readAllServiceEvents.mockResolvedValue([]);
    const entry = await recordEndOfServiceParity({
      serviceId: "svc-old",
      cards: [card(1, { active: true, guests: 4, seats: [seat(1, { water: "STILL" })] })],
    });
    expect(entry).toBeNull();
    expect(saveStateKey).not.toHaveBeenCalled();
    expect(recordClientDiagnostic).not.toHaveBeenCalled(); // no noise-red either
  });

  it("prepends to the existing record and caps it", async () => {
    const old = Array.from({ length: 30 }, (_, i) => ({ serviceId: `old-${i}` }));
    readStateKey.mockResolvedValue({ entries: old });
    readAllServiceEvents.mockResolvedValue([
      { type: "course_fired", table_id: 1, payload: { courseKey: "c1", firedAt: "20:00" } },
    ]);
    await recordEndOfServiceParity({
      serviceId: "svc-new",
      cards: [card(1, { kitchenLog: { c1: { firedAt: "20:00" } } })],
    });
    const saved = saveStateKey.mock.calls[0][1].entries;
    expect(saved).toHaveLength(24);
    expect(saved[0].serviceId).toBe("svc-new");
    expect(saved[1].serviceId).toBe("old-0");
  });

  it("never throws: read failure, drain failure, refused save, missing service", async () => {
    const oneFact = [{ type: "course_fired", table_id: 1, payload: { courseKey: "c1", firedAt: "20:00" } }];
    readAllServiceEvents.mockRejectedValue(new Error("log unreachable"));
    expect(await recordEndOfServiceParity({ serviceId: "svc-9", cards: [] })).toBeNull();
    expect(saveStateKey).not.toHaveBeenCalled();

    readAllServiceEvents.mockResolvedValue(oneFact);
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
