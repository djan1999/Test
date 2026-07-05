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
