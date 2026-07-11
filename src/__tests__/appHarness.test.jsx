// ── App-level integration harness ─────────────────────────────────────────────
//
// Renders the REAL App against the in-memory backend (harness/fakeBackend.js)
// and drives whole service scenarios through the UI, in BOTH storage modes:
// direct-Supabase fallback and SQLite-primary (PowerSync). This is the layer
// the unit tests can't see — effect wiring, seam routing, autosave timing,
// reconcile-vs-watch interactions — where both 04.07 production incidents
// lived. Scenarios:
//
//   1. Join a live service mid-shift (second device just drops in — never a
//      "start" prompt, never a wipe).
//   2. Table switch via Detail → CHANGE TABLE: state, store rows and the
//      reservation all repoint; a store round-trip does NOT bounce the guest
//      back (the PR #44 duplication).
//   3. Open with a stale service_date while the board carries TODAY's live
//      activity → must re-date forward and KEEP the board (04.07 incident #1).
//   4. Genuine overnight leftover → must archive FIRST, then clear.
//   5. Offline → reconnect: edits survive the outage and converge to the
//      store (autosave retry/re-queue on fallback; local-first + upload
//      queue drain on SQLite-primary).

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";
import {
  backend, resetBackend, seed, remoteRows, localRows,
  drainUploads, syncDown, WORKSPACE_ID,
  emitRealtime, subscribedChannelCount,
} from "./harness/fakeBackend.js";
import { currentServiceDay } from "../utils/serviceDay.js";
import { blankTable } from "../utils/tableHelpers.js";

vi.mock("../lib/supabaseClient.js", async () => {
  const h = await import("./harness/fakeBackend.js");
  return {
    TABLES: {
      SERVICE_TABLES: "service_tables", SERVICE_SETTINGS: "service_settings",
      SERVICE_ARCHIVE: "service_archive", MENU_COURSES: "menu_courses",
      WINES: "wines", BEVERAGES: "beverages", RESERVATIONS: "reservations",
    },
    hasSupabaseConfig: true,
    supabase: h.fakeSupabase,
    supabaseUrl: "https://fake.supabase.test",
    getWorkspaceId: h.getWorkspaceId,
    setWorkspaceId: h.setWorkspaceId,
    getRememberMe: () => true,
    setRememberMe: () => {},
  };
});
vi.mock("../powersync/config.js", async () => ({ ...(await import("./harness/fakeBackend.js")).fakeConfig, __fake: true }));
vi.mock("../powersync/system.js", async () => ({ ...(await import("./harness/fakeBackend.js")).fakeSystem, __fake: true }));
vi.mock("../powersync/reads.js", async () => ({ ...(await import("./harness/fakeBackend.js")).fakeReads, __fake: true }));
vi.mock("../powersync/writes.js", async () => ({ ...(await import("./harness/fakeBackend.js")).fakeWrites, __fake: true }));
vi.mock("../powersync/watch.js", async () => ({ ...(await import("./harness/fakeBackend.js")).fakeWatch, __fake: true }));
vi.mock("../lib/stateStore.js", async () => ({ ...(await import("./harness/fakeBackend.js")).fakeStateStore, __fake: true }));
vi.mock("../lib/archiveStore.js", async () => ({ ...(await import("./harness/fakeBackend.js")).fakeArchiveStore, __fake: true }));

import App from "../App.jsx";

// Prime the mock registry for the powersync modules that are only ever
// loaded via dynamic import() from lib/stateStore.js / lib/archiveStore.js.
// Without a static import of the mocked path in THIS file's graph, vitest
// resolves those runtime import() calls to the real modules and the
// SQLite-branch reads crash on the stubbed getPowerSync.
it("mock sanity: dynamic imports of the powersync modules resolve to the fakes", async () => {
  expect((await import("../powersync/reads.js")).__fake).toBe(true);
  expect((await import("../powersync/writes.js")).__fake).toBe(true);
  const seam = await import("../lib/stateStore.js");
  const { setSqlitePrimaryFlag } = await import("../powersync/primary.js");
  const h = await import("./harness/fakeBackend.js");
  h.resetBackend({ psMode: true });
  h.setWorkspaceId("ws-harness");
  setSqlitePrimaryFlag(true);
  const viaSeam = await seam.readStateKey("nothing-here");
  setSqlitePrimaryFlag(false);
  expect(viaSeam).toBe(null); // fake readSetting on an empty store — real one throws
});

