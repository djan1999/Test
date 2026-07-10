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
  backend, resetBackend, seed, remoteRows, WORKSPACE_ID,
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

    // Service → FLOOR view → TERRACE tab (default maps: terrace T21–T26).
    fireEvent.click(screen.getByText("floor"));
    fireEvent.click(await screen.findByText("TERRACE", {}, { timeout: 5000 }));

    // Free tile → sheet → assign Bruno. The write must ride the store seam.
    fireEvent.click(findSvgTable(container, "T23"));
    fireEvent.click(await screen.findByText(/BRUNO HARNESS ×3|Bruno Harness ×3/i, {}, { timeout: 5000 }));
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
    await screen.findByText(/Bruno Harness ×3/i, {}, { timeout: 5000 });
  }, 25000);

  it("a party SEATED INSIDE whose tile is cleared heals to 'dining' — not back into the waiting pool", async () => {
    seedLiveService();
    const { container } = render(<App />);
    await enterService();

    // Seat Bruno's dining table first (dessert-outside shape: courses run
    // inside while the party sits on the terrace).
    fireEvent.click(await screen.findByText("SEAT", {}, { timeout: 5000 }));
    await waitFor(() => {
      expect(rowFor(remoteRows("service_tables"), 2)?.data?.active).toBe(true);
    }, { timeout: 5000 });

    fireEvent.click(screen.getByText("floor"));
    fireEvent.click(await screen.findByText("TERRACE", {}, { timeout: 5000 }));
    fireEvent.click(findSvgTable(container, "T23"));
    fireEvent.click(await screen.findByText(/Bruno Harness ×3/i, {}, { timeout: 5000 }));
    await waitFor(() => {
      expect(resRow("res-bruno")?.data?.visit_state).toBe("terrace");
    }, { timeout: 5000 });

    fireEvent.click(findSvgTable(container, "T23"));
    fireEvent.click(await screen.findByText("CLEAR TABLE", {}, { timeout: 5000 }));
    await waitFor(() => {
      expect(resRow("res-bruno")?.data?.visit_state).toBe("dining"); // still eating inside
    }, { timeout: 5000 });

    // NOT re-offered as a waiting party (the double-seat hazard).
    fireEvent.click(findSvgTable(container, "T24"));
    await screen.findByText("ASSIGN PARTY", {}, { timeout: 5000 });
    expect(screen.queryByText(/Bruno Harness ×3/i)).toBeNull();
  }, 25000);
});
