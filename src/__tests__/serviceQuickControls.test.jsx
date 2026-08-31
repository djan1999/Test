import { fireEvent, render } from "@testing-library/react";
import { DisplayBoardCard, optionalExtrasFromCourses } from "../App.jsx";

const table = (seat) => ({
  id: 1,
  active: true,
  guests: 1,
  resName: "TEST",
  restrictions: [],
  seats: [{
    id: 1,
    gender: null,
    pairingSharedWith: null,
    water: "—",
    pairing: "",
    aperitifs: [],
    glasses: [],
    cocktails: [],
    spirits: [],
    beers: [],
    extras: {},
    optionalPairings: {},
    ...seat,
  }],
});

describe("service quick controls", () => {
  it("clears an active per-seat water shortcut on the second tap", () => {
    const updSeat = vi.fn();
    const { getAllByText } = render(
      <DisplayBoardCard t={table({ water: "XC" })} quickMode updSeat={updSeat} aperitifOptions={[]} />,
    );
    const xcButtons = getAllByText("XC");
    fireEvent.click(xcButtons[xcButtons.length - 1]);
    expect(updSeat).toHaveBeenCalledWith(1, 1, "water", "—");
  });

  it("cycles back to a truly empty pairing instead of storing a dash", () => {
    const updSeat = vi.fn();
    const { getByText } = render(
      <DisplayBoardCard t={table({ pairing: "Our Story" })} quickMode updSeat={updSeat} aperitifOptions={[]} />,
    );
    fireEvent.click(getByText("Our Story"));
    expect(updSeat).toHaveBeenCalledWith(1, 1, "pairing", "");
  });

  it("Send carries the restricted seat's dish modification into the kitchen alert", () => {
    // End-to-end through App's OWN extras builder: a def built by hand can
    // hide this file dropping the course row, which is exactly how a nut
    // guest's beetroot once reached the kitchen popup as a plain call.
    const beetCourse = {
      course_category: "optional", optional_flag: "beetroot", course_key: "beetroot",
      menu: { name: "Beetroot", sub: "" },
      restrictions: { nut_note: "no hazelnut oil" },
    };
    const dishes = optionalExtrasFromCourses([beetCourse]);
    const upd = vi.fn();
    const t = {
      ...table({ extras: { beetroot: { ordered: true } } }),
      restrictions: [{ pos: 1, note: "nut" }],
    };
    const { getByText } = render(
      <DisplayBoardCard t={t} quickMode upd={upd} updSeat={vi.fn()} optionalExtras={dishes} aperitifOptions={[]} />,
    );
    fireEvent.click(getByText("Send"));
    const alertCall = upd.mock.calls.find((c) => c[1] === "kitchenAlert");
    expect(alertCall).toBeTruthy();
    const extra = alertCall[2].seats[0].extras.find((e) => e.key === "beetroot");
    expect(extra.restriction).toBe("NO HAZELNUT OIL");
  });

  it("does not render a no-pairing placeholder chip in normal service view", () => {
    const { queryByText, getByText } = render(
      <DisplayBoardCard t={table({ water: "XC", pairing: "—" })} quickMode={false} aperitifOptions={[]} />,
    );
    getByText("XC");
    expect(queryByText("—")).toBeNull();
  });
});
