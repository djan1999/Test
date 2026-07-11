// ── App harness: END SERVICE against an identity-less service state ──────────
//
// The 11.07 production incident: the shared service_date state was an
// identity-less blob — {date, chosenOn}, no startedAt, no session (written by
// the orphan-heal path) — while the tablet still held the startedAt it had
// kept from an EARLIER service in localStorage. The guarded end compared that
// stale stamp against the store's missing one, refused ("This service was
// already ended on another device"), and adoption had nothing to adopt — so
// END SERVICE was refused all night while the board kept showing the whole
// service, every ticket already archived on the kitchen display.
//
// Pinned here through the real App, in both storage modes:
//   1. The production state ends cleanly: the stale local stamp is dropped at
//      boot (never presented as the live service's identity), the store-side
//      guard treats a startedAt-less state as date-checked, and the archive is
//      filed under a FRESH id — NOT the stale stamp's deterministic id, which
//      would have collided with the earlier night's archive and silently
//      dropped tonight's ("on conflict do nothing").
//   2. healOrphanedService writes a FULL identity (date, chosenOn, session,
//      startedAt) — the identity-less blob is what created the trap.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import {
  backend, resetBackend, seed, remoteRows, localRows,
  WORKSPACE_ID, setWorkspaceId,
} from "./harness/fakeBackend.js";
import { currentServiceDay, SERVICE_DATE_CHOSEN_ON_KEY } from "../utils/serviceDay.js";
import { blankTable } from "../utils/tableHelpers.js";
import { archiveIdForService } from "../utils/archiveIdentity.js";

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

// The startedAt this tablet kept from an EARLIER service (localStorage
// survives ends that happen on other devices).
const STALE_STARTED_AT = "2026-07-10T18:00:00.000Z";

const rowFor = (rows, tableId) => rows.find((r) => Number(r.table_id) === Number(tableId));

// The exact production board: the whole dinner seated and fired, every ticket
// already archived on the kitchen display.
const seedFinishedNight = () => {
  const now = new Date().toISOString();
  const fired = { amuse: { firedAt: "21:10" }, venison: { firedAt: "21:40" } };
  seed("service_tables", [
    { table_id: 2, data: { ...blankTable(2), active: true, arrivedAt: "19:07", resName: "Anna Harness", resTime: "19:00", guests: 3, kitchenLog: fired, kitchenArchived: true }, updated_at: now },
    { table_id: 4, data: { ...blankTable(4), active: true, arrivedAt: "17:54", resName: "Marco Harness", resTime: "18:00", guests: 2, kitchenLog: fired, kitchenArchived: true }, updated_at: now },
  ]);
  seed("reservations", [
    { id: "res-anna", date: TODAY(), table_id: 2, created_at: now,
      data: { resName: "Anna Harness", resTime: "19:00", guests: 3, tableGroup: [], service_session: "dinner" } },
    { id: "res-marco", date: TODAY(), table_id: 4, created_at: now,
      data: { resName: "Marco Harness", resTime: "18:00", guests: 2, tableGroup: [], service_session: "dinner" } },
  ]);
};

