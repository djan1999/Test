// ── App harness: Test Service (sandbox) ─────────────────────────────────────
//
// The Admin "Start Test Service" button opens a fully-working service on a
// blank board that persists NOTHING. This drives the REAL App against the
// in-memory backend and proves the core guarantee: with a live service already
// on the board, entering the test blanks it LOCALLY yet writes nothing to the
// store, and ending the test restores the real service verbatim — the store
// untouched throughout (no board write, no service_date change, no archive).

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import {
  resetBackend, seed, remoteRows, localRows, WORKSPACE_ID,
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

if (!window.ResizeObserver) {
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}
window.confirm = () => true;
window.scrollTo = () => {};
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView || (() => {});

const TODAY = () => currentServiceDay();

// A live dinner already running: Anna seated on T1, one reservation, and an
// existing archive entry — all real data the test service must never touch.
const seedLiveService = () => {
  const now = new Date().toISOString();
  const anna = { ...blankTable(1), active: true, arrivedAt: "19:43", resName: "Anna Harness", resTime: "19:30", guests: 2 };
  seed("service_settings", [{
    id: "service_date",
    state: { date: TODAY(), chosenOn: TODAY(), session: "dinner", startedAt: now },
    updated_at: now,
  }]);
  seed("service_tables", [{ table_id: 1, data: anna, updated_at: now }]);
  seed("reservations", [
    { id: "res-anna", date: TODAY(), table_id: 1, created_at: now,
      data: { resName: "Anna Harness", resTime: "19:30", guests: 2, tableGroup: [], service_session: "dinner" } },
  ]);
  seed("service_archive", [{
    id: "arch-old", date: "2026-07-10", label: "10. 07. 2026 – DINNER",
    state: { tables: [] }, created_at: "2026-07-10T22:00:00.000Z", deleted_at: null,
  }]);
};

const snapshotStore = () => JSON.stringify({
  remoteTables: remoteRows("service_tables"),
  remoteSettings: remoteRows("service_settings"),
  remoteResv: remoteRows("reservations"),
  remoteArchive: remoteRows("service_archive"),
  localTables: localRows("service_tables"),
  localSettings: localRows("service_settings"),
  localResv: localRows("reservations"),
  localArchive: localRows("service_archive"),
});

const startTestFromAdmin = async () => {
  fireEvent.click(await screen.findByText("[Admin]", {}, { timeout: 5000 }));
  // Admin loads lazily; the section nav buttons label themselves via aria-label
  // (the visible child is just the icon glyph). Open System, start the test.
  const systemNav = await screen.findAllByLabelText("System", {}, { timeout: 5000 });
  fireEvent.click(systemNav[0]);
  fireEvent.click(await screen.findByText(/Start Test Service/i, {}, { timeout: 5000 }));
};

describe.each([
  ["fallback", false],
  ["sqlite-primary", true],
])("app harness — Test Service writes nothing (%s)", (modeName, psMode) => {
  beforeEach(() => {
    resetBackend({ psMode });
  });

  it("entering the test blanks the board locally but the real service survives in the store; ending restores it", async () => {
    seedLiveService();
    render(<App />);

    // Wait until the live service has actually loaded on this device.
    await screen.findByText("[Service]", {}, { timeout: 5000 });
    const before = snapshotStore();

    await startTestFromAdmin();

    // We're in the test service now: a blank board (Anna is NOT shown), and the
    // persistent banner tells the operator nothing is saved.
    await screen.findByText(/TEST SERVICE — nothing is saved/i, {}, { timeout: 5000 });
    await waitFor(() => {
      expect(screen.queryByText(/Anna Harness/)).toBeNull();
    }, { timeout: 5000 });

    // The store is byte-for-byte unchanged: the live board, the service_date,
    // and the archive are exactly as they were. Blanking a live board normally
    // triggers writes — the kill-switch suppressed every one.
    expect(snapshotStore()).toBe(before);

    // End the test → returns to Admin (where it was launched), store intact.
    fireEvent.click(await screen.findByText("END TEST", {}, { timeout: 5000 }));
    await waitFor(() => {
      expect(screen.queryByText(/TEST SERVICE — nothing is saved/i)).toBeNull();
    }, { timeout: 5000 });
    expect(snapshotStore()).toBe(before);

    // Leave Admin → mode screen → re-enter the live service: Anna is right
    // where she was, and the store was never touched.
    fireEvent.click(await screen.findByText("EXIT", {}, { timeout: 5000 }));
    fireEvent.click(await screen.findByText("[Service]", {}, { timeout: 5000 }));
    await screen.findByText(/Anna Harness/, {}, { timeout: 5000 });
    expect(snapshotStore()).toBe(before);
  }, 30000);
});