// jsdom shims the board UI needs.
if (!window.ResizeObserver) {
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}
window.confirm = () => true;
window.scrollTo = () => {};
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView || (() => {});

const localISO = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const daysAgoISO = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return localISO(d); };

const TODAY = () => currentServiceDay();

// A live dinner: Anna seated on T1 (service content — sacrosanct), Bruno a
// reservation on T2 not yet seated (reconcile templates his table).
const seedLiveService = ({ serviceDate = TODAY(), boardUpdatedAt = new Date().toISOString() } = {}) => {
  const anna = {
    ...blankTable(1), active: true, arrivedAt: "19:43",
    resName: "Anna Harness", resTime: "19:30", guests: 2,
  };
  seed("service_settings", [{
    id: "service_date",
    state: { date: serviceDate, chosenOn: serviceDate, session: "dinner", startedAt: boardUpdatedAt },
    updated_at: boardUpdatedAt,
  }]);
  seed("service_tables", [{ table_id: 1, data: anna, updated_at: boardUpdatedAt }]);
  seed("reservations", [
    { id: "res-anna", date: serviceDate, table_id: 1, created_at: boardUpdatedAt,
      data: { resName: "Anna Harness", resTime: "19:30", guests: 2, tableGroup: [], service_session: "dinner" } },
    { id: "res-bruno", date: serviceDate, table_id: 2, created_at: boardUpdatedAt,
      data: { resName: "Bruno Harness", resTime: "20:15", guests: 3, tableGroup: [], service_session: "dinner" } },
  ]);
};

const enterService = async () => {
  fireEvent.click(await screen.findByText("[Service]", {}, { timeout: 5000 }));
  await screen.findByText(/Anna Harness/, {}, { timeout: 5000 });
};

// Detail → CHANGE TABLE → T04 (free) — the real guest-switch flow.
const switchAnnaToT4 = async () => {
  fireEvent.click(await screen.findByText("Details", {}, { timeout: 5000 }));
  fireEvent.click(await screen.findByText("CHANGE TABLE"));
  const t4 = (await screen.findAllByText("T04"))
    .map((el) => el.closest("button")).find(Boolean);
  fireEvent.click(t4);
};

const rowFor = (rows, tableId) => rows.find((r) => Number(r.table_id) === Number(tableId));
const annaRowCount = (rows) => rows.filter((r) => r?.data?.resName === "Anna Harness").length;

