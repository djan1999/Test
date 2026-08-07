// ── Summary — drink counts ────────────────────────────────────────────────────
// The sheet's counter is only useful if the number survives the trip to the
// places the count is actually read: the summary card the floor scans, and the
// text it copies out to the pass.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import TableSummaryCard from "../components/modals/TableSummaryCard.jsx";
import SummaryModal from "../components/modals/SummaryModal.jsx";

const seat = (id, over = {}) => ({
  id, water: "—", pairing: "", aperitifs: [], glasses: [], cocktails: [],
  spirits: [], beers: [], extras: {}, optionalPairings: {}, ...over,
});

const rebula = (over = {}) => ({ name: "Rebula", producer: "Klinec", vintage: "2021", ...over });

const table = (over = {}) => ({
  id: 4, active: true, guests: 2, resName: "Weber", arrivedAt: "20:06",
  menuType: "long", restrictions: [], bottleWines: [], seats: [seat(1), seat(2)],
  ...over,
});

describe("TableSummaryCard — drink counts", () => {
  it("shows a round as one chip with ×N instead of the same chip three times", () => {
    const { container } = render(
      <TableSummaryCard table={table({
        seats: [seat(1, { glasses: [rebula(), rebula(), rebula()] }), seat(2)],
      })} />,
    );
    expect(screen.getByText("Rebula ×3")).toBeTruthy();
    expect(container.textContent.match(/Rebula/g)).toHaveLength(1);
  });

  it("leaves a single pour uncounted — ×1 is noise on every party", () => {
    render(<TableSummaryCard table={table({ seats: [seat(1, { cocktails: [{ name: "Negroni" }] }), seat(2)] })} />);
    expect(screen.getByText("Negroni")).toBeTruthy();
  });

  it("counts the table's bottles on one line", () => {
    render(<TableSummaryCard table={table({ bottleWines: [rebula(), rebula()] })} />);
    expect(screen.getByText(/Klinec Rebula '21 ×2/)).toBeTruthy();
  });

  it("still lists two producers' Rebula separately", () => {
    render(<TableSummaryCard table={table({ bottleWines: [rebula(), rebula({ producer: "Movia" })] })} />);
    expect(screen.getByText(/Klinec Rebula '21$/)).toBeTruthy();
    expect(screen.getByText(/Movia Rebula '21$/)).toBeTruthy();
  });
});

describe("SummaryModal — copied text", () => {
  let written;
  beforeEach(() => {
    written = null;
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn(async (t) => { written = t; }) },
      configurable: true,
    });
  });

  it("carries the count into the pasted line rather than repeating the name", () => {
    render(
      <SummaryModal
        tables={[table({ seats: [seat(1, { glasses: [rebula(), rebula()] }), seat(2)] })]}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("COPY TEXT"));
    expect(written).toContain("glass:Rebula ×2");
  });
});
