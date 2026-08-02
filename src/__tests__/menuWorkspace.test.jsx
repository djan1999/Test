import { useState } from "react";
import { fireEvent, render, within } from "@testing-library/react";
import MenuWorkspace from "../components/menu/MenuWorkspace.jsx";

const COURSES = [
  {
    course_key: "kefir",
    menu: { name: "Kefir", sub: "Cucumber, dill" },
    restrictions: { dairy: { name: "Mountain herbs", sub: "Oat cream, rye crisp" } },
    wp: { name: "Rebula", sub: "Goriška Brda" },
  },
  {
    course_key: "zganci",
    menu: { name: "Žganci", sub: "Pork crackling" },
    restrictions: { gluten: { name: "Polenta", sub: "Porcini, aged Tolminc" } },
  },
];

const TABLE = {
  id: 4,
  active: true,
  arrivedAt: "19:08",
  resName: "Novak",
  resTime: "19:00",
  menuType: "",
  lang: "en",
  seats: [{ id: 1 }, { id: 2 }],
  restrictions: [{ note: "gluten", pos: 1 }],
};

/**
 * Stateful harness so the workspace's seat writes behave like the app: `upd`
 * has App's (tableId, field, valueOrFn) shape and commits into React state, so
 * a pairing chip click really lands on the seat and re-renders the engine.
 */
function Harness({ updCalls = [], ...extra }) {
  const [tables, setTables] = useState([TABLE]);
  const upd = (id, field, valueOrFn) => {
    updCalls.push([id, field, valueOrFn]);
    setTables((prev) => prev.map((t) => t.id === id
      ? { ...t, [field]: typeof valueOrFn === "function" ? valueOrFn(t[field], t) : valueOrFn }
      : t));
  };
  return <MenuWorkspace tables={tables} menuCourses={COURSES} upd={upd} {...extra} />;
}

const renderWorkspace = (props = {}) => render(<Harness {...props} />);

const mockPrintWindow = () => {
  const print = vi.fn();
  const doc = { write: vi.fn(), close: vi.fn() };
  vi.spyOn(window, "open").mockReturnValue({ document: doc, focus: vi.fn(), print });
  return { print, doc };
};