describe.each([
  ["fallback", false],
  ["sqlite-primary", true],
])("app harness — %s mode", (modeName, psMode) => {
  beforeEach(() => {
    resetBackend({ psMode });
  });

  it("joins a live service mid-shift without prompting or wiping", async () => {
    seedLiveService();
    render(<App />);
    await enterService();

    // Joined, not restarted: the persisted service_date is untouched and the
    // seated table survived (no reconcile rebuild, no blank push).
    await waitFor(() => {
      const state = remoteRows("service_settings").find((r) => r.id === "service_date")?.state;
      expect(state?.date).toBe(TODAY());
      expect(annaRowCount(remoteRows("service_tables"))).toBe(1);
      expect(rowFor(remoteRows("service_tables"), 1)?.data?.active).toBe(true);
    }, { timeout: 5000 });
  });

  it("table switch repoints board rows AND the reservation through the store, with no bounce-back", async () => {
    seedLiveService();
    render(<App />);
    await enterService();
    await switchAnnaToT4();

    // The move must land in the store on BOTH surfaces: board rows (autosave →
    // persistBoardRows) and the owning reservation (persistReservationRow).
    await waitFor(() => {
      const tables = remoteRows("service_tables");
      expect(rowFor(tables, 4)?.data?.resName).toBe("Anna Harness");
      expect(rowFor(tables, 4)?.data?.active).toBe(true);
      expect(rowFor(tables, 1)?.data?.resName || "").toBe("");
      const resv = remoteRows("reservations").find((r) => r.id === "res-anna");
      expect(Number(resv?.table_id)).toBe(4);
      expect(annaRowCount(tables)).toBe(1);
    }, { timeout: 5000 });

    // Local-first contract (SQLite-primary): the repoint must be in the
    // on-device DB BEFORE any server echo — that's what makes it durable
    // offline and keeps the watch from reverting it. A direct Supabase write
    // (the PR #44 bug) leaves the local row stale and fails here.
    if (psMode) {
      await waitFor(() => {
        expect(Number(localRows("reservations").find((r) => r.id === "res-anna")?.table_id)).toBe(4);
        expect(rowFor(localRows("service_tables"), 4)?.data?.resName).toBe("Anna Harness");
      }, { timeout: 5000 });
    }

    // Round-trip the store back through the app — the exact tick that used to
    // revert a seam-bypassing write and duplicate the guest (PR #44). On
    // SQLite-primary the sync stream echoes; on the fallback a wake refetch.
    if (psMode) await act(async () => { await syncDown(); });
    else await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    await new Promise((r) => setTimeout(r, 400)); // let any bounce autosave land

    const tables = remoteRows("service_tables");
    expect(annaRowCount(tables)).toBe(1);
    expect(rowFor(tables, 4)?.data?.resName).toBe("Anna Harness");
    expect(rowFor(tables, 1)?.data?.resName || "").toBe("");
    expect(Number(remoteRows("reservations").find((r) => r.id === "res-anna")?.table_id)).toBe(4);
    if (psMode) {
      expect(annaRowCount(localRows("service_tables"))).toBe(1);
      expect(Number(localRows("reservations").find((r) => r.id === "res-anna")?.table_id)).toBe(4);
    }
  });

  it("stale service_date over a LIVE board re-dates forward and keeps the board (04.07 incident)", async () => {
    // The board's seated activity is from TODAY, but the persisted date lags
    // two days behind (a woken tablet / mislabeled service). Auto-end must
    // heal the date, not archive-and-clear a running dinner.
    seedLiveService({ serviceDate: daysAgoISO(2), boardUpdatedAt: new Date().toISOString() });
    render(<App />);

    await waitFor(() => {
      const state = remoteRows("service_settings").find((r) => r.id === "service_date")?.state;
      expect(state?.date).toBe(TODAY());
    }, { timeout: 5000 });

    // Board kept, nothing filed: the dinner goes on.
    expect(remoteRows("service_archive")).toHaveLength(0);
    const t1 = rowFor(remoteRows("service_tables"), 1);
    expect(t1?.data?.resName).toBe("Anna Harness");
    expect(t1?.data?.active).toBe(true);

    // And the healed service is joinable.
    await enterService();
  });

  it("genuine overnight leftover archives FIRST, then clears the board", async () => {
    // Same stale date, but the board's last activity is ALSO two days old —
    // an abandoned service. Auto-end files it and resets for the new day.
    // Also pins the mass-blank guard's flagged pass-through: the whole-board
    // blank must NOT trip the '[board-guard]' refusal — a guard regression
    // that refuses a legitimate end-of-service would be a worse incident than
    // the wipe it exists to prevent. (The refusal branch itself is pinned at
    // unit level in boardGuard.test.js — it is unreachable through honest UI
    // vectors by design.)
    const errSpy = vi.spyOn(console, "error");
    const stale = daysAgoISO(2);
    seedLiveService({ serviceDate: stale, boardUpdatedAt: `${stale}T21:00:00.000Z` });
    render(<App />);

    await waitFor(() => {
      const archives = remoteRows("service_archive");
      expect(archives).toHaveLength(1);
      expect(archives[0].label).toMatch(/DINNER/);
      expect(archives[0].state?.autoEnded).toBe(true);
      expect(archives[0].state?.tables?.some((t) => t.resName === "Anna Harness")).toBe(true);
    }, { timeout: 5000 });

    await waitFor(() => {
      // Board cleared in the store (data blanked), date released.
      expect(annaRowCount(remoteRows("service_tables"))).toBe(0);
      const state = remoteRows("service_settings").find((r) => r.id === "service_date")?.state;
      expect(state?.date).toBeUndefined();
    }, { timeout: 5000 });

    const guardRefusals = errSpy.mock.calls.filter((args) => String(args[0]).includes("[board-guard]"));
    expect(guardRefusals).toHaveLength(0);
    errSpy.mockRestore();
  });

  it("offline edits survive and converge to the store after reconnect", async () => {
    seedLiveService();
    render(<App />);
    await enterService();

    // Go offline (mode-appropriate), then switch Anna T1 → T4 while down.
    if (psMode) backend.connectorDown = true;
    else backend.failRemoteWrites = true;
    await switchAnnaToT4();

    if (psMode) {
      // Local-first: the SQLite store has the move immediately; the server
      // hasn't seen it yet (upload queued).
      await waitFor(() => {
        expect(rowFor(localRows("service_tables"), 4)?.data?.resName).toBe("Anna Harness");
        expect(Number(localRows("reservations").find((r) => r.id === "res-anna")?.table_id)).toBe(4);
      }, { timeout: 5000 });
      expect(rowFor(remoteRows("service_tables"), 1)?.data?.resName).toBe("Anna Harness");
      expect(backend.uploadQueue.length).toBeGreaterThan(0);

      // Reconnect: the queue drains and the server converges.
      await act(async () => { await drainUploads(); });
      await waitFor(() => {
        const tables = remoteRows("service_tables");
        expect(rowFor(tables, 4)?.data?.resName).toBe("Anna Harness");
        expect(rowFor(tables, 1)?.data?.resName || "").toBe("");
        expect(annaRowCount(tables)).toBe(1);
        expect(Number(remoteRows("reservations").find((r) => r.id === "res-anna")?.table_id)).toBe(4);
      }, { timeout: 5000 });
    } else {
      // Fallback: the autosave retries 4× (~3 s) then re-queues the rows so a
      // later flush can still deliver them — nothing is silently dropped.
      await new Promise((r) => setTimeout(r, 3600));
      expect(rowFor(remoteRows("service_tables"), 4)?.data?.resName ?? "").toBe("");

      // Reconnect, then make any next edit: seating Bruno flushes the pending
      // map, carrying the offline switch along with it.
      backend.failRemoteWrites = false;
      fireEvent.click(await screen.findByText("← TABLES"));
      fireEvent.click(await screen.findByText("SEAT", {}, { timeout: 5000 }));

      await waitFor(() => {
        const tables = remoteRows("service_tables");
        expect(rowFor(tables, 4)?.data?.resName).toBe("Anna Harness");
        expect(rowFor(tables, 1)?.data?.resName || "").toBe("");
        expect(rowFor(tables, 2)?.data?.active).toBe(true); // Bruno seated
        expect(annaRowCount(tables)).toBe(1);
      }, { timeout: 6000 });
    }
  }, 20000);
});

