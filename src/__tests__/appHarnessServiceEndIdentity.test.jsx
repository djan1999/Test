// ── App harness: END SERVICE in the service-entity model ─────────────────────
//
// The 11.07 production incident ("can't end service all night") came from the
// old identity-guard machinery: a stale startedAt stamp against an
// identity-less shared blob refused every END. In the entity model that whole
// machinery is GONE — ending is one idempotent status flip on the service's
// own row, so there is no identity to mismatch and no refusal path left.
//
// Pinned here through the real App, in both storage modes:
//   1. END SERVICE always completes: the entity flips to 'ended' with a
//      label, EVERY board row survives under it (nothing is copied, nothing
//      is blanked), and the device releases its local identity.
//   2. The archive view shows the ended service NEXT TO older legacy
//      service_archive snapshots — no deterministic-id collision can drop a
//      night, because nothing is inserted that could collide.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import {
  resetBackend, seed, seedService, remoteRows, localRows,
  WORKSPACE_ID, setWorkspaceId,
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

// jsdom shims the board UI needs.
if (!window.ResizeObserver) {
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}
window.confirm = () => true;
window.scrollTo = () => {};
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView || (() => {});

const TODAY = () => currentServiceDay();
const SVC = "svc-tonight";

const rowFor = (rows, tableId) => rows.find((r) => Number(r.table_id) === Number(tableId));

// The exact production board: the whole dinner seated and fired, every ticket
// already archived on the kitchen display.
const seedFinishedNight = () => {
  const now = new Date().toISOString();
  const fired = { amuse: { firedAt: "21:10" }, venison: { firedAt: "21:40" } };
  seedService({ id: SVC, date: TODAY(), session: "dinner", startedAt: now });
  seed("service_tables", [
    { service_id: SVC, table_id: 2, data: { ...blankTable(2), active: true, arrivedAt: "19:07", resName: "Anna Harness", resTime: "19:00", guests: 3, kitchenLog: fired, kitchenArchived: true }, updated_at: now },
    { service_id: SVC, table_id: 4, data: { ...blankTable(4), active: true, arrivedAt: "17:54", resName: "Marco Harness", resTime: "18:00", guests: 2, kitchenLog: fired, kitchenArchived: true }, updated_at: now },
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
])("app harness — END SERVICE files the entity, preserves every row (%s)", (modeName, psMode) => {
  beforeEach(() => {
    resetBackend({ psMode });
  });

  it("END SERVICE flips the entity, keeps the whole board in the store, and releases the device", async () => {
    seedFinishedNight();

    // This tablet was mid-service before a reload: identity cached locally.
    setWorkspaceId(WORKSPACE_ID);
    localStorage.setItem(`milka_service_id:${WORKSPACE_ID}`, SVC);
    localStorage.setItem(`milka_service_date:${WORKSPACE_ID}`, TODAY());
    localStorage.setItem(`milka_service_chosen_on:${WORKSPACE_ID}`, TODAY());

    const alerts = [];
    window.alert = (msg) => alerts.push(String(msg));

    render(<App />);
    fireEvent.click(await screen.findByText("[Service]", {}, { timeout: 5000 }));
    await screen.findByText(/Anna Harness/, {}, { timeout: 5000 });

    fireEvent.click(screen.getByText("END SERVICE"));

    // The end goes through: back at mode selection, no refusal alert — there
    // is no identity machinery left that could refuse it.
    await screen.findByText("[Service]", {}, { timeout: 5000 });
    expect(alerts).toEqual([]);

    // The night is FILED: the entity is ended and labeled…
    await waitFor(() => {
      const store = psMode ? localRows : remoteRows;
      const svc = store("services").find((r) => r.id === SVC);
      expect(svc?.status).toBe("ended");
      expect(svc?.end_reason).toBe("manual");
      expect(svc?.label).toMatch(/DINNER/);
    }, { timeout: 20000 });

    // …and EVERY board row survives under it, byte-for-byte. Nothing was
    // copied to an archive table and nothing was blanked — the ended service
    // IS the archive.
    const store = psMode ? localRows : remoteRows;
    expect(rowFor(store("service_tables"), 2)?.data?.resName).toBe("Anna Harness");
    expect(rowFor(store("service_tables"), 4)?.data?.resName).toBe("Marco Harness");
    expect(rowFor(store("service_tables"), 2)?.service_id).toBe(SVC);

    // The device released its local identity.
    expect(localStorage.getItem(`milka_service_id:${WORKSPACE_ID}`)).toBeNull();
    expect(localStorage.getItem(`milka_service_date:${WORKSPACE_ID}`)).toBeNull();
    expect(localStorage.getItem(`milka_service_started_at:${WORKSPACE_ID}`)).toBeNull();
  }, 45000);

  it("the ended service appears in the archive view NEXT TO older legacy snapshots", async () => {
    seedFinishedNight();
    // An earlier night's LEGACY archive row (pre-entity model).
    seed("service_archive", [{
      id: "legacy-10-07", date: "2026-07-10", label: "10. 07. 2026 – DINNER",
      state: { tables: [{ id: 1, resName: "Old Guest" }] },
      created_at: "2026-07-10T22:00:00.000Z", deleted_at: null,
    }]);

    setWorkspaceId(WORKSPACE_ID);
    localStorage.setItem(`milka_service_id:${WORKSPACE_ID}`, SVC);
    localStorage.setItem(`milka_service_date:${WORKSPACE_ID}`, TODAY());
    localStorage.setItem(`milka_service_chosen_on:${WORKSPACE_ID}`, TODAY());

    render(<App />);
    fireEvent.click(await screen.findByText("[Service]", {}, { timeout: 5000 }));
    await screen.findByText(/Anna Harness/, {}, { timeout: 5000 });
    fireEvent.click(screen.getByText("END SERVICE"));
    await screen.findByText("[Service]", {}, { timeout: 5000 });

    // Merged archive view: tonight's ended service + the legacy snapshot.
    const { fetchArchive } = await import("../lib/archiveStore.js");
    await waitFor(async () => {
      const { active } = await fetchArchive();
      expect(active).toHaveLength(2);
      const tonight = active.find((entry) => entry._kind === "service");
      expect(tonight?.id).toBe(SVC);
      expect(tonight?.state?.tables?.some((t) => t.resName === "Anna Harness")).toBe(true);
      expect(tonight?.state?.tables?.some((t) => t.resName === "Marco Harness")).toBe(true);
      const legacy = active.find((entry) => entry._kind === "legacy");
      expect(legacy?.id).toBe("legacy-10-07");
    }, { timeout: 20000 });
  }, 45000);
});
