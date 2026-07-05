import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import FloorMap, { restrictionCode } from "../components/floor/FloorMap.jsx";
import { buildDefaultFloorMaps } from "../utils/floorMaps.js";

const state = buildDefaultFloorMaps();
const terrace = state.maps.find((m) => m.kind === "terrace");
const mapB = state.maps.find((m) => m.id === "dining_b");

describe("FloorMap renderer", () => {
  it("renders every table label and numbered seat dots", () => {
    const { container } = render(<FloorMap map={mapB} mode="view" />);
    const text = container.textContent;
    for (const t of mapB.tables) expect(text).toContain(t.label);
    // T9 under Layout B seats 3 — dots 1..3 rendered (CONFIRM-tagged seats get a ?)
    expect(text).toContain("3");
  });

  it("occupied tables show party name ×pax; armed badge renders", () => {
    const { container } = render(
      <FloorMap map={terrace} mode="view" tableState={{
        T23: { status: "occupied", name: "NOVAK", pax: 2, sub: "C4/12", badge: { text: "LAST BITE ✓" } },
      }} />,
    );
    expect(container.textContent).toContain("NOVAK ×2");
    expect(container.textContent).toContain("C4/12");
    expect(container.textContent).toContain("LAST BITE ✓");
  });

  it("picker mode: free tables tap through, occupied tables are inert + dimmed", () => {
    const onTap = vi.fn();
    const { container } = render(
      <FloorMap map={terrace} mode="picker" onTableTap={onTap} tableState={{
        T22: { status: "occupied", name: "KOS", pax: 2 },
      }} />,
    );
    const groups = [...container.querySelectorAll("g")].filter((g) => g.textContent.includes("T2"));
    const free = [...container.querySelectorAll("g")].find((g) => g.textContent.startsWith("T23"));
    const busy = [...container.querySelectorAll("g")].find((g) => g.textContent.startsWith("T22"));
    fireEvent.click(free);
    expect(onTap).toHaveBeenCalledTimes(1);
    expect(onTap.mock.calls[0][0].label).toBe("T23");
    fireEvent.click(busy);
    expect(onTap).toHaveBeenCalledTimes(1); // inert
    expect(busy.getAttribute("opacity")).toBe("0.4");
    expect(groups.length).toBeGreaterThan(0);
  });

  it("restricted seats fill amber with the restriction code (acceptance 8)", () => {
    const { container } = render(
      <FloorMap map={terrace} mode="view"
        tableState={{ T23: { status: "occupied", name: "NOVAK", pax: 2 } }}
        restrictionsByLabel={{ T23: [{ note: "Shellfish", pos: 1 }] }} />,
    );
    expect(container.textContent).toContain("SHF");
  });

  it("dirty tables carry the amber DIRTY strip label", () => {
    const { container } = render(
      <FloorMap map={terrace} mode="view" tableState={{ T23: { status: "free", dirty: true } }} />,
    );
    expect(container.textContent).toContain("DIRTY");
  });

  it("seats mode: chair taps report (label, seatIndex) only for the edited table", () => {
    const onSeat = vi.fn();
    const { container } = render(
      <FloorMap map={mapB} mode="seats" seatsEditLabel="T9" onSeatTap={onSeat} />,
    );
    const t9 = [...container.querySelectorAll("g")].find((g) => g.textContent.startsWith("T9"));
    const chair = t9.querySelector("g"); // first seat group
    fireEvent.click(chair);
    expect(onSeat).toHaveBeenCalledWith("T9", 0);
  });
});

describe("restrictionCode", () => {
  it("maps known vocabulary and falls back deterministically", () => {
    expect(restrictionCode("SHELLFISH allergy")).toBe("SHF");
    expect(restrictionCode("no gluten")).toBe("GLU");
    expect(restrictionCode("Kiwi")).toBe("KIW");
    expect(restrictionCode("")).toBe("");
  });
});

/* ── floor-first correction: service + edit modes ─────────────────────────── */

// jsdom rects are all-zero; give the svg a real box so client→map-unit
// conversion works for the drag tests.
const sizeSvg = (container) => {
  const svg = container.querySelector("svg");
  svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 368, right: 400, bottom: 368 });
  return svg;
};