// ── Failed-write survival (the wifi-extender lag-out incident) ────────────────
// The kitchen display ran on the direct-Supabase fallback over a laggy wifi
// extender: every upsert failed, yet reads/realtime kept flowing (seat presses
// from other devices still arrived). Each incoming event refetched the board,
// and the refetch ADOPTED the stale store row — erasing the local press and its
// timing as if the click never happened, because the diff baseline had been
// advanced at queue time and the reconciler saw "nothing unsaved". These pins
// hold the fix: an unconfirmed write must survive any refetch (folding in the
// other device's fields), and must drain on its own once the network returns —
// no follow-up edit required.
describe("app harness — fallback mode: failed writes survive refetches", () => {
  beforeEach(() => {
    resetBackend({ psMode: false });
  });

  it("an edit whose save failed survives a newer stale refetch and drains on 'online' (wifi-extender incident)", async () => {
    seedLiveService();
    render(<App />);
    await enterService();

    // Bruno's reservation templates T2 and the autosave persists it — wait for
    // that write to land so the confirmed baseline holds the pre-seat state.
    await waitFor(() => {
      expect(rowFor(remoteRows("service_tables"), 2)?.data?.resName).toBe("Bruno Harness");
    }, { timeout: 5000 });

    // Writes die; reads and realtime stay up (exactly the lag-out shape).
    backend.failRemoteWrites = true;

    // Seat Bruno — paints immediately, but every upsert attempt fails.
    fireEvent.click(await screen.findByText("SEAT", {}, { timeout: 5000 }));
    await new Promise((r) => setTimeout(r, 3600)); // all 4 attempts exhausted
    expect(rowFor(remoteRows("service_tables"), 2)?.data?.active).not.toBe(true);
    await screen.findByText("ERROR", {}, { timeout: 5000 }); // header chip

    // Another device now writes the SAME table with a NEWER stamp but WITHOUT
    // the seat (it never received it), plus its own new field. The realtime
    // event triggers a board refetch on this device.
    const t2 = rowFor(remoteRows("service_tables"), 2);
    t2.data = { ...t2.data, notes: "candles at 21:00" };
    t2.updated_at = new Date(Date.now() + 2000).toISOString();
    await act(async () => {
      emitRealtime("service_tables", { eventType: "UPDATE", new: t2, old: null });
    });
    await new Promise((r) => setTimeout(r, 400));

    // The unsaved seat SURVIVES the refetch — pre-fix it was wiped here (the
    // press and its timing vanished, SEAT reappeared).
    expect(screen.queryByText("SEAT")).toBeNull();

    // Network returns: the pending write drains WITHOUT any further edit
    // (pre-fix it sat re-queued until the next local tap), and the store
    // converges to BOTH devices' edits — ours seated, theirs folded in.
    backend.failRemoteWrites = false;
    await act(async () => { window.dispatchEvent(new Event("online")); });
    await waitFor(() => {
      const row = rowFor(remoteRows("service_tables"), 2);
      expect(row?.data?.active).toBe(true);                 // this device's seat
      expect(row?.data?.notes).toBe("candles at 21:00");    // other device's edit
    }, { timeout: 6000 });
    await screen.findByText("SYNC", {}, { timeout: 5000 }); // chip recovered
  }, 25000);
});

