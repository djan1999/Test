import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, fireEvent } from "@testing-library/react";
import FloorEditor from "../components/floor/FloorEditor.jsx";
import { buildDefaultFloorMaps } from "../utils/floorMaps.js";

// Geometry editor smoke (the admin Floor & Terrace surface): drag-commit,
// tap-select → inspector, sheet tools, map ops, RESET, and the renumber flow.

const floorMaps = buildDefaultFloorMaps();

// Stateful harness: in the app updateFloorMaps flows the next state back in
// as the floorMaps prop, and the inspector reads the committed state — the
// mock alone would leave it stale.
function Harness({ initial, spy }) {
  const [fm, setFm] = useState(initial);
  return (
    <FloorEditor
      floorMaps={fm}
      onUpdateFloorMaps={(next) => { spy(next); setFm(next); }}
      reservations={[]}
    />
  );
}

const setup = (overrides = {}) => {
  const onUpdateFloorMaps = vi.fn();
  const utils = render(<Harness initial={overrides.floorMaps || floorMaps} spy={onUpdateFloorMaps} />);
  // jsdom rects are all-zero; give the svg a real box so client→map-unit
  // conversion works for pointer gestures.
  const svg = utils.container.querySelector("svg");
  svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 368, right: 400, bottom: 368 });
  return { ...utils, onUpdateFloorMaps };
};

const findTable = (container, label) =>
  [...container.querySelectorAll("g")].find((g) => g.textContent.startsWith(label));

const tapTable = (container, label) => {
  const g = findTable(container, label);
  fireEvent.pointerDown(g, { clientX: 40, clientY: 40 });
  fireEvent.pointerUp(g, { clientX: 40, clientY: 40 });
};

describe("FloorEditor (admin geometry surface)", () => {
  it("lists every map as a tab (inactive layouts editable too)", () => {
    const { getByText } = setup();
    getByText("LAYOUT A");
    getByText("LAYOUT B");
    getByText("TERRACE");
  });

  it("SELECT (the default) never drags — a stray swipe resolves as a tap-select", () => {
    const { container, onUpdateFloorMaps } = setup();
    const t1 = findTable(container, "T1");
    fireEvent.pointerDown(t1, { clientX: 40, clientY: 40 });
    fireEvent.pointerMove(t1, { clientX: 80, clientY: 80 });
    fireEvent.pointerUp(t1, { clientX: 80, clientY: 80 });
    expect(onUpdateFloorMaps).not.toHaveBeenCalled(); // geometry untouched
    expect(container.textContent).toContain("INSPECTOR — T1");
  });

  it("MOVE armed: drag commits one snapped move through updateFloorMaps", () => {
    const { container, onUpdateFloorMaps, getByText } = setup();
    fireEvent.click(getByText("MOVE"));
    // T1 sits at (8,8); 400px/368px box → 4px per map unit. +40px/+40px = +10/+10 units.
    const t1 = findTable(container, "T1");
    fireEvent.pointerDown(t1, { clientX: 40, clientY: 40 });
    fireEvent.pointerMove(t1, { clientX: 80, clientY: 80 });
    fireEvent.pointerUp(t1, { clientX: 80, clientY: 80 });
    expect(onUpdateFloorMaps).toHaveBeenCalledTimes(1);
    const next = onUpdateFloorMaps.mock.calls[0][0];
    const t1Next = next.maps.find((m) => m.id === "dining_a").tables.find((t) => t.label === "T1");
    expect([t1Next.x, t1Next.y]).toEqual([18, 18]);
  });

  it("tap-select opens the table inspector; DELETE is two-step", () => {
    const { container, onUpdateFloorMaps, getByText } = setup();
    tapTable(container, "T1");
    expect(container.textContent).toContain("INSPECTOR — T1");
    fireEvent.click(getByText("DELETE T1"));
    expect(onUpdateFloorMaps).not.toHaveBeenCalled(); // armed, not applied
    fireEvent.click(getByText("CONFIRM ✓"));
    const next = onUpdateFloorMaps.mock.calls[0][0];
    expect(next.maps.find((m) => m.id === "dining_a").tables.some((t) => t.label === "T1")).toBe(false);
  });

  it("DUPLICATE MAP creates '<NAME> COPY' (the LAYOUT C path)", () => {
    const { onUpdateFloorMaps, getByText } = setup();
    fireEvent.click(getByText("DUPLICATE MAP"));
    const next = onUpdateFloorMaps.mock.calls[0][0];
    expect(next.maps.some((m) => m.name === "LAYOUT A COPY")).toBe(true);
  });

  it("RESET TO DEFAULTS is confirm-gated, shows the unfreeze banner, restores one map", () => {
    const mangled = {
      ...floorMaps,
      geometryVersion: 1,
      maps: floorMaps.maps.map((m) => m.id !== "dining_a" ? m : {
        ...m,
        tables: m.tables.map((t) => (t.label === "T1" ? { ...t, x: 60, y: 60 } : t)),
      }),
    };
    const { container, onUpdateFloorMaps, getByText } = setup({ floorMaps: mangled });
    expect(container.textContent).toContain("NEW DEFAULT GEOMETRY AVAILABLE — RESET MAP");
    fireEvent.click(getByText("RESET TO DEFAULTS"));
    fireEvent.click(getByText("CONFIRM ✓"));
    const next = onUpdateFloorMaps.mock.calls[0][0];
    expect(next.maps.find((m) => m.id === "dining_a").tables.find((t) => t.label === "T1").x).toBe(8);
    expect(next.geometryVersion).toBeGreaterThan(1);
  });

  it("MEMBERS chips build a merge one tap at a time", () => {
    const utils = setup();
    const { container, onUpdateFloorMaps } = utils;
    tapTable(container, "T6");
    // chips add one label per tap — the first (single-member) tap must stick
    const chip = (lbl) => utils.getAllByText(lbl).find((el) => el.tagName === "BUTTON");
    fireEvent.click(chip("T6"));
    fireEvent.click(chip("T7"));
    const next = onUpdateFloorMaps.mock.calls.at(-1)[0];
    const t6 = next.maps.find((m) => m.id === "dining_a").tables.find((t) => t.label === "T6");
    expect(t6.members).toEqual(["T6", "T7"]);
  });

  it("RENUMBER: tapping every chair in sequence commits the numbering", () => {
    const { container, onUpdateFloorMaps, getByText } = setup();
    tapTable(container, "T1");
    fireEvent.click(getByText("RENUMBER"));
    const t1 = findTable(container, "T1");
    const chairs = [...t1.querySelectorAll("g")];
    fireEvent.click(chairs[1]); // E chair first → becomes seat 1
    fireEvent.click(chairs[0]);
    const next = onUpdateFloorMaps.mock.calls.at(-1)[0];
    const seats = next.maps.find((m) => m.id === "dining_a").tables.find((t) => t.label === "T1").seats;
    expect(seats.map((s) => s.no)).toEqual([2, 1]);
  });
});

