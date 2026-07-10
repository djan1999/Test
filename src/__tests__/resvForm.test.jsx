// ── ResvForm — terrace-flow keys survive an edit ─────────────────────────────
// The form rebuilds the reservation's data blob from its fields on SAVE. It
// used to carry over only courseOverrides/kitchenCourseNotes, silently
// dropping visit_state / terrace_table — so the most routine mid-service
// edit (allergy, guest count) teleported a live terrace party back to
// 'booked': ghost tile. These tests pin the carry-through, and the one
// deliberate exception: a booking cleared off the board re-enters as a
// FRESH visit (flow keys + clearedFromBoard drop).

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ResvForm from "../components/reservations/ResvForm.jsx";
import { blankTable } from "../utils/tableHelpers.js";

if (typeof window !== "undefined" && !window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

const NOW = "2026-07-10T19:30:00.000Z";
const tables = Array.from({ length: 10 }, (_, i) => blankTable(i + 1));

const makeInitial = (dataExtra = {}) => ({
  id: "res-1",
  date: "2026-07-10",
  table_id: 3,
  data: {
    resName: "NOVAK", resTime: "19:30", guests: 2, tableGroup: [],
    service_session: "dinner",
    ...dataExtra,
  },
});

const saveForm = async (initial) => {
  const onSave = vi.fn(async () => {});
  render(
    <ResvForm
      initial={initial}
      tables={tables}
      reservations={[]}
      excludeId="res-1"
      onSave={onSave}
      onCancel={vi.fn()}
    />
  );
  fireEvent.click(screen.getByText("SAVE"));
  await waitFor(() => expect(onSave).toHaveBeenCalled());
  return onSave.mock.calls[0][0];
};

describe("ResvForm — flow-key carry-through", () => {
  it("a live terrace party's flow state survives an edit", async () => {
    const saved = await saveForm(makeInitial({
      visit_state: "terrace", terrace_table: "T23", terrace_map_id: "terrace_main",
      moved_at: null,
    }));
    expect(saved.data).toMatchObject({
      resName: "NOVAK",
      visit_state: "terrace", terrace_table: "T23", terrace_map_id: "terrace_main",
      moved_at: null,
    });
    expect(saved.data.clearedFromBoard).toBeUndefined();
  });

  it("the retired last_bite_fired_at stamp drops on edit (no longer a flow key)", async () => {
    const saved = await saveForm(makeInitial({
      visit_state: "terrace", terrace_table: "T23", last_bite_fired_at: NOW,
    }));
    expect(saved.data.visit_state).toBe("terrace");
    expect("last_bite_fired_at" in saved.data).toBe(false);
  });

  it("a booking cleared off the board re-enters as a fresh visit — no flow keys, no clearedFromBoard", async () => {
    const saved = await saveForm(makeInitial({
      clearedFromBoard: true, visit_state: "done", terrace_table: null, moved_at: NOW,
    }));
    expect(saved.data.clearedFromBoard).toBeUndefined();
    expect(saved.data.visit_state).toBeUndefined();
    expect(saved.data.terrace_table).toBeUndefined();
    expect(saved.data.moved_at).toBeUndefined();
  });

  it("legacy rows (never entered the flow) stay byte-identical — no spurious keys", async () => {
    const saved = await saveForm(makeInitial());
    expect("visit_state" in saved.data).toBe(false);
    expect("terrace_table" in saved.data).toBe(false);
    expect("last_bite_fired_at" in saved.data).toBe(false);
  });
});