// ── Terrace flow: SEAT is the universal escape hatch ──────────────────────────
// A party marked 'terrace' must never dead-end: seating its dining table by
// hand completes the terrace visit (10.07 report: cleared terrace party stuck
// "ON TERRACE" — unseatable, ghost ticket on the kitchen board).
describe("app harness — terrace party seated by hand completes the visit", () => {
  beforeEach(() => {
    resetBackend({ psMode: false });
  });

  it("SEAT on a terrace party's dining table moves the visit to 'dining' and drops the badge", async () => {
    seedLiveService();
    // Bruno's party is outside on terrace table T23, nothing fired yet.
    const bruno = remoteRows("reservations").find((r) => r.id === "res-bruno");
    bruno.data = { ...bruno.data, visit_state: "terrace", terrace_table: "T23" };

    render(<App />);
    await enterService();
    await screen.findByText(/ON TERRACE/, {}, { timeout: 5000 }); // the seed took

    // The guests walk inside and staff simply seat the table.
    fireEvent.click(await screen.findByText("SEAT", {}, { timeout: 5000 }));

    // The visit completes (single-tap move semantics) and persists...
    await waitFor(() => {
      const row = remoteRows("reservations").find((r) => r.id === "res-bruno");
      expect(row?.data?.visit_state).toBe("dining");
      expect(row?.data?.moved_at).toBeTruthy();
    }, { timeout: 5000 });
    // ...and the board card stops claiming they're outside.
    await waitFor(() => {
      expect(screen.queryByText(/ON TERRACE/)).toBeNull();
    }, { timeout: 5000 });
  }, 20000);
});