describe.each([
  ["fallback", false],
  ["sqlite-primary", true],
])("app harness — identity-less service state still ends (%s)", (modeName, psMode) => {
  beforeEach(() => {
    resetBackend({ psMode });
  });

  it("END SERVICE archives and clears when the store state has no startedAt and the device holds a stale one (11.07 incident)", async () => {
    // The store's live state is the identity-less production blob.
    seed("service_settings", [{
      id: "service_date",
      state: { date: TODAY(), chosenOn: TODAY() }, // no session, no startedAt
      updated_at: new Date().toISOString(),
    }]);
    seedFinishedNight();

    // An earlier night's archive already sits under the STALE stamp's
    // deterministic id — tonight's archive must not collide with it.
    const staleId = await archiveIdForService(WORKSPACE_ID, STALE_STARTED_AT);
    seed("service_archive", [{
      id: staleId, date: "2026-07-10", label: "10. 07. 2026 – DINNER",
      state: { tables: [], startedAt: STALE_STARTED_AT }, created_at: "2026-07-10T22:00:00.000Z", deleted_at: null,
    }]);

    // This tablet was mid-service before the reload: workspace known, today's
    // date restored from localStorage, and the stale stamp still in place.
    setWorkspaceId(WORKSPACE_ID);
    localStorage.setItem(`milka_service_date:${WORKSPACE_ID}`, TODAY());
    localStorage.setItem(`${SERVICE_DATE_CHOSEN_ON_KEY}:${WORKSPACE_ID}`, TODAY());
    localStorage.setItem(`milka_service_started_at:${WORKSPACE_ID}`, STALE_STARTED_AT);

    const alerts = [];
    window.alert = (msg) => alerts.push(String(msg));

    render(<App />);
    fireEvent.click(await screen.findByText("[Service]", {}, { timeout: 5000 }));
    await screen.findByText(/Anna Harness/, {}, { timeout: 5000 });

    fireEvent.click(screen.getByText("END SERVICE"));

    // The end goes through: back at mode selection, no refusal alert.
    await screen.findByText("[Service]", {}, { timeout: 5000 });
    expect(alerts).toEqual([]);

    // The night is FILED — under a fresh id, next to (not instead of) the
    // earlier night's archive.
    await waitFor(() => {
      const archives = remoteRows("service_archive");
      expect(archives).toHaveLength(2);
      const tonight = archives.find((a) => a.id !== staleId);
      expect(tonight.date).toBe(TODAY());
      expect(tonight.state?.tables?.some((t) => t.resName === "Anna Harness")).toBe(true);
      expect(tonight.state?.tables?.some((t) => t.resName === "Marco Harness")).toBe(true);
      // The stale stamp never names tonight's archive.
      expect(tonight.state?.startedAt ?? null).not.toBe(STALE_STARTED_AT);
    }, { timeout: 5000 });

    // Board blanked and date released in the store this device writes to.
    const store = psMode ? localRows : remoteRows;
    expect(store("service_tables").filter((r) => r?.data?.resName).length).toBe(0);
    expect(store("service_settings").find((r) => r.id === "service_date")?.state?.date).toBeUndefined();
    // The stale stamp is gone from this device, not re-presented next boot.
    expect(localStorage.getItem(`milka_service_started_at:${WORKSPACE_ID}`)).toBeNull();
  }, 30000);

  it("healOrphanedService re-attaches an orphaned live board with a FULL identity, and that service ends cleanly", async () => {
    // No service_date anywhere — but the board carries a live dinner (the
    // 19.06 orphan shape). The boot heal must write date+chosenOn+session+
    // startedAt: the identity-less blob it used to write is what deadlocked
    // the guarded end.
    seedFinishedNight();

    render(<App />);
    await screen.findByText("[Service]", {}, { timeout: 5000 });

    await waitFor(() => {
      const state = remoteRows("service_settings").find((r) => r.id === "service_date")?.state;
      expect(state?.date).toBe(TODAY());
      expect(state?.chosenOn).toBe(TODAY());
      expect(state?.session).toBeTruthy();
      expect(state?.startedAt).toBeTruthy();
    }, { timeout: 5000 });

    // The healed service is joinable and endable — the full loop closes.
    const alerts = [];
    window.alert = (msg) => alerts.push(String(msg));
    fireEvent.click(screen.getByText("[Service]"));
    await screen.findByText(/Anna Harness/, {}, { timeout: 5000 });
    fireEvent.click(screen.getByText("END SERVICE"));
    await screen.findByText("[Service]", {}, { timeout: 5000 });
    expect(alerts).toEqual([]);
    await waitFor(() => {
      const archives = remoteRows("service_archive");
      expect(archives).toHaveLength(1);
      expect(archives[0].state?.tables?.some((t) => t.resName === "Anna Harness")).toBe(true);
    }, { timeout: 5000 });
  }, 30000);
});
