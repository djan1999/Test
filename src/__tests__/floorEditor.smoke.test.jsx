import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import FloorEditor from "../components/floor/FloorEditor.jsx";
import { buildDefaultFloorMaps } from "../utils/floorMaps.js";

// Geometry editor smoke (the admin Floor & Terrace surface): drag-commit,
// tap-select → inspector, map ops, RESET, and the renumber flow.

const floorMaps = buildDefaultFloorMaps();

const setup = (overrides = {}) => {
  const onUpdateFloorMaps = vi.fn();
  const utils = render(
    <FloorEditor
      floorMaps={floorMaps}
      onUpdateFloorMaps={onUpdateFloorMaps}
      reservations={[]}
      {...overrides}
    />,
  );
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

  it("drag commits one snapped move through updateFloorMaps", () => {
    const { container, onUpdateFloorMaps } = setup();
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