// ── Shared service lifecycle ──────────────────────────────────────────────────
// A service started or ended on ANY device applies everywhere, live. The
// adopting device never writes anything back (no archive, no clears) — the
// 08.07 phone kept showing a dead service all night because end-adoption
// didn't exist.
describe.each([
  ["fallback", false],
  ["sqlite-primary", true],
])("app harness — shared service lifecycle (%s)", (modeName, psMode) => {
  beforeEach(() => {
    resetBackend({ psMode });
  });

  it("a service ENDED on another device ends here too, with no duplicate archive", async () => {
    seedLiveService();
    render(<App />);
    await enterService();

    // Another device ENDs the service: archives (its job), blanks the board,
    // releases the date — all remotely.
    const stamp = new Date(Date.now() + 1500).toISOString();
    const dateRow = remoteRows("service_settings").find((r) => r.id === "service_date");
    dateRow.state = {};
    dateRow.updated_at = stamp;
    remoteRows("service_tables").forEach((r) => { r.data = {}; r.updated_at = stamp; });

    if (psMode) {
      await act(async () => { await syncDown(); });
    } else {
      await act(async () => {
        emitRealtime("service_settings", { eventType: "UPDATE", new: { ...dateRow }, old: null });
      });
    }

    // This device leaves the live view and returns to mode selection…
    await screen.findByText("[Service]", {}, { timeout: 5000 });
    // …WITHOUT filing its own archive or resurrecting the date.
    expect(remoteRows("service_archive")).toHaveLength(0);
    expect(localStorage.getItem(`milka_service_date:${WORKSPACE_ID}`)).toBeNull();
  }, 15000);

  it("a service STARTED on another device is adopted here — Service joins with no prompt", async () => {
    // Reservations exist, but nobody has started a service yet.
    seed("reservations", [
      { id: "res-anna", date: TODAY(), table_id: 1, created_at: new Date().toISOString(),
        data: { resName: "Anna Harness", resTime: "19:30", guests: 2, tableGroup: [], service_session: "dinner" } },
    ]);
    render(<App />);
    await screen.findByText("[Service]", {}, { timeout: 5000 });

    // Another device starts tonight's dinner.
    const stamp = new Date(Date.now() + 1500).toISOString();
    const row = {
      workspace_id: WORKSPACE_ID, id: "service_date",
      state: { date: TODAY(), chosenOn: TODAY(), session: "dinner", startedAt: stamp },
      updated_at: stamp,
    };
    remoteRows("service_settings").push({ ...row });
    if (psMode) {
      await act(async () => { await syncDown(); });
    } else {
      await act(async () => {
        emitRealtime("service_settings", { eventType: "UPDATE", new: { ...row }, old: null });
      });
    }

    // The live day is adopted without entering service…
    await waitFor(() => expect(localStorage.getItem(`milka_service_date:${WORKSPACE_ID}`)).toBe(TODAY()), { timeout: 5000 });
    // …and tapping [Service] drops straight into the live board (no start prompt).
    fireEvent.click(screen.getByText("[Service]"));
    await screen.findByText(/Anna Harness/, {}, { timeout: 5000 });
  }, 15000);
});