describe("FloorMap service mode (two-zone tables)", () => {
  it("strip tap cycles via onStripTap; body tap still opens the table", () => {
    const onStrip = vi.fn();
    const onTap = vi.fn();
    const { container } = render(
      <FloorMap map={terrace} mode="service" onStripTap={onStrip} onTableTap={onTap}
        tableState={{ T21: { status: "free", strip: "DIRTY" } }} />,
    );
    fireEvent.click(container.querySelector('[data-strip="T21"]'));
    expect(onStrip).toHaveBeenCalledWith("T21");
    expect(onTap).not.toHaveBeenCalled(); // strip tap must not bubble into the body
    const body = [...container.querySelectorAll("g")].find((g) => g.textContent.startsWith("T21"));
    fireEvent.click(body);
    expect(onTap).toHaveBeenCalledTimes(1);
    expect(onTap.mock.calls[0][0].label).toBe("T21");
  });

  it("renders SET / DIRTY strip labels, pulses DIRTY, and shows the allergy ▲", () => {
    const { container } = render(
      <FloorMap map={terrace} mode="service" tableState={{
        T21: { status: "occupied", name: "NOVAK", pax: 2, strip: "SET", allergy: true },
        T22: { status: "free", strip: "DIRTY" },
      }} />,
    );
    expect(container.textContent).toContain("SET");
    expect(container.textContent).toContain("DIRTY");
    expect(container.textContent).toContain("▲");
    expect(container.querySelector(".fm-strip-pulse")).toBeTruthy();
  });

  it("reserved tables render dashed with name + time", () => {
    const { container } = render(
      <FloorMap map={mapB} mode="service" tableState={{
        T4: { status: "reserved", name: "KOVAČ", pax: 4, sub: "19:30" },
      }} />,
    );
    expect(container.textContent).toContain("KOVAČ ×4");
    expect(container.textContent).toContain("19:30");
  });
});

describe("FloorMap edit mode (drag + select)", () => {
  it("drag commits one snapped move on release; tap (no movement) selects", () => {
    const onMove = vi.fn();
    const onTap = vi.fn();
    const { container } = render(
      <FloorMap map={mapB} mode="edit" onTableMove={onMove} onTableTap={onTap} />,
    );
    sizeSvg(container);
    const t1 = [...container.querySelectorAll("g")].find((g) => g.textContent.startsWith("T1"));
    // T1 sits at (8,8); 400px/368px box → 4px per map unit. Drag +80px/+40px = +20/+10 units.
    fireEvent.pointerDown(t1, { clientX: 40, clientY: 40 });
    fireEvent.pointerMove(t1, { clientX: 120, clientY: 80 });
    fireEvent.pointerUp(t1, { clientX: 120, clientY: 80 });
    expect(onMove).toHaveBeenCalledWith("T1", 28, 18);
    expect(onTap).not.toHaveBeenCalled();
    // plain tap → selection, no move
    fireEvent.pointerDown(t1, { clientX: 40, clientY: 40 });
    fireEvent.pointerUp(t1, { clientX: 40, clientY: 40 });
    expect(onTap).toHaveBeenCalledTimes(1);
    expect(onMove).toHaveBeenCalledTimes(1);
  });

  it("a selected table's seat drags along the outline via onSeatMove", () => {
    const onSeatMove = vi.fn();
    const { container } = render(
      <FloorMap map={mapB} mode="edit" selectedLabel="T8" onSeatMove={onSeatMove} />,
    );
    sizeSvg(container);
    const t8 = [...container.querySelectorAll("g")].find((g) => g.textContent.startsWith("T8"));
    const seat = t8.querySelector("g");
    fireEvent.pointerDown(seat, { clientX: 40, clientY: 280 });
    fireEvent.pointerMove(seat, { clientX: 56, clientY: 272 });
    fireEvent.pointerUp(seat, { clientX: 56, clientY: 272 });
    expect(onSeatMove).toHaveBeenCalledTimes(1);
    const [label, index, point] = onSeatMove.mock.calls[0];
    expect(label).toBe("T8");
    expect(index).toBe(0);
    expect(point.x).toBeCloseTo(14, 5);
    expect(point.y).toBeCloseTo(68, 5);
  });
});
