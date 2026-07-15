// ── App-level harness: KITCHEN board + terrace FLOOR view ─────────────────────
//
// The two surfaces where the 09.07/10.07 incidents lived were never driven
// through the real App in tests — the kitchen board (mode "display") and the
// FloorView (Service → floor toggle) only had isolated smoke tests, blind to
// seam routing, autosave persistence and the reconcile. These scenarios mount
// the REAL App against the in-memory backend (harness/fakeBackend.js) and
// walk the actual service flows:
//
//   1. Kitchen: ticket paints → fire persists to the store → Archive mis-tap
//      recovers from the kitchen's own ARCHIVED strip (F2) → a stale SET
//      banner self-heals (F3).
//   2. Floor/terrace: assign → CLEAR TABLE never dead-ends (heals 'booked'),
//      and a seated-inside party heals to 'dining' instead — never back into
//      the waiting pool (F4).

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import {
  backend, resetBackend, seed, remoteRows, WORKSPACE_ID, emitRealtime,
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

// jsdom shims the board UI needs.
if (!window.ResizeObserver) {
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}
window.confirm = () => true;
window.scrollTo = () => {};
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView || (() => {});

const TODAY = () => currentServiceDay();

// Two-course dinner in supabase row shape (App maps via supabaseRowToCourse).
const courseRow = (position, key, name) => ({
  position, course_key: key, is_active: true, is_snack: false,
  menu: { name, sub: "" }, optional_flag: "", course_category: "main",
});

const seedLiveService = ({ annaExtra = {} } = {}) => {
  const now = new Date().toISOString();
  const anna = {
    ...blankTable(1), active: true, arrivedAt: "19:43",
    resName: "Anna Harness", resTime: "19:30", guests: 2, ...annaExtra,
  };
  seed("service_settings", [{
    id: "service_date",
    state: { date: TODAY(), chosenOn: TODAY(), session: "dinner", startedAt: now },
    updated_at: now,
  }]);
  seed("service_tables", [{ table_id: 1, data: anna, updated_at: now }]);
  seed("reservations", [
    { id: "res-anna", date: TODAY(), table_id: 1, created_at: now,
      data: { resName: "Anna Harness", resTime: "19:30", guests: 2, tableGroup: [], service_session: "dinner" } },
    { id: "res-bruno", date: TODAY(), table_id: 2, created_at: now,
      data: { resName: "Bruno Harness", resTime: "20:15", guests: 3, tableGroup: [], service_session: "dinner" } },
  ]);
  seed("menu_courses", [courseRow(1, "amuse", "Amuse"), courseRow(2, "venison", "Venison")]);
};

const enterKitchen = async () => {
  fireEvent.click(await screen.findByText("[Kitchen]", {}, { timeout: 5000 }));
  await screen.findByText(/Anna Harness/, {}, { timeout: 5000 }); // T01's ticket
};

const enterService = async () => {
  fireEvent.click(await screen.findByText("[Service]", {}, { timeout: 5000 }));
  await screen.findByText(/Anna Harness/, {}, { timeout: 5000 });
};

const rowFor = (rows, tableId) => rows.find((r) => Number(r.table_id) === Number(tableId));
const resRow = (id) => remoteRows("reservations").find((r) => r.id === id);
const findSvgTable = (container, label) =>
  [...container.querySelectorAll("g")].find((g) => g.textContent.startsWith(label));

describe("app harness — kitchen board through the real App", () => {
  beforeEach(() => {
    resetBackend({ psMode: false });
  });

  it("fire persists to the store; an Archive mis-tap recovers from the kitchen's own strip", async () => {
    seedLiveService();
    render(<App />);
    await enterKitchen();

    // Fire both courses on Anna's ticket — each press must land in the store.
    fireEvent.click(await screen.findByText("Amuse", {}, { timeout: 5000 }));
    await waitFor(() => {
      expect(rowFor(remoteRows("service_tables"), 1)?.data?.kitchenLog?.amuse?.firedAt).toBeTruthy();
    }, { timeout: 5000 });
    fireEvent.click(screen.getByText("Venison"));
    await waitFor(() => {
      expect(rowFor(remoteRows("service_tables"), 1)?.data?.kitchenLog?.venison?.firedAt).toBeTruthy();
    }, { timeout: 5000 });

    // All fired → the done footer offers Archive. Mis-tap it.
    fireEvent.click(await screen.findByText("Archive", {}, { timeout: 5000 }));
    // The ticket leaves the grid but the party is still LIVE — the kitchen's
    // own ARCHIVED strip is the way back (pre-fix: only the END SERVICE
    // modal could restore, and only from the service side).
    fireEvent.click(await screen.findByText(/ARCHIVED \(1\)/, {}, { timeout: 5000 }));
    fireEvent.click(await screen.findByText("RESTORE", {}, { timeout: 5000 }));
    await waitFor(() => {
      expect(rowFor(remoteRows("service_tables"), 1)?.data?.kitchenArchived).toBe(false);
    }, { timeout: 5000 });
    await screen.findByText("Amuse", {}, { timeout: 5000 }); // ticket is back
  }, 25000);

  it("with no live service the kitchen idles on NO ACTIVE SERVICE — no board, no popups", async () => {
    // Nothing seeded: no service_date, blank board. The kitchen screen must
    // hold a plain "no active service" state until FOH starts the service.
    seed("menu_courses", [courseRow(1, "amuse", "Amuse")]);
    render(<App />);
    fireEvent.click(await screen.findByText("[Kitchen]", {}, { timeout: 5000 }));
    await screen.findByText("NO ACTIVE SERVICE", {}, { timeout: 5000 });
    expect(screen.queryByText("No active tables")).toBeNull();
    expect(screen.queryByText("TICKETS")).toBeNull();
  }, 20000);

  it("an unseated reservation shows as an upcoming banner in the ticket grid, not a ticket", async () => {
    seedLiveService();
    render(<App />);
    await enterKitchen();

    // Bruno (20:15, table 2) is booked but not seated — banner only.
    await screen.findByText("Bruno Harness", {}, { timeout: 5000 });
    expect(screen.getByText("20:15")).toBeTruthy();
    // Anna's seated ticket carries the courses; Bruno's banner must not.
    expect(screen.getAllByText("Amuse")).toHaveLength(1);
  }, 20000);

  it("kitchen view switch lives IN the header — TICKETS/TERRACE/DINING ROOM, no toggle row, no inner tabs (11.07)", async () => {
    seedLiveService();
    const { container } = render(<App />);
    await enterKitchen();

    // The old separate TICKETS/FLOOR row is gone (it cost a row of tickets
    // on the 720px panel); the switch sits next to the logo instead.
    expect(screen.queryByText("FLOOR")).toBeNull();
    expect(screen.getByText("tickets")).toBeTruthy();

    // TERRACE: one tap, straight to the terrace map — no inner tab bar.
    fireEvent.click(screen.getByText("terrace"));
    await waitFor(() => expect(findSvgTable(container, "T23")).toBeTruthy(), { timeout: 5000 });
    expect(screen.queryByText("TERRACE")).toBeNull(); // the old tab row

    // DINING ROOM: same, dining map.
    fireEvent.click(screen.getByText("dining room"));
    await waitFor(() => expect(findSvgTable(container, "T4")).toBeTruthy(), { timeout: 5000 });

    // Back to TICKETS: Anna's board returns.
    fireEvent.click(screen.getByText("tickets"));
    await screen.findByText("Amuse", {}, { timeout: 5000 });
  }, 25000);

  it("kitchen's OFFLINE seat + FOH seating the SAME table converge on reconnect — one row, no crash, nothing lost", async () => {
    // The double-seat collision the offline escape hatch makes possible:
    // wifi dies, the kitchen seats Bruno from the banner, and FOH — not
    // seeing the kitchen's seat — seats the same table on its own device.
    // When the link returns the two writes must merge into ONE seated table.
    seedLiveService();
    render(<App />);
    await enterKitchen();

    // Wait for Bruno's reservation template to be confirmed in the store, so
    // the offline seat is the only unsaved delta.
    await waitFor(() => {
      expect(rowFor(remoteRows("service_tables"), 2)?.data?.resName).toBe("Bruno Harness");
    }, { timeout: 5000 });

    // Wifi dies. The kitchen seats Bruno from the banner sheet — instant
    // locally, every upload attempt fails.
    backend.failRemoteWrites = true;
    fireEvent.click(await screen.findByText("Bruno Harness", {}, { timeout: 5000 }));
    fireEvent.click(await screen.findByText("SEAT TABLE", {}, { timeout: 5000 }));
    await waitFor(() => expect(screen.getAllByText("Amuse")).toHaveLength(2), { timeout: 5000 });
    await new Promise((r) => setTimeout(r, 3600)); // retries exhausted, write pending
    expect(rowFor(remoteRows("service_tables"), 2)?.data?.active).not.toBe(true);

    // FOH seats the same table on ITS device (newer stamp, its own arrival
    // minute) — the store takes FOH's write, the kitchen gets the echo.
    const t2 = rowFor(remoteRows("service_tables"), 2);
    t2.data = { ...t2.data, active: true, arrivedAt: "20:22" };
    t2.updated_at = new Date(Date.now() + 2000).toISOString();
    await new Promise((r) => setTimeout(r, 0));
    emitRealtime("service_tables", { eventType: "UPDATE", new: { ...t2 }, old: null });

    // Wifi returns: the kitchen's pending seat drains and MERGES with FOH's.
    backend.failRemoteWrites = false;
    window.dispatchEvent(new Event("online"));
    await waitFor(() => {
      const rows = remoteRows("service_tables").filter((r) => Number(r.table_id) === 2);
      expect(rows).toHaveLength(1);                 // same slot — never a duplicate
      expect(rows[0].data.active).toBe(true);       // seated once, for everyone
      expect(rows[0].data.resName).toBe("Bruno Harness");
      expect(typeof rows[0].data.arrivedAt).toBe("string"); // one device's minute won
    }, { timeout: 6000 });
    // The kitchen still shows exactly one Bruno ticket, courses intact.
    expect(screen.getAllByText("Bruno Harness")).toHaveLength(1);
    expect(screen.getAllByText("Amuse")).toHaveLength(2);
  }, 30000);

  it("tapping an upcoming banner opens the seat-only sheet; SEAT persists and expands the ticket (11.07)", async () => {
    // The kitchen must be able to seat an arrived party itself — with the
    // wifi down no other device's seat can reach the display, and its
    // local-first write drains once the link returns.
    seedLiveService();
    render(<App />);
    await enterKitchen();

    fireEvent.click(await screen.findByText("Bruno Harness", {}, { timeout: 5000 }));
    // The sheet is deliberately single-action: SEAT TABLE and nothing else.
    const seatBtn = await screen.findByText("SEAT TABLE", {}, { timeout: 5000 });
    expect(screen.queryByText("Slow")).toBeNull(); // no pace / extras / dietaries
    fireEvent.click(seatBtn);

    // The seat lands in the store and the banner expands into a full ticket
    // (Bruno's courses appear — two "Amuse" cells now, Anna's and Bruno's).
    await waitFor(() => {
      expect(rowFor(remoteRows("service_tables"), 2)?.data?.active).toBe(true);
    }, { timeout: 5000 });
    await waitFor(() => {
      expect(screen.getAllByText("Amuse")).toHaveLength(2);
    }, { timeout: 5000 });
    expect(screen.queryByText("SEAT TABLE")).toBeNull(); // sheet closed itself
  }, 25000);

  it("firing the SET course drops the floor SET strip by itself (no manual un-tap)", async () => {
    // FOH sent SET for Anna's next course (amuse): courseReady on the table,
    // SET strip on her dining tile. The strip must clear the moment the
    // kitchen fires that course — it used to persist until manually un-tapped
    // (and even across services).
    seedLiveService({
      annaExtra: { courseReady: { key: "amuse", index: 1, name: "Amuse", at: "19:45" } },
    });
    const now = new Date().toISOString();
    seed("service_settings", [{
      id: "floor_status_v1",
      state: { dining_a: { T1: "SET" } },
      updated_at: now,
    }]);
    render(<App />);
    await enterKitchen();

    fireEvent.click(await screen.findByText("Amuse", {}, { timeout: 5000 }));
    await waitFor(() => {
      expect(rowFor(remoteRows("service_tables"), 1)?.data?.courseReady).toBeNull();
    }, { timeout: 5000 });
    await waitFor(() => {
      const row = remoteRows("service_settings").find((r) => r.id === "floor_status_v1");
      expect(row?.state || {}).toEqual({});
    }, { timeout: 5000 });
  }, 25000);

  it("firing a course flagged 'clears terrace' auto-moves the party in and frees their terrace table", async () => {
    const now = new Date().toISOString();
    seed("service_settings", [{
      id: "service_date",
      state: { date: TODAY(), chosenOn: TODAY(), session: "dinner", startedAt: now },
      updated_at: now,
    }]);
    // Bruno's party is out on terrace T23; his dining table (2) is templated
    // but NOT seated — the kitchen ticket exists via the terrace decoration.
    seed("service_tables", [{
      table_id: 2,
      data: { ...blankTable(2), resName: "Bruno Harness", resTime: "20:15", guests: 3 },
      updated_at: now,
    }]);
    seed("reservations", [{
      id: "res-bruno", date: TODAY(), table_id: 2, created_at: now,
      data: { resName: "Bruno Harness", resTime: "20:15", guests: 3, tableGroup: [],
        service_session: "dinner", visit_state: "terrace", terrace_table: "T23" },
    }]);
    seed("menu_courses", [
      courseRow(1, "amuse", "Amuse"),
      { ...courseRow(2, "crayfish", "Crayfish"), is_last_bite: true },
    ]);
    render(<App />);
    fireEvent.click(await screen.findByText("[Kitchen]", {}, { timeout: 5000 }));
    await screen.findByText(/Bruno Harness/, {}, { timeout: 5000 }); // terrace ticket

    fireEvent.click(await screen.findByText("Crayfish", {}, { timeout: 5000 }));
    // The fire runs the MOVE: visit → arriving, terrace table freed.
    await waitFor(() => {
      expect(resRow("res-bruno")?.data?.visit_state).toBe("arriving");
    }, { timeout: 5000 });
    // Firing the OTHER course must not have been required — and an unflagged
    // fire alone (Amuse) would not have moved anyone: the flag did it.
  }, 25000);

  it("a stale SET banner (course key no longer on the menu) self-heals on the kitchen board", async () => {
    // The SET snapshot points at a course key that a mid-service menu edit
    // removed — fire() clears only on an exact key match, so this banner
    // could never be dismissed from the kitchen (it healed nowhere).
    seedLiveService({
      annaExtra: { courseReady: { key: "ghost_course", index: 9, name: "Ghost", at: "19:00" } },
    });
    render(<App />);
    await enterKitchen();

    await waitFor(() => {
      expect(rowFor(remoteRows("service_tables"), 1)?.data?.courseReady).toBeNull();
    }, { timeout: 5000 });
    expect(screen.queryByText(/SET FOR/)).toBeNull();
  }, 20000);
});

describe("app harness — terrace floor view through the real App", () => {
  beforeEach(() => {
    resetBackend({ psMode: false });
  });

  it("assign → CLEAR TABLE never dead-ends: an un-served party returns to the waiting pool", async () => {
    seedLiveService();
    const { container } = render(<App />);
    await enterService();

    // Service → TERRACE view, one tap (11.07 flattened toggle; default maps:
    // terrace T21–T26).
    fireEvent.click(screen.getByText("terrace"));

    // Free tile → sheet → assign Bruno. The write must ride the store seam.
    fireEvent.click(findSvgTable(container, "T23"));
    fireEvent.click(await screen.findByText(/^Bruno Harness ×3/, {}, { timeout: 5000 }));
    await waitFor(() => {
      expect(resRow("res-bruno")?.data).toMatchObject({ visit_state: "terrace", terrace_table: "T23" });
    }, { timeout: 5000 });

    // Occupied tile → CLEAR TABLE. Pre-fix this stranded the party in
    // 'terrace' with every exit gated off (the 10.07 stuck party).
    fireEvent.click(findSvgTable(container, "T23"));
    fireEvent.click(await screen.findByText("CLEAR TABLE", {}, { timeout: 5000 }));
    await waitFor(() => {
      const d = resRow("res-bruno")?.data;
      expect(d?.visit_state).toBe("booked");
      expect(d?.terrace_table).toBeNull();
    }, { timeout: 5000 });

    // ...and Bruno is back in the ASSIGN PARTY picker — no dead end.
    fireEvent.click(findSvgTable(container, "T24"));
    await screen.findByText(/^Bruno Harness ×3/, {}, { timeout: 5000 }); // exact case: the picker entry, never the uppercase assign flash
  }, 25000);

  it("the KITCHEN terrace can now seat/assign a waiting party (per Djan — a walk-in the kitchen sees first)", async () => {
    // Previously the kitchen floor was strictly read-only; a tap only opened
    // the restriction popover. It now shares the FOH assign flow so the
    // kitchen — whose local-first writes survive a Wi-Fi drop — can put a
    // walked-in party onto a terrace table itself.
    seedLiveService();
    const { container } = render(<App />);
    await enterKitchen();

    // Kitchen → TERRACE (header switch), then a free tile opens the sheet.
    fireEvent.click(screen.getByText("terrace"));
    await waitFor(() => expect(findSvgTable(container, "T23")).toBeTruthy(), { timeout: 5000 });
    fireEvent.click(findSvgTable(container, "T23"));
    fireEvent.click(await screen.findByText(/^Bruno Harness ×3/, {}, { timeout: 5000 }));

    // The assign rides the store seam exactly as the service floor's does.
    await waitFor(() => {
      expect(resRow("res-bruno")?.data).toMatchObject({ visit_state: "terrace", terrace_table: "T23" });
    }, { timeout: 5000 });

    // And the kitchen can change the party's table: CHANGE TABLE → tap a free
    // terrace tile re-seats them there.
    fireEvent.click(findSvgTable(container, "T23"));
    fireEvent.click(await screen.findByText("CHANGE TABLE", {}, { timeout: 5000 }));
    fireEvent.click(findSvgTable(container, "T24"));
    await waitFor(() => {
      expect(resRow("res-bruno")?.data?.terrace_table).toBe("T24");
    }, { timeout: 5000 });
  }, 25000);

  it("a party SEATED INSIDE whose tile is cleared heals to 'dining' — offered back as a marked RETURN, never as a waiting party", async () => {
    seedLiveService();
    const { container } = render(<App />);
    await enterService();

    // Seat Bruno's dining table first (dessert-outside shape: courses run
    // inside while the party sits on the terrace).
    fireEvent.click(await screen.findByText("SEAT", {}, { timeout: 5000 }));
    await waitFor(() => {
      expect(rowFor(remoteRows("service_tables"), 2)?.data?.active).toBe(true);
    }, { timeout: 5000 });

    fireEvent.click(screen.getByText("terrace"));
    fireEvent.click(findSvgTable(container, "T23"));
    fireEvent.click(await screen.findByText(/^Bruno Harness ×3/, {}, { timeout: 5000 }));
    await waitFor(() => {
      expect(resRow("res-bruno")?.data?.visit_state).toBe("terrace");
    }, { timeout: 5000 });

    fireEvent.click(findSvgTable(container, "T23"));
    fireEvent.click(await screen.findByText("CLEAR TABLE", {}, { timeout: 5000 }));
    await waitFor(() => {
      expect(resRow("res-bruno")?.data?.visit_state).toBe("dining"); // still eating inside
    }, { timeout: 5000 });

    // Offered back OUT for the last course (per Djan, 15.07) — but marked as
    // a RETURN with the party's dining table, never as a bare waiting party
    // (the double-seat hazard the old rule guarded stays covered by the mark).
    fireEvent.click(findSvgTable(container, "T24"));
    await screen.findByText("ASSIGN PARTY", {}, { timeout: 5000 });
    const entry = screen.getByText(/^Bruno Harness ×3/); // exact case: the uppercase assign FLASH may linger — only the picker entry matters
    expect(entry.textContent).toContain("↩");
    expect(entry.textContent).toContain("T2-3"); // his dining table, via the label fallback
    // and the return actually assigns: Bruno heads back outside
    fireEvent.click(entry);
    await waitFor(() => {
      expect(resRow("res-bruno")?.data?.visit_state).toBe("terrace");
      expect(resRow("res-bruno")?.data?.terrace_table).toBe("T24");
    }, { timeout: 5000 });
  }, 25000);
});