// ── Stale-device END cannot wipe a newer service ─────────────────────────────
// The store-side finish clear used to be unconditional: a device that slept
// through "D1 ended, D2 started" and then ended "its" D1 blanked D2's fresh
// board for everyone. The pre-check + identity-guarded finish refuse it and
// adopt the store's reality instead.
describe("app harness — stale END cannot clear a newer service (fallback)", () => {
  beforeEach(() => {
    resetBackend({ psMode: false });
  });

  it("END SERVICE on a stale device is refused; the new service's board survives", async () => {
    seedLiveService();
    render(<App />);
    await enterService();

    // Elsewhere: the service is ended AND a fresh one started — new startedAt,
    // new guest on T1. This device gets NO realtime event (it is stale).
    const stamp = new Date(Date.now() + 1500).toISOString();
    const dateRow = remoteRows("service_settings").find((r) => r.id === "service_date");
    dateRow.state = { date: TODAY(), chosenOn: TODAY(), session: "dinner", startedAt: stamp };
    dateRow.updated_at = stamp;
    const t1 = remoteRows("service_tables").find((r) => Number(r.table_id) === 1);
    t1.data = { ...blankTable(1), active: true, arrivedAt: "12:05", resName: "Fresh Service Guest", guests: 2 };
    t1.updated_at = stamp;

    const alerts = [];
    window.alert = (msg) => alerts.push(String(msg));
    fireEvent.click(screen.getByText("END SERVICE"));
    await waitFor(() => expect(alerts.length).toBeGreaterThan(0), { timeout: 5000 });
    expect(alerts[0]).toMatch(/already ended|new one started/i);

    // Nothing was cleared or filed: the fresh service is intact.
    const row = remoteRows("service_tables").find((r) => Number(r.table_id) === 1);
    expect(row.data.resName).toBe("Fresh Service Guest");
    expect(row.data.active).toBe(true);
    expect(remoteRows("service_archive")).toHaveLength(0);
    expect(remoteRows("service_settings").find((r) => r.id === "service_date").state.startedAt).toBe(stamp);
  }, 20000);
});

// ── Floor SET markers sync live ───────────────────────────────────────────────
// floor_status_v1 was boot-read only until 11.07: a SET marker tapped on one
// tablet reached the store but no other device until a full reload. It now
// rides the live settings adoption on both storage modes.
describe.each([
  ["fallback", false],
  ["sqlite-primary", true],
])("app harness — floor SET markers sync live (%s)", (modeName, psMode) => {
  beforeEach(() => {
    resetBackend({ psMode });
  });

  it("a SET strip written on another device appears here without a reload", async () => {
    seedLiveService();
    render(<App />);
    await enterService();

    // Another device marks dining T4 as SET.
    const stamp = new Date(Date.now() + 1500).toISOString();
    const row = {
      workspace_id: WORKSPACE_ID, id: "floor_status_v1",
      state: { dining_a: { T4: "SET" } }, updated_at: stamp,
    };
    remoteRows("service_settings").push({ ...row });
    if (psMode) {
      await act(async () => { await syncDown(); });
    } else {
      await act(async () => {
        emitRealtime("service_settings", { eventType: "UPDATE", new: { ...row }, old: null });
      });
    }

    // Switch to the dining-room view — the strip is already adopted (the
    // ticker counts it), no reload involved.
    fireEvent.click(await screen.findByText("dining room", {}, { timeout: 5000 }));
    await waitFor(() => {
      expect(document.body.textContent).toContain("SET 1");
    }, { timeout: 5000 });
  }, 20000);
});

// ── Workspace-qualified local rows ────────────────────────────────────────────
// A legitimate multi-workspace membership can sync more than one restaurant.
// Local ids and every read are workspace-scoped, so those rows may coexist
// without a destructive wipe or cross-restaurant paint.
describe("app harness — workspace-qualified local rows", () => {
  beforeEach(() => {
    resetBackend({ psMode: true });
  });

  it("another workspace's rows coexist without a wipe or leaking into the active board", async () => {
    seedLiveService();
    localRows("service_tables").push({
      workspace_id: "ws-other", table_id: 1,
      data: { resName: "Ghost Of Admin" }, updated_at: new Date().toISOString(),
    });
    render(<App />);
    await enterService();

    expect(backend.clearResyncs).toBe(0);
    expect(screen.queryByText(/Ghost Of Admin/)).toBeNull();
    expect(localRows("service_tables").some((r) => r.workspace_id === "ws-other")).toBe(true);

    // The active workspace is still SQLite-primary and local-first.
    fireEvent.click(await screen.findByText("SEAT", {}, { timeout: 5000 }));
    await waitFor(() => {
      expect(rowFor(localRows("service_tables"), 2)?.data?.active).toBe(true);
    }, { timeout: 5000 });
  }, 20000);
});

