import { describe, it, expect } from "vitest";
import {
  visitStateOf, assignTerrace, clearTerraceTable,
  moveToDining, markSeated, closeVisit, FLOW_KEYS, pickFlowKeys,
} from "../utils/terraceFlow.js";

const NOW = "2026-07-05T19:30:00.000Z";

describe("visit state derivation", () => {
  it("legacy rows (no keys) are 'booked' — the zero-behavior-change path", () => {
    expect(visitStateOf(undefined)).toBe("booked");
    expect(visitStateOf({})).toBe("booked");
    expect(visitStateOf({ visit_state: "nonsense" })).toBe("booked");
  });

  it("self-heals the dead-end: 'terrace' with no table reads as 'booked'", () => {
    // The stuck party (10.07): cleared from its terrace table — 'terrace' +
    // no table locked it out of every seat/assign surface and kept its ghost
    // kitchen ticket alive. Reading it as 'booked' returns it to the normal
    // pool everywhere, including rows already persisted in that state before
    // the fix — and rows still carrying the retired last_bite_fired_at stamp.
    expect(visitStateOf({ visit_state: "terrace", terrace_table: null })).toBe("booked");
    expect(visitStateOf({ visit_state: "terrace" })).toBe("booked");
    expect(visitStateOf({ visit_state: "terrace", last_bite_fired_at: NOW })).toBe("booked");
    // A terrace party WITH a table is on terrace.
    expect(visitStateOf({ visit_state: "terrace", terrace_table: "T23" })).toBe("terrace");
  });
});

describe("assignTerrace", () => {
  it("booked → terrace with table + map", () => {
    const next = assignTerrace({ resName: "NOVAK" }, "T23", "terrace_main");
    expect(next).toMatchObject({ visit_state: "terrace", terrace_table: "T23", terrace_map_id: "terrace_main" });
    expect(next.resName).toBe("NOVAK"); // rest of the reservation untouched
  });
  it("re-assign on terrace and dining→terrace (dessert outside) allowed; mid-transition is a no-op", () => {
    expect(assignTerrace({ visit_state: "terrace", terrace_table: "T21" }, "T23").terrace_table).toBe("T23");
    expect(assignTerrace({ visit_state: "dining" }, "T23")).toMatchObject({ visit_state: "terrace", terrace_table: "T23" });
    expect(assignTerrace({ visit_state: "arriving" }, "T23")).toBeNull();
    expect(assignTerrace({ visit_state: "done" }, "T23")).toBeNull();
    expect(assignTerrace({}, "")).toBeNull();
  });
});

describe("clearTerraceTable", () => {
  it("clearing a terrace party returns it to 'booked' — never a dead end (10.07 stuck party)", () => {
    const d = clearTerraceTable({ visit_state: "terrace", terrace_table: "T23", resName: "NOVAK" });
    expect(d.terrace_table).toBeNull();
    expect(d.visit_state).toBe("booked");
    expect(d.resName).toBe("NOVAK"); // rest of the reservation untouched
    // ...so every normal action is available again:
    expect(assignTerrace(d, "T24")).toMatchObject({ visit_state: "terrace", terrace_table: "T24" });
  });

  it("a retired last_bite_fired_at stamp on an old row changes nothing", () => {
    const d = clearTerraceTable({ visit_state: "terrace", terrace_table: "T23", last_bite_fired_at: NOW });
    expect(d.visit_state).toBe("booked");
    expect(d.terrace_table).toBeNull();
  });

  it("clearing a party who is SEATED INSIDE heals to 'dining' — not back into the waiting pool", () => {
    // Dessert-outside party: dining table still active, tile struck early.
    const d = clearTerraceTable(
      { visit_state: "terrace", terrace_table: "T23" },
      { seatedInside: true },
    );
    expect(d.terrace_table).toBeNull();
    expect(d.visit_state).toBe("dining"); // still eating inside — NOT 'booked'
  });

  it("only a terrace party can be cleared", () => {
    expect(clearTerraceTable({ visit_state: "dining" })).toBeNull();
    expect(clearTerraceTable({})).toBeNull();
    expect(clearTerraceTable(undefined)).toBeNull();
  });
});

describe("MOVE / SEATED", () => {
  const onTerrace = { visit_state: "terrace", terrace_table: "T23" };

  it("MOVE → arriving, stamps moved_at, keeps terrace_table as history", () => {
    const next = moveToDining(onTerrace, NOW);
    expect(next).toMatchObject({ visit_state: "arriving", moved_at: NOW, terrace_table: "T23" });
  });

  it("MOVE is never blocked or gated: works from terrace only", () => {
    expect(moveToDining({ visit_state: "terrace", terrace_table: "T21" }, NOW).visit_state).toBe("arriving");
    expect(moveToDining({ visit_state: "booked" }, NOW)).toBeNull();
    expect(moveToDining({ visit_state: "arriving" }, NOW)).toBeNull();
  });

  it("MOVE_SINGLE_TAP skips the arriving confirm", () => {
    expect(moveToDining(onTerrace, NOW, { singleTap: true }).visit_state).toBe("dining");
  });

  it("MARK SEATED: arriving → dining, nothing else", () => {
    expect(markSeated({ visit_state: "arriving" }).visit_state).toBe("dining");
    expect(markSeated({ visit_state: "terrace" })).toBeNull();
    expect(markSeated({})).toBeNull();
  });
});

describe("pickFlowKeys (edit-form carry-through)", () => {
  it("picks only the flow keys that are present — legacy rows stay byte-identical", () => {
    expect(pickFlowKeys(undefined)).toEqual({});
    expect(pickFlowKeys({ resName: "NOVAK", notes: "window" })).toEqual({});
    const full = {
      resName: "NOVAK", visit_state: "terrace", terrace_table: "T23",
      terrace_map_id: "terrace_main", moved_at: null,
    };
    expect(pickFlowKeys(full)).toEqual({
      visit_state: "terrace", terrace_table: "T23",
      terrace_map_id: "terrace_main", moved_at: null,
    });
    // null is a real value (terrace_table: null after a clear) — only
    // undefined means "key never entered the flow".
    expect(pickFlowKeys({ terrace_table: null })).toEqual({ terrace_table: null });
    expect(Object.keys(pickFlowKeys(full)).every((k) => FLOW_KEYS.includes(k))).toBe(true);
    // the retired arming stamp is no longer a flow key — edits drop it
    expect(FLOW_KEYS).not.toContain("last_bite_fired_at");
    expect(pickFlowKeys({ visit_state: "terrace", last_bite_fired_at: NOW }))
      .toEqual({ visit_state: "terrace" });
  });
});

describe("closeVisit", () => {
  it("closes only rows that entered the flow; legacy rows untouched", () => {
    expect(closeVisit({ visit_state: "dining" }).visit_state).toBe("done");
    expect(closeVisit({})).toBeNull();
    expect(closeVisit(undefined)).toBeNull();
  });
});
