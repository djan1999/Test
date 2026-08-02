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

const renderWorkspace = (props = {}) =>
  render(<MenuWorkspace tables={[TABLE]} menuCourses={COURSES} {...props} />);

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

    // Seat 1 carries the gluten restriction — its žganci is substituted.
    expect(getByText("SUBSTITUTED FOR [GLUTEN FREE] — WAS: Žganci")).toBeTruthy();
    expect(getByText("Polenta — Porcini, aged Tolminc")).toBeTruthy();

    // Seat 2 carries nothing, so the same course prints unchanged.
    fireEvent.click(getByText("SEAT 2"));
    expect(queryByText(/SUBSTITUTED FOR/)).toBeNull();
    expect(getByText("Žganci — Pork crackling")).toBeTruthy();
  });

  it("re-runs generation on every option change — there is no generate button", () => {
    const { getByText, queryByText } = renderWorkspace();
    fireEvent.click(getByText("Novak"));
    expect(queryByText("Rebula · Goriška Brda")).toBeNull();

    fireEvent.click(getByText("WINE"));
    expect(getByText("Rebula · Goriška Brda")).toBeTruthy();

    fireEvent.click(getByText("WINE"));
    expect(queryByText("Rebula · Goriška Brda")).toBeNull();
  });

  /**
   * The one layout invariant this screen cannot get wrong: the edit input and
   * the course text must each own a full flex line. Sharing one collapses the
   * text column and wraps the dish one word per line.
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

  it("shows each seat's restriction tags on its tab", () => {
    const { getByText } = renderWorkspace();
    fireEvent.click(getByText("Novak"));
    const seatTab = getByText("SEAT 1").parentElement;
    expect(within(seatTab).getByText("GLUTEN FREE")).toBeTruthy();
  });

  it("confirms both print actions with a toast", () => {
    const print = vi.fn();
    const doc = { write: vi.fn(), close: vi.fn() };
    vi.spyOn(window, "open").mockReturnValue({ document: doc, focus: vi.fn(), print });

    const { getByText } = renderWorkspace();
    fireEvent.click(getByText("Novak"));

    fireEvent.click(getByText("PRINT THIS SEAT"));
    expect(getByText("SEAT 1 SENT TO PRINT")).toBeTruthy();

    fireEvent.click(getByText("PRINT ALL 2 SEATS"));
    expect(getByText("2 SEAT MENUS SENT TO PRINT")).toBeTruthy();

    window.open.mockRestore();
  });

  it("says so instead of claiming success when the print window is blocked", () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    const { getByText } = renderWorkspace();
    fireEvent.click(getByText("Novak"));
    fireEvent.click(getByText("PRINT THIS SEAT"));
    expect(getByText("POP-UP BLOCKED — ALLOW POP-UPS TO PRINT")).toBeTruthy();
    window.open.mockRestore();
  });
});
