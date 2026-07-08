import { describe, it, expect, beforeEach, vi } from "vitest";

// powersync/system.js account-switch guard: one on-device DB file serves
// whoever is logged in, so connecting as a DIFFERENT Supabase user than the
// one who last synced must clear the local DB first (disconnectAndClear).
// Without it, the new session goes sqlite-primary on the previous account's
// rows and stale sync flags — the 07/08.07 shared-device handover mess
// (admin → restaurant login on the same phone).

const h = vi.hoisted(() => ({
  userId: "user-a",
  clears: 0,
  connects: 0,
}));

vi.mock("@powersync/web", () => ({
  PowerSyncDatabase: class {
    constructor() { this.currentStatus = {}; }
    async connect() { h.connects += 1; }
    async disconnect() {}
    async disconnectAndClear() { h.clears += 1; }
    registerListener() { return () => {}; }
  },
  column: { text: "text", integer: "integer" },
  Schema: class { constructor(tables) { this.tables = tables; } },
  Table: class { constructor(cols, opts) { this.cols = cols; this.opts = opts; } },
}));

vi.mock("../lib/supabaseClient.js", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { user: { id: h.userId }, access_token: "t" } } }) },
  },
  getWorkspaceId: () => "ws-1",
}));

// Fresh module (and its _db/_connected singletons) per test.
const loadSystem = async () => {
  vi.resetModules();
  return import("../powersync/system.js");
};

beforeEach(() => {
  h.userId = "user-a";
  h.clears = 0;
  h.connects = 0;
  localStorage.clear();
});

describe("powersync/system — account-switch clears the on-device DB", () => {
  it("first login on a device stores the user and does NOT clear", async () => {
    const { connect } = await loadSystem();
    await connect();
    expect(h.clears).toBe(0);
    expect(h.connects).toBe(1);
    expect(localStorage.getItem("milka-powersync-last-user")).toBe("user-a");
  });

  it("the same user reconnecting does NOT clear", async () => {
    localStorage.setItem("milka-powersync-last-user", "user-a");
    const { connect } = await loadSystem();
    await connect();
    expect(h.clears).toBe(0);
  });

  it("a DIFFERENT user connecting clears the local DB first, then connects", async () => {
    localStorage.setItem("milka-powersync-last-user", "user-a");
    h.userId = "user-b";
    const { connect } = await loadSystem();
    await connect();
    expect(h.clears).toBe(1);
    expect(h.connects).toBe(1);
    expect(localStorage.getItem("milka-powersync-last-user")).toBe("user-b");
  });
});
