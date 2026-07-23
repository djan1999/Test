// ── Printable sheet edit persistence ─────────────────────────────────────────
// The weekly overview / allergy sheets and the per-day service breakdown are
// editable print documents. Edits used to live only in component state, so
// closing the view (required to add a reservation), navigating away, or a
// reload around printing silently threw them away. These tests pin the fix:
// edits persist per workspace and re-merge over freshly generated content, so
// tables added later still appear while manual edits stay put.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { setWorkspaceId } from "../lib/supabaseClient.js";
import {
  readWeeklySheetEdits, writeWeeklySheetEdits,
  readServiceBreakdownDoc, writeServiceBreakdownDoc,
} from "../utils/storage.js";
import ServiceBreakdown, { buildInitialState, mergeSavedDoc } from "../components/ServiceBreakdown.jsx";

const resv = (id, table, time, name, extra = {}) => ({
  id,
  table_id: table,
  date: "2026-07-22",
  data: { resTime: time, resName: name, guests: 2, service_session: "dinner", ...extra },
});

describe("weekly sheet edits storage", () => {
  beforeEach(() => { localStorage.clear(); setWorkspaceId(null); });
  afterEach(() => { setWorkspaceId(null); });

  it("round-trips edits per sheet + week and clears when emptied", () => {
    expect(readWeeklySheetEdits("overview", "2026-07-20")).toEqual({});
    writeWeeklySheetEdits("overview", "2026-07-20", { "Rr1-3": "Smith (VIP)" });
    expect(readWeeklySheetEdits("overview", "2026-07-20")).toEqual({ "Rr1-3": "Smith (VIP)" });
    // Other sheet and other week are isolated
    expect(readWeeklySheetEdits("allergies", "2026-07-20")).toEqual({});
    expect(readWeeklySheetEdits("overview", "2026-07-27")).toEqual({});
    // RESET writes an empty map → entry removed
    writeWeeklySheetEdits("overview", "2026-07-20", {});
    expect(readWeeklySheetEdits("overview", "2026-07-20")).toEqual({});
  });

  it("is namespaced per workspace", () => {
    setWorkspaceId("ws-a");
    writeWeeklySheetEdits("allergies", "2026-07-20", { "hdr-date": "custom" });
    setWorkspaceId("ws-b");
    expect(readWeeklySheetEdits("allergies", "2026-07-20")).toEqual({});
    setWorkspaceId("ws-a");
    expect(readWeeklySheetEdits("allergies", "2026-07-20")).toEqual({ "hdr-date": "custom" });
  });

  it("prunes oldest weeks so the cache stays bounded", () => {
    for (let i = 0; i < 15; i++) {
      writeWeeklySheetEdits("overview", `2026-01-${String(i + 1).padStart(2, "0")}`, { k: `v${i}` });
    }
    expect(readWeeklySheetEdits("overview", "2026-01-01")).toEqual({});
    expect(readWeeklySheetEdits("overview", "2026-01-15")).toEqual({ k: "v14" });
  });
});

describe("service breakdown doc merge", () => {
  beforeEach(() => { localStorage.clear(); setWorkspaceId(null); });

  it("keeps user edits and refreshes untouched auto text when tables are added", () => {
    const r1 = resv("r1", 4, "19:00", "Smith");
    const r2 = resv("r2", 6, "19:00", "Jones");
    const baseline = buildInitialState("2026-07-22", [r1]);
    const edited = {
      ...baseline,
      bread: "6",
      slots: baseline.slots.map(s => ({ ...s, label: "19:00 - VIP night" })),
    };
    const fresh = buildInitialState("2026-07-22", [r1, r2]);
    const merged = mergeSavedDoc(fresh, edited, baseline);

    const slot = merged.slots.find(s => s.type === "slot");
    // Edited fields survive the rebuild
    expect(slot.label).toBe("19:00 - VIP night");
    expect(merged.bread).toBe("6");
    // Untouched auto text re-derives from the current reservations
    expect(merged.summaryText).toBe(fresh.summaryText);
    expect(merged.summaryText).toContain("2 tables");
    // The new reservation shows up alongside the old one
    expect(slot.reservations.map(r => r.id)).toEqual(["r1", "r2"]);
  });

  it("unedited slot labels pick up new table counts", () => {
    const r1 = resv("r1", 4, "19:00", "Smith");
    const baseline = buildInitialState("2026-07-22", [r1]);
    const fresh = buildInitialState("2026-07-22", [r1, resv("r2", 6, "19:00", "Jones")]);
    const merged = mergeSavedDoc(fresh, baseline, baseline);
    expect(merged.slots.find(s => s.type === "slot").label).toBe("19:00 - 2 tables");
  });

  it("storage round-trips doc + baseline per date", () => {
    expect(readServiceBreakdownDoc("2026-07-22")).toBeNull();
    const doc = buildInitialState("2026-07-22", [resv("r1", 4, "19:00", "Smith")]);
    writeServiceBreakdownDoc("2026-07-22", doc, doc);
    const saved = readServiceBreakdownDoc("2026-07-22");
    expect(saved.doc).toEqual(doc);
    expect(saved.baseline).toEqual(doc);
    expect(readServiceBreakdownDoc("2026-07-23")).toBeNull();
  });
});

describe("ServiceBreakdown component persistence", () => {
  beforeEach(() => { localStorage.clear(); setWorkspaceId(null); });
  afterEach(() => cleanup());

  it("edits survive close/reopen and newly added tables still appear", () => {
    const r1 = resv("r1", 4, "19:00", "Smith");
    const { unmount } = render(
      <ServiceBreakdown dateStr="2026-07-22" reservations={[r1]} onClose={() => {}} />
    );
    const header = screen.getByDisplayValue("T04: Smith [2 pax]");
    fireEvent.change(header, { target: { value: "T04: Smith — VIP [2 pax]" } });
    unmount();

    // Reopen after a reservation was added (the exact flow that used to wipe edits)
    render(
      <ServiceBreakdown
        dateStr="2026-07-22"
        reservations={[r1, resv("r2", 6, "19:00", "Jones")]}
        onClose={() => {}}
      />
    );
    expect(screen.getByDisplayValue("T04: Smith — VIP [2 pax]")).toBeInTheDocument();
    expect(screen.getByDisplayValue("T06: Jones [2 pax]")).toBeInTheDocument();
    // Unedited slot label refreshed to the new table count
    expect(screen.getByDisplayValue("19:00 - 2 tables")).toBeInTheDocument();
  });

  it("a different date starts clean", () => {
    const r1 = resv("r1", 4, "19:00", "Smith");
    const { unmount } = render(
      <ServiceBreakdown dateStr="2026-07-22" reservations={[r1]} onClose={() => {}} />
    );
    fireEvent.change(screen.getByDisplayValue("T04: Smith [2 pax]"), {
      target: { value: "edited" },
    });
    unmount();

    const other = { ...resv("r9", 4, "19:00", "Smith"), date: "2026-07-23" };
    render(<ServiceBreakdown dateStr="2026-07-23" reservations={[other]} onClose={() => {}} />);
    expect(screen.getByDisplayValue("T04: Smith [2 pax]")).toBeInTheDocument();
  });
});