describe("FloorEditor sheet tools (walls / doors / zones / planters)", () => {
  const canvas = (container) => container.querySelector("[data-sheet-canvas]");
  const tap = (el, clientX, clientY) => {
    fireEvent.pointerDown(el, { clientX, clientY });
    fireEvent.pointerUp(el, { clientX, clientY });
  };

  it("renders the seed architecture and the tool row", () => {
    const { container, getByText } = setup();
    expect(container.textContent).toContain("PASS / KITCHEN"); // seed zone
    for (const t of ["SELECT", "MOVE", "WALL", "DOOR", "ZONE", "PLANT"]) getByText(t);
  });

  it("WALL: taps place ortho-snapped points, END commits an open wall", () => {
    const { container, onUpdateFloorMaps, getByText } = setup();
    fireEvent.click(getByText("WALL"));
    // 4px per unit: (80,80) → (20,20); (161,88) → (40.25,22) ortho-locks to y=20
    tap(canvas(container), 80, 80);
    tap(canvas(container), 161, 88);
    fireEvent.click(getByText("END"));
    const next = onUpdateFloorMaps.mock.calls[0][0];
    const walls = next.maps.find((m) => m.id === "dining_a").sheet.walls;
    expect(walls[walls.length - 1]).toMatchObject({ closed: false, pts: [[20, 20], [40, 20]] });
    expect(container.textContent).toContain("INSPECTOR — WALL");
  });

  it("DOOR: tapping near a wall cuts an opening and selects it", () => {
    const { container, onUpdateFloorMaps, getByText } = setup();
    fireEvent.click(getByText("DOOR"));
    tap(canvas(container), 120, 8); // (30, 2) — on the seed top wall
    const next = onUpdateFloorMaps.mock.calls[0][0];
    expect(next.maps.find((m) => m.id === "dining_a").sheet.openings.length).toBe(2);
    expect(container.textContent).toContain("INSPECTOR — DOOR");
  });

  it("ZONE: stamp, then the inspector renames it", () => {
    const { container, onUpdateFloorMaps, getByText } = setup();
    fireEvent.click(getByText("ZONE"));
    tap(canvas(container), 200, 160); // (50, 40) — empty floor
    const next = onUpdateFloorMaps.mock.calls[0][0];
    const zones = next.maps.find((m) => m.id === "dining_a").sheet.zones;
    expect(zones.length).toBe(2);
    expect(container.textContent).toContain("INSPECTOR — ZONE");
  });

  it("SELECT taps the seed zone open; MOVE drag commits one snapped move", () => {
    const { container, onUpdateFloorMaps, getByText } = setup();
    // seed zone spans x2..98, y82..90 → tap (50, 85) = client (200, 340)
    tap(canvas(container), 200, 340); // default SELECT: tap-to-edit works
    expect(container.textContent).toContain("INSPECTOR — ZONE");
    fireEvent.click(getByText("MOVE"));
    fireEvent.pointerDown(canvas(container), { clientX: 200, clientY: 340 });
    fireEvent.pointerMove(canvas(container), { clientX: 200, clientY: 300 }); // up 10 units
    fireEvent.pointerUp(canvas(container), { clientX: 200, clientY: 300 });
    const next = onUpdateFloorMaps.mock.calls.at(-1)[0];
    const z = next.maps.find((m) => m.id === "dining_a").sheet.zones[0];
    expect(z.y).toBe(72);
    expect(z.x).toBe(2);
  });
});