describe("MenuWorkspace", () => {
  it("shows the empty state until a table is chosen", () => {
    const { getByText, queryByText } = renderWorkspace();
    expect(getByText("CHOOSE A TABLE — THEN GENERATE MENUS")).toBeTruthy();
    expect(queryByText("SEAT 1")).toBeNull();
  });

  it("lists live parties with their cover/menu/language meta and restriction count", () => {
    const { getByText } = renderWorkspace();
    expect(getByText("ACTIVE TABLES — TAP TO PREPARE MENUS")).toBeTruthy();
    expect(getByText("CV_02 · LONG · EN · SEATED")).toBeTruthy();
    expect(getByText("[1]")).toBeTruthy();
  });

  it("prepares the party and substitutes only the restricted seat's course", () => {
    const { getByText, queryByText } = renderWorkspace();
    fireEvent.click(getByText("Novak"));

    // Seat 1 carries the gluten restriction — its žganci is substituted, and
    // the attribution line names the key and the original wording.
    expect(getByText("SUBSTITUTED FOR [GLUTEN FREE] — WAS: Žganci")).toBeTruthy();
    expect(getByText("Polenta — Porcini, aged Tolminc")).toBeTruthy();

    // Seat 2 carries nothing, so the same course prints unchanged.
    fireEvent.click(getByText("SEAT 2"));
    expect(queryByText(/SUBSTITUTED FOR/)).toBeNull();
    expect(getByText("Žganci — Pork crackling")).toBeTruthy();
  });

  it("renders the preview from generateMenuHTML — the engine's page, not a lookalike", () => {
    const { getByText, getByTitle } = renderWorkspace();
    fireEvent.click(getByText("Novak"));
    const iframe = getByTitle("Seat 1 menu preview");
    const html = iframe.getAttribute("srcdoc");
    // Engine markers: the A5 sheet scaffold and template-driven menu rows.
    expect(html).toContain('id="sheet"');
    expect(html).toContain("menu-row");
    // The seat's substituted wording is what the engine printed.
    expect(html).toContain("Polenta");
  });

  it("writes the pairing chip to seat.pairing through upd and re-runs the engine", () => {
    const updCalls = [];
    const { getByText, queryByText } = renderWorkspace({ updCalls });
    fireEvent.click(getByText("Novak"));
    expect(queryByText("Rebula · Goriška Brda")).toBeNull();

    fireEvent.click(getByText("Wine"));
    // The write goes through the app's seat path: upd(tableId, "seats", fn).
    expect(updCalls.length).toBe(1);
    expect(updCalls[0][0]).toBe(4);
    expect(updCalls[0][1]).toBe("seats");
    const nextSeats = updCalls[0][2](TABLE.seats, TABLE);
    expect(nextSeats.find((s) => s.id === 1)?.pairing).toBe("Wine");

    // The grey pairing line under the course comes from the engine's row model.
    expect(getByText("Rebula · Goriška Brda")).toBeTruthy();

    fireEvent.click(getByText("—"));
    expect(queryByText("Rebula · Goriška Brda")).toBeNull();
  });

  /**
   * The one layout invariant this screen cannot get wrong: the edit input row
   * and the course text must each own a full flex line. Sharing one collapses
   * the text column and wraps the dish one word per line.
   */
  it("gives the course text and the edit input a full flex line each", () => {
    const { getByText, getByDisplayValue } = renderWorkspace();
    fireEvent.click(getByText("Novak"));
    fireEvent.click(getByText("Polenta — Porcini, aged Tolminc"));

    const input = getByDisplayValue("Polenta");
    const editLine = input.parentElement;
    const card = editLine.parentElement;
    const textLine = card.firstChild;

    expect(card.style.flexWrap).toBe("wrap");
    expect(textLine.style.flex).toBe("1 1 100%");
    expect(editLine.style.flex).toBe("1 1 100%");
  });

  it("keeps a one-time edit on its own seat and clears it with CLEAR EDITS", () => {
    const { getByText, queryByText, getByDisplayValue } = renderWorkspace();
    fireEvent.click(getByText("Novak"));
    fireEvent.click(getByText("Kefir — Cucumber, dill"));

    fireEvent.change(getByDisplayValue("Kefir"), { target: { value: "Kefir, no dill" } });
    fireEvent.click(getByText("SAVE"));

    expect(getByText("Kefir, no dill — Cucumber, dill")).toBeTruthy();
    expect(getByText("✎ ONE-TIME EDIT — THIS SEAT ONLY")).toBeTruthy();
    expect(getByText("EDITED — ONE-TIME CHANGES")).toBeTruthy();

    // The other seat is untouched by it.
    fireEvent.click(getByText("SEAT 2"));
    expect(queryByText("Kefir, no dill — Cucumber, dill")).toBeNull();

    fireEvent.click(getByText("CLEAR EDITS"));
    expect(queryByText("EDITED — ONE-TIME CHANGES")).toBeNull();
    expect(queryByText("✎ ONE-TIME EDIT — THIS SEAT ONLY")).toBeNull();
  });

  it("feeds one-time edits into the engine's seatOutputOverrides for the printed page", () => {
    const { getByText, getByDisplayValue, getByTitle } = renderWorkspace();
    fireEvent.click(getByText("Novak"));
    fireEvent.click(getByText("Kefir — Cucumber, dill"));
    fireEvent.change(getByDisplayValue("Kefir"), { target: { value: "Kefir, no dill" } });
    fireEvent.click(getByText("SAVE"));

    const html = getByTitle("Seat 1 menu preview").getAttribute("srcdoc");
    expect(html).toContain("Kefir, no dill");
  });

  it("shows each seat's restriction tags on its tab", () => {
    const { getByText } = renderWorkspace();
    fireEvent.click(getByText("Novak"));
    const seatTab = getByText("SEAT 1").parentElement;
    expect(within(seatTab).getByText("GLUTEN FREE")).toBeTruthy();
  });

  it("confirms both print actions with a toast and prints the engine's HTML", () => {
    const { doc } = mockPrintWindow();

    const { getByText } = renderWorkspace();
    fireEvent.click(getByText("Novak"));

    fireEvent.click(getByText("PRINT THIS SEAT"));
    expect(getByText("SEAT 1 SENT TO PRINT")).toBeTruthy();
    // The print window receives generateMenuHTML's page — the same engine as
    // the preview, not a second renderer.
    expect(doc.write).toHaveBeenCalledTimes(1);
    const html = doc.write.mock.calls[0][0];
    expect(html).toContain('id="sheet"');
    expect(html).toContain("menu-row");

    fireEvent.click(getByText("PRINT ALL 2 SEATS"));
    expect(getByText("2 SEAT MENUS SENT TO PRINT")).toBeTruthy();
    // ONE window, one combined document, one page per seat — not one pop-up
    // per seat (browsers only bless the first window.open of a gesture).
    expect(window.open).toHaveBeenCalledTimes(2); // print-this-seat + print-all
    expect(doc.write).toHaveBeenCalledTimes(2);
    const combined = doc.write.mock.calls[1][0];
    expect(combined.match(/class="print-page"/g)).toHaveLength(2);
    expect(combined).toContain("page-break-after");

    window.open.mockRestore();
  });

  it("clears every seat's one-time edits after PRINT ALL", () => {
    mockPrintWindow();
    const { getByText, queryByText, getByDisplayValue } = renderWorkspace();
    fireEvent.click(getByText("Novak"));
    fireEvent.click(getByText("Kefir — Cucumber, dill"));
    fireEvent.change(getByDisplayValue("Kefir"), { target: { value: "Kefir, no dill" } });
    fireEvent.click(getByText("SAVE"));
    expect(getByText("EDITED — ONE-TIME CHANGES")).toBeTruthy();

    fireEvent.click(getByText("PRINT ALL 2 SEATS"));
    expect(queryByText("EDITED — ONE-TIME CHANGES")).toBeNull();

    window.open.mockRestore();
  });

  it("does not claim success when the PRINT ALL window is blocked", () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    const { getByText, queryByText } = renderWorkspace();
    fireEvent.click(getByText("Novak"));
    fireEvent.click(getByText("PRINT ALL 2 SEATS"));
    expect(getByText("POP-UP BLOCKED — ALLOW POP-UPS TO PRINT")).toBeTruthy();
    expect(queryByText("2 SEAT MENUS SENT TO PRINT")).toBeNull();
    window.open.mockRestore();
  });

  it("clears a seat's one-time edits after that seat prints", () => {
    mockPrintWindow();
    const { getByText, queryByText, getByDisplayValue } = renderWorkspace();
    fireEvent.click(getByText("Novak"));
    fireEvent.click(getByText("Kefir — Cucumber, dill"));
    fireEvent.change(getByDisplayValue("Kefir"), { target: { value: "Kefir, no dill" } });
    fireEvent.click(getByText("SAVE"));
    expect(getByText("EDITED — ONE-TIME CHANGES")).toBeTruthy();

    fireEvent.click(getByText("PRINT THIS SEAT"));
    expect(queryByText("EDITED — ONE-TIME CHANGES")).toBeNull();
    expect(queryByText("Kefir, no dill — Cucumber, dill")).toBeNull();

    window.open.mockRestore();
  });

  it("says so instead of claiming success when the print window is blocked", () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    const { getByText, queryByText } = renderWorkspace();
    fireEvent.click(getByText("Novak"));
    fireEvent.click(getByText("PRINT THIS SEAT"));
    expect(getByText("POP-UP BLOCKED — ALLOW POP-UPS TO PRINT")).toBeTruthy();
    expect(queryByText("SEAT 1 SENT TO PRINT")).toBeNull();
    window.open.mockRestore();
  });

  it("adds a quick-access aperitif to the seat through upd", () => {
    const updCalls = [];
    const { getByText, getAllByText } = renderWorkspace({
      updCalls,
      aperitifOptions: [{ label: "Cremant" }],
    });
    fireEvent.click(getByText("Novak"));
    fireEvent.click(getByText("▼ DRINKS + EXTRAS"));
    fireEvent.click(getByText("Cremant"));

    expect(updCalls.length).toBe(1);
    expect(updCalls[0][1]).toBe("seats");
    // The seat now carries the aperitif (chip rendered from the live seat).
    expect(getAllByText(/Cremant/).length).toBeGreaterThan(1);
  });
});
