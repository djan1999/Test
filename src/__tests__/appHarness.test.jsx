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
  backend, resetBackend, seed, seedService, remoteRows, localRows,
  drainUploads, syncDown, WORKSPACE_ID,
  emitRealtime, subscribedChannelCount,
} from "./harness/fakeBackend.js";
import { currentServiceDay } from "../utils/serviceDay.js";
import { blankTable } from "../utils/tableHelpers.js";

vi.mock("../lib/supabaseClient.js", async () => {
  const h = await import("./harness/fakeBackend.js");
  return {
    TABLES: {
      SERVICES: "services",
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

// A live dinner SERVICE ENTITY: Anna seated on T1 (service content —
// sacrosanct), Bruno a reservation on T2 not yet seated (reconcile templates
// his table). Returns the service id the board rows belong to.
const SVC = "svc-live";
const seedLiveService = ({ serviceDate = TODAY(), boardUpdatedAt = new Date().toISOString() } = {}) => {
  const anna = {
    ...blankTable(1), active: true, arrivedAt: "19:43",
    resName: "Anna Harness", resTime: "19:30", guests: 2,
  };
  seedService({ id: SVC, date: serviceDate, session: "dinner", startedAt: boardUpdatedAt });
  seed("service_tables", [{ service_id: SVC, table_id: 1, data: anna, updated_at: boardUpdatedAt }]);
  seed("reservations", [
    { id: "res-anna", date: serviceDate, table_id: 1, created_at: boardUpdatedAt,
      data: { resName: "Anna Harness", resTime: "19:30", guests: 2, tableGroup: [], service_session: "dinner" } },
    { id: "res-bruno", date: serviceDate, table_id: 2, created_at: boardUpdatedAt,
      data: { resName: "Bruno Harness", resTime: "20:15", guests: 3, tableGroup: [], service_session: "dinner" } },
  ]);
  return SVC;
};

const seedSeatlessCombinedService = () => {
  const now = new Date().toISOString();
  const grouped = (id) => ({
    ...blankTable(id),
    active: true,
    arrivedAt: "19:07",
    resName: "Seatless Group",
    resTime: "19:00",
    guests: 0,
    seats: [],
    tableGroup: [2, 3],
  });
  seedService({ id: SVC, date: TODAY(), session: "dinner", startedAt: now });
  seed("service_tables", [
    { service_id: SVC, table_id: 2, data: grouped(2), updated_at: now },
    { service_id: SVC, table_id: 3, data: grouped(3), updated_at: now },
  ]);
  seed("reservations", [{
    id: "res-seatless-group",
    date: TODAY(),
    table_id: 2,
    created_at: now,
    data: {
      resName: "Seatless Group", resTime: "19:00", guests: 5,
      tableGroup: [2, 3], service_session: "dinner",
    },
  }]);
};

const liveServiceRow = (rows = remoteRows("services")) =>
  rows.find((r) => r.status === "live") || null;

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

    // Joined, not restarted: the SAME service entity is still live and the
    // seated table survived (no new entity minted, no blank push).
    await waitFor(() => {
      const live = liveServiceRow();
      expect(live?.id).toBe(SVC);
      expect(live?.date).toBe(TODAY());
      expect(annaRowCount(remoteRows("service_tables"))).toBe(1);
      expect(rowFor(remoteRows("service_tables"), 1)?.data?.active).toBe(true);
    }, { timeout: 5000 });
  });

  it("unseats every row of a seatless combined table without the mass-blank guard restoring it", async () => {
    seedSeatlessCombinedService();
    render(<App />);
    fireEvent.click(await screen.findByText("[Service]", {}, { timeout: 5000 }));
    await screen.findByText("Seatless Group", {}, { timeout: 5000 });
    fireEvent.click(screen.getByText("Unseat"));

    const activeRows = () => (psMode ? localRows("service_tables") : remoteRows("service_tables"));
    await waitFor(() => {
      expect(rowFor(activeRows(), 2)?.data?.active).toBe(false);
      expect(rowFor(activeRows(), 3)?.data?.active).toBe(false);
    }, { timeout: 5000 });

    if (psMode) {
      await act(async () => { await drainUploads(); });
      expect(rowFor(remoteRows("service_tables"), 2)?.data?.active).toBe(false);
      expect(rowFor(remoteRows("service_tables"), 3)?.data?.active).toBe(false);
    }
  }, 20000);

  it("CLEAR TABLE on grouped T02-03 blanks both rows and remains cleared in the store", async () => {
    seedSeatlessCombinedService();
    render(<App />);
    fireEvent.click(await screen.findByText("[Service]", {}, { timeout: 5000 }));
    await screen.findByText("Seatless Group", {}, { timeout: 5000 });
    fireEvent.click(screen.getByText("Details"));
    fireEvent.click(await screen.findByText("CLEAR TABLE"));

    const activeRows = () => (psMode ? localRows("service_tables") : remoteRows("service_tables"));
    await waitFor(() => {
      expect(rowFor(activeRows(), 2)?.data?.resName || "").toBe("");
      expect(rowFor(activeRows(), 3)?.data?.resName || "").toBe("");
      const reservation = (psMode ? localRows("reservations") : remoteRows("reservations"))
        .find((row) => row.id === "res-seatless-group");
      expect(reservation?.data?.clearedFromBoard).toBe(true);
    }, { timeout: 5000 });

    if (psMode) await act(async () => { await drainUploads(); });
    await waitFor(() => {
      expect(rowFor(remoteRows("service_tables"), 2)?.data?.resName || "").toBe("");
      expect(rowFor(remoteRows("service_tables"), 3)?.data?.resName || "").toBe("");
      expect(remoteRows("reservations").find((row) => row.id === "res-seatless-group")?.data?.clearedFromBoard).toBe(true);
    }, { timeout: 5000 });
  }, 20000);

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

  it("stale service date over a LIVE board re-dates forward and keeps the board (04.07 incident)", async () => {
    // The board's activity is from TODAY, but the service's date lags two
    // days behind (a woken tablet / mislabeled service). Auto-end must heal
    // the date on the SAME entity, not end a running dinner.
    seedLiveService({ serviceDate: daysAgoISO(2), boardUpdatedAt: new Date().toISOString() });
    render(<App />);

    await waitFor(() => {
      const live = liveServiceRow();
      expect(live?.id).toBe(SVC);
      expect(live?.date).toBe(TODAY());
    }, { timeout: 5000 });

    // Board kept, nothing filed: the dinner goes on.
    expect(remoteRows("services").filter((r) => r.status === "ended")).toHaveLength(0);
    const t1 = rowFor(remoteRows("service_tables"), 1);
    expect(t1?.data?.resName).toBe("Anna Harness");
    expect(t1?.data?.active).toBe(true);

    // And the healed service is joinable.
    await enterService();
  });

  it("genuine overnight leftover is FILED (status flip) with every table row preserved", async () => {
    // Same stale date, but the board's last activity is ALSO two days old —
    // an abandoned service. Entity model: auto-end flips ITS row to 'ended'
    // and touches nothing else. The night's data is not copied-then-cleared;
    // it simply stays under the ended service, visible in the Archive.
    const errSpy = vi.spyOn(console, "error");
    const stale = daysAgoISO(2);
    seedLiveService({ serviceDate: stale, boardUpdatedAt: `${stale}T21:00:00.000Z` });
    render(<App />);

    await waitFor(() => {
      const svc = remoteRows("services").find((r) => r.id === SVC);
      expect(svc?.status).toBe("ended");
      expect(svc?.end_reason).toBe("rollover");
      expect(svc?.label).toMatch(/DINNER/);
    }, { timeout: 5000 });

    // THE point of the rework: the board rows still exist, untouched, under
    // the ended service — nothing was blanked anywhere.
    const t1 = rowFor(remoteRows("service_tables"), 1);
    expect(t1?.data?.resName).toBe("Anna Harness");
    expect(t1?.service_id).toBe(SVC);
    // No live service remains, so a fresh start prompts for today.
    expect(liveServiceRow()).toBe(null);

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
      // Fallback reservation batch failed: reverse the optimistic table move
      // so the board and reservation keep the same original assignment.
      await waitFor(() => {
        expect(rowFor(remoteRows("service_tables"), 1)?.data?.resName).toBe("Anna Harness");
        expect(Number(remoteRows("reservations").find((r) => r.id === "res-anna")?.table_id)).toBe(1);
      }, { timeout: 5000 });

      // Reconnect and retry the operator action explicitly; it now commits.
      backend.failRemoteWrites = false;
      const retryT4 = (await screen.findAllByText("T04"))
        .map((el) => el.closest("button")).find(Boolean);
      fireEvent.click(retryT4);

      await waitFor(() => {
        const tables = remoteRows("service_tables");
        expect(rowFor(tables, 4)?.data?.resName).toBe("Anna Harness");
        expect(rowFor(tables, 1)?.data?.resName || "").toBe("");
        expect(annaRowCount(tables)).toBe(1);
        expect(Number(remoteRows("reservations").find((r) => r.id === "res-anna")?.table_id)).toBe(4);
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

  it("a service ENDED on another device releases here too — its rows stay in the store", async () => {
    seedLiveService();
    render(<App />);
    await enterService();

    // Another device ENDs the service: ONE status flip on the entity row.
    // Nothing is blanked anywhere — that operation no longer exists.
    const stamp = new Date(Date.now() + 1500).toISOString();
    const svcRow = remoteRows("services").find((r) => r.id === SVC);
    svcRow.status = "ended";
    svcRow.ended_at = stamp;
    svcRow.end_reason = "manual";
    svcRow.updated_at = stamp;

    if (psMode) {
      await act(async () => { await syncDown(); });
    } else {
      await act(async () => {
        emitRealtime("services", { eventType: "UPDATE", new: { ...svcRow }, old: null });
      });
    }

    // This device leaves the live view and returns to mode selection…
    await screen.findByText("[Service]", {}, { timeout: 5000 });
    // …without writing anything: the ended service keeps every row, and the
    // local identity is released.
    expect(rowFor(remoteRows("service_tables"), 1)?.data?.resName).toBe("Anna Harness");
    expect(remoteRows("services").find((r) => r.id === SVC)?.status).toBe("ended");
    expect(localStorage.getItem(`milka_service_id:${WORKSPACE_ID}`)).toBeNull();
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

    // Another device starts tonight's dinner: one new services row.
    const stamp = new Date(Date.now() + 1500).toISOString();
    const row = {
      workspace_id: WORKSPACE_ID, id: "svc-elsewhere",
      date: TODAY(), session: "dinner", chosen_on: TODAY(),
      started_at: stamp, status: "live", ended_at: null, end_reason: null,
      label: null, snapshot: null, deleted_at: null, updated_at: stamp,
    };
    remoteRows("services").push({ ...row });
    if (psMode) {
      await act(async () => { await syncDown(); });
    } else {
      await act(async () => {
        emitRealtime("services", { eventType: "INSERT", new: { ...row }, old: null });
      });
    }

    // The live service is adopted without entering service…
    await waitFor(() => {
      expect(localStorage.getItem(`milka_service_id:${WORKSPACE_ID}`)).toBe("svc-elsewhere");
      expect(localStorage.getItem(`milka_service_date:${WORKSPACE_ID}`)).toBe(TODAY());
    }, { timeout: 5000 });
    // …and tapping [Service] drops straight into the live board (no start prompt).
    fireEvent.click(screen.getByText("[Service]"));
    await screen.findByText(/Anna Harness/, {}, { timeout: 5000 });
  }, 15000);
});

// ── Stale-device END cannot touch a newer service ────────────────────────────
// THE property the entity rework exists for. A device that slept through
// "D1 ended, D2 started" and then ends "its" D1 can only flip D1's own row —
// an idempotent no-op. D2 is a different row it has never heard of; there is
// no code path from a stale device to D2's board. (22.07 / 11.07 wipe class.)
describe("app harness — stale END cannot touch a newer service (fallback)", () => {
  beforeEach(() => {
    resetBackend({ psMode: false });
  });

  it("END SERVICE on a stale device flips only ITS service; the new service's board survives untouched", async () => {
    seedLiveService();
    render(<App />);
    await enterService();

    // Elsewhere: this service ends and a FRESH one starts with a new guest.
    // This device gets NO realtime event (it is stale).
    const stamp = new Date(Date.now() + 1500).toISOString();
    const oldSvc = remoteRows("services").find((r) => r.id === SVC);
    oldSvc.status = "ended"; oldSvc.ended_at = stamp; oldSvc.end_reason = "manual"; oldSvc.updated_at = stamp;
    remoteRows("services").push({
      workspace_id: WORKSPACE_ID, id: "svc-new", date: TODAY(), session: "dinner",
      chosen_on: TODAY(), started_at: stamp, status: "live",
      ended_at: null, end_reason: null, label: null, snapshot: null, deleted_at: null, updated_at: stamp,
    });
    remoteRows("service_tables").push({
      workspace_id: WORKSPACE_ID, service_id: "svc-new", table_id: 1,
      data: { ...blankTable(1), active: true, arrivedAt: "12:05", resName: "Fresh Service Guest", guests: 2 },
      updated_at: stamp,
    });

    window.confirm = () => true;
    fireEvent.click(screen.getByText("END SERVICE"));

    // The stale device released its (already ended) service and returned to
    // the mode picker — a graceful no-op, no alert dance required.
    await screen.findByText("[Service]", {}, { timeout: 5000 });

    // THE pin: the newer service and its board are byte-for-byte untouched,
    // and the old service's rows also survive (nothing blanks, ever).
    const freshRow = remoteRows("service_tables")
      .find((r) => r.service_id === "svc-new" && Number(r.table_id) === 1);
    expect(freshRow.data.resName).toBe("Fresh Service Guest");
    expect(freshRow.data.active).toBe(true);
    expect(remoteRows("services").find((r) => r.id === "svc-new")?.status).toBe("live");
    const oldRow = remoteRows("service_tables")
      .find((r) => r.service_id === SVC && Number(r.table_id) === 1);
    expect(oldRow?.data?.resName).toBe("Anna Harness");
  }, 20000);

  it("a Lunch started against a NEWER Dinner elsewhere loses the arbitration — the Dinner survives", async () => {
    seedLiveService();
    render(<App />);
    await enterService();

    // Elsewhere, Dinner already ended and a NEWER service started (its
    // started_at is in this device's future). This device receives no event.
    const newerStamp = new Date(Date.now() + 60_000).toISOString();
    const oldSvc = remoteRows("services").find((r) => r.id === SVC);
    oldSvc.status = "ended"; oldSvc.ended_at = newerStamp; oldSvc.end_reason = "manual"; oldSvc.updated_at = newerStamp;
    remoteRows("services").push({
      workspace_id: WORKSPACE_ID, id: "svc-newer-dinner", date: TODAY(), session: "dinner",
      chosen_on: TODAY(), started_at: newerStamp, status: "live",
      ended_at: null, end_reason: null, label: null, snapshot: null, deleted_at: null, updated_at: newerStamp,
    });
    remoteRows("service_tables").push({
      workspace_id: WORKSPACE_ID, service_id: "svc-newer-dinner", table_id: 1,
      data: { ...blankTable(1), active: true, arrivedAt: "12:05", resName: "Fresh Service Guest", guests: 2 },
      updated_at: newerStamp,
    });

    // Open the session picker from the live readout and start Lunch.
    window.confirm = () => true;
    fireEvent.click(screen.getByTitle("Click to switch lunch / dinner (opens the service picker)"));
    fireEvent.click(await screen.findByText("LUNCH", { selector: "button" }));
    fireEvent.click(screen.getByText(/^START LUNCH/));

    // The store trigger arbitrates: newest started_at wins, so the stale
    // device's Lunch is immediately superseded — NON-destructively — and the
    // device adopts the real live Dinner instead of believing its Lunch won.
    await waitFor(() => {
      const lunch = remoteRows("services").find((r) => r.session === "lunch");
      expect(lunch?.status).toBe("ended");
      expect(lunch?.end_reason).toBe("superseded");
      expect(remoteRows("services").find((r) => r.id === "svc-newer-dinner")?.status).toBe("live");
      expect(localStorage.getItem(`milka_service_id:${WORKSPACE_ID}`)).toBe("svc-newer-dinner");
    }, { timeout: 5000 });

    // The newer Dinner's board is untouched.
    const freshRow = remoteRows("service_tables")
      .find((r) => r.service_id === "svc-newer-dinner" && Number(r.table_id) === 1);
    expect(freshRow.data.resName).toBe("Fresh Service Guest");
    expect(freshRow.data.active).toBe(true);
  }, 20000);
});

// ── Floor SET markers sync live ───────────────────────────────────────────────
// The strips were boot-read only until 11.07: a SET marker tapped on one
// tablet reached the store but no other device until a full reload. They now
// ride the live settings adoption on both storage modes — under a
// PER-SERVICE key, so a stale device's strips can never touch a later service.
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

    // Another device marks dining T4 as SET (per-service floor key).
    const stamp = new Date(Date.now() + 1500).toISOString();
    const row = {
      workspace_id: WORKSPACE_ID, id: `floor_status_v2:${SVC}`,
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
