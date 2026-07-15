import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  watches: [],
  reads: {
    reservations: vi.fn(), serviceTables: vi.fn(), wines: vi.fn(),
    beverages: vi.fn(), menuCourses: vi.fn(), liveSettings: vi.fn(),
  },
}));

vi.mock("../powersync/system.js", () => ({
  getPowerSync: () => ({
    watch: vi.fn((sql, _params, callbacks, options) => {
      const unsubscribe = vi.fn();
      h.watches.push({ sql, callbacks, options, unsubscribe });
      return { unsubscribe };
    }),
  }),
}));
vi.mock("../powersync/reads.js", () => ({
  readReservations: h.reads.reservations,
  readServiceTables: h.reads.serviceTables,
  readWines: h.reads.wines,
  readBeverages: h.reads.beverages,
  readMenuCourses: h.reads.menuCourses,
  readLiveSettings: h.reads.liveSettings,
}));

import { startWatches } from "../powersync/watch.js";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("PowerSync watches", () => {
  beforeEach(() => {
    h.watches.length = 0;
    Object.values(h.reads).forEach((fn) => fn.mockReset().mockResolvedValue([]));
  });

  it("reports mapped read failures with their source and phase", async () => {
    const error = new Error("blank cache read");
    h.reads.serviceTables.mockRejectedValueOnce(error);
    const onError = vi.fn();
    startWatches({ onServiceTables: vi.fn() }, { from: "2026-01-01", to: "2026-01-02" }, { onError });
    h.watches[0].callbacks.onResult();
    await tick();
    expect(onError).toHaveBeenCalledWith({ source: "service_tables", phase: "read", error });
  });

  it("reports watch-engine failures without swallowing them", () => {
    const error = new Error("sqlite engine stopped");
    const onError = vi.fn();
    startWatches({ onReservations: vi.fn() }, { from: "2026-01-01", to: "2026-01-02" }, { onError });
    h.watches[0].callbacks.onError(error);
    expect(onError).toHaveBeenCalledWith({ source: "reservations", phase: "engine", error });
  });

  it("becomes ready only after every enabled source completes its first read", async () => {
    const onReady = vi.fn();
    startWatches({ onReservations: vi.fn(), onServiceTables: vi.fn() }, { from: "2026-01-01", to: "2026-01-02" }, { onReady });
    h.watches.find((w) => w.sql.includes("reservations")).callbacks.onResult();
    await tick();
    expect(onReady).not.toHaveBeenCalled();
    h.watches.find((w) => w.sql.includes("service_tables")).callbacks.onResult();
    await tick();
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onReady.mock.calls[0][0].sources).toEqual(expect.arrayContaining(["reservations", "service_tables"]));
  });

  it("aborts and disposes every subscription", () => {
    const dispose = startWatches({ onReservations: vi.fn(), onServiceTables: vi.fn() }, { from: "2026-01-01", to: "2026-01-02" });
    const signal = h.watches[0].options.signal;
    dispose();
    expect(signal.aborted).toBe(true);
    h.watches.forEach((watch) => expect(watch.unsubscribe).toHaveBeenCalledTimes(1));
  });
});