// ── Fallback realtime safety net ──────────────────────────────────────────────
// A PowerSync outage or deliberately disabled deployment uses the
// direct-Supabase fallback. Its
// liveness is the Supabase realtime channels: without them the app is a static
// snapshot — cross-device edits and freshly added reservations never appear
// (the 07.07 "nothing syncs / my reservation is invisible" incident).
describe("app harness — fallback realtime safety net", () => {
  beforeEach(() => {
    resetBackend({ psMode: false });
  });

  it("realtime events keep the board and planner live on the fallback path", async () => {
    seedLiveService();
    render(<App />);
    await enterService();

    // The channels subscribe once the store decision resolves to fallback.
    await waitFor(() => expect(subscribedChannelCount()).toBeGreaterThan(0), { timeout: 5000 });

    // Another device adds a reservation for tonight → INSERT event arrives.
    // This device's reconcile must template her table without any reload.
    const carla = {
      id: "res-carla", workspace_id: WORKSPACE_ID, date: TODAY(), table_id: 5,
      created_at: new Date().toISOString(),
      data: { resName: "Carla Livewire", resTime: "21:00", guests: 2, tableGroup: [], service_session: "dinner" },
    };
    remoteRows("reservations").push(carla);
    await act(async () => {
      emitRealtime("reservations", { eventType: "INSERT", new: carla, old: null });
    });
    await waitFor(() => {
      expect(rowFor(remoteRows("service_tables"), 5)?.data?.resName).toBe("Carla Livewire");
    }, { timeout: 5000 });

    // Another device seats Bruno on T2 → UPDATE event triggers a board refetch
    // and the seated state paints here (active content — reconcile keeps it).
    const bruno = rowFor(remoteRows("service_tables"), 2) || {
      workspace_id: WORKSPACE_ID, table_id: 2, data: {}, updated_at: new Date().toISOString(),
    };
    bruno.data = { ...bruno.data, resName: "Bruno Livewire", active: true, arrivedAt: "20:17" };
    bruno.updated_at = new Date().toISOString();
    if (!rowFor(remoteRows("service_tables"), 2)) remoteRows("service_tables").push(bruno);
    await act(async () => {
      emitRealtime("service_tables", { eventType: "UPDATE", new: bruno, old: null });
    });
    await screen.findByText(/Bruno Livewire/, {}, { timeout: 5000 });

    // A LATE echo carrying an OLDER updated_at than this device's own write
    // for the table must be dropped, not adopted — adopting it flashed the
    // previous option until the newer echo landed (the rapid-tap flicker).
    const stale = {
      ...bruno,
      data: { ...bruno.data, resName: "Bruno Stale" },
      updated_at: new Date(Date.now() - 3600_000).toISOString(),
    };
    await act(async () => {
      emitRealtime("service_tables", { eventType: "UPDATE", new: stale, old: null });
    });
    await new Promise((r) => setTimeout(r, 300));
    expect(screen.queryByText(/Bruno Stale/)).toBeNull();
    await screen.findByText(/Bruno Livewire/, {}, { timeout: 5000 });

    // The other device deletes Carla's reservation → DELETE event; reconcile
    // ghost-clears her still-reserved table.
    const resv = remoteRows("reservations");
    resv.splice(resv.findIndex((r) => r.id === "res-carla"), 1);
    await act(async () => {
      emitRealtime("reservations", { eventType: "DELETE", new: null, old: { id: "res-carla" } });
    });
    await waitFor(() => {
      expect(rowFor(remoteRows("service_tables"), 5)?.data?.resName || "").toBe("");
    }, { timeout: 5000 });
  }, 20000);
});
