// TEMPORARY debug probe — deleted before the PR. Walks the kitchen fire flow
// step by step with loud markers to locate a synchronous hang.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { resetBackend, seed, remoteRows } from "./harness/fakeBackend.js";
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
const courseRow = (position, key, name) => ({
  position, course_key: key, is_active: true, is_snack: false,
  menu: { name, sub: "" }, optional_flag: "", course_category: "main",
});

import { appendFileSync } from "node:fs";
const PROBE_LOG = "/tmp/claude-0/-home-user-Test/93326df6-ebd7-5c76-abd6-024511061975/scratchpad/probe-marks.log";
const mark = (s) => { try { appendFileSync(PROBE_LOG, `[PROBE] ${s}\n`); } catch { /* noop */ } };

describe("hang probe", () => {
  beforeEach(() => {
    resetBackend({ psMode: false });
  });

  it("kitchen fire flow, step by step", async () => {
    const now = new Date().toISOString();
    seed("service_settings", [{
      id: "service_date",
      state: { date: TODAY(), chosenOn: TODAY(), session: "dinner", startedAt: now },
      updated_at: now,
    }]);
    seed("service_tables", [{ table_id: 1, data: {
      ...blankTable(1), active: true, arrivedAt: "19:43",
      resName: "Anna Harness", resTime: "19:30", guests: 2,
    }, updated_at: now }]);
    seed("reservations", [
      { id: "res-anna", date: TODAY(), table_id: 1, created_at: now,
        data: { resName: "Anna Harness", resTime: "19:30", guests: 2, tableGroup: [], service_session: "dinner" } },
    ]);
    seed("menu_courses", [courseRow(1, "amuse", "Amuse"), courseRow(2, "venison", "Venison")]);
    mark("seeded");

    render(<App />);
    mark("rendered");

    fireEvent.click(await screen.findByText("[Kitchen]", {}, { timeout: 5000 }));
    mark("clicked [Kitchen]");

    await screen.findByText(/Anna Harness/, {}, { timeout: 5000 });
    mark("ticket visible");

    await screen.findByText("Amuse", {}, { timeout: 5000 });
    mark("Amuse visible");

    fireEvent.click(screen.getByText("Amuse"));
    mark("fired Amuse (click returned)");

    await waitFor(() => {
      expect(remoteRows("service_tables").find((r) => Number(r.table_id) === 1)?.data?.kitchenLog?.amuse?.firedAt).toBeTruthy();
    }, { timeout: 5000 });
    mark("fire persisted");
  }, 30000);
});
