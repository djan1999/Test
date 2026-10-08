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

  it("Left / Right sit beside Mr/Mrs and toggle the seat's hand", () => {
    const updSeat = vi.fn();
    const { getByLabelText, rerender } = render(
      <DisplayBoardCard t={table()} quickMode updSeat={updSeat} aperitifOptions={[]} />,
    );
    fireEvent.click(getByLabelText("P1 left-handed"));
    expect(updSeat).toHaveBeenCalledWith(1, 1, "hand", "L");
    rerender(<DisplayBoardCard t={table({ hand: "L" })} quickMode updSeat={updSeat} aperitifOptions={[]} />);
    // second tap clears it, the same as Mr/Mrs
    fireEvent.click(getByLabelText("P1 left-handed"));
    expect(updSeat).toHaveBeenLastCalledWith(1, 1, "hand", null);
    fireEvent.click(getByLabelText("P1 right-handed"));
    expect(updSeat).toHaveBeenLastCalledWith(1, 1, "hand", "R");
  });

  it("the 🎂 seat toggle appears only on a birthday table", () => {
    const updSeat = vi.fn();
    const { queryByLabelText, rerender } = render(
      <DisplayBoardCard t={table()} quickMode updSeat={updSeat} aperitifOptions={[]} />,
    );
    expect(queryByLabelText("P1 birthday guest")).toBeNull();
    rerender(<DisplayBoardCard t={{ ...table(), birthday: true }} quickMode updSeat={updSeat} aperitifOptions={[]} />);
    fireEvent.click(queryByLabelText("P1 birthday guest"));
    expect(updSeat).toHaveBeenCalledWith(1, 1, "celebrating", true);
  });

  it("SAME FOR ALL copies P1 at once onto empty chairs, and asks first over existing orders", () => {
    const two = (p2) => ({ ...table({ water: "XC", pairing: "Wine" }), guests: 2,
      seats: [...table({ water: "XC", pairing: "Wine" }).seats, { ...table().seats[0], id: 2, gender: "Mr", ...p2 }] });
    const upd = vi.fn();
    const { getByLabelText, queryByLabelText, rerender } = render(
      <DisplayBoardCard t={two({})} quickMode upd={upd} updSeat={vi.fn()} aperitifOptions={[]} />,
    );
    // only P1 carries it
    expect(queryByLabelText("Copy P2 to all seats")).toBeNull();
    fireEvent.click(getByLabelText("Copy P1 to all seats"));
    const call = upd.mock.calls.find((c) => c[1] === "seats");
    const next = call[2](two({}).seats);
    expect(next[1]).toMatchObject({ id: 2, water: "XC", pairing: "Wine", gender: "Mr" });

    upd.mockClear();
    rerender(<DisplayBoardCard t={two({ water: "OW" })} quickMode upd={upd} updSeat={vi.fn()} aperitifOptions={[]} />);
    fireEvent.click(getByLabelText("Copy P1 to all seats"));
    expect(upd.mock.calls.find((c) => c[1] === "seats")).toBeUndefined(); // armed, not applied
    fireEvent.click(getByLabelText("Confirm copy P1 to all seats"));
    expect(upd.mock.calls.find((c) => c[1] === "seats")).toBeTruthy();
  });

  it("cycles back to a truly empty pairing instead of storing a dash", () => {
    // The pairing cycle writes through the seats updater because it also has
    // to clear BTG/BTB — the two answer the same question about one chair.
    const upd = vi.fn();
    const { getByText } = render(
      <DisplayBoardCard t={table({ pairing: "Our Story" })} quickMode upd={upd} updSeat={vi.fn()} aperitifOptions={[]} />,
    );
    fireEvent.click(getByText("Our Story"));
    const seatsCall = upd.mock.calls.find((c) => c[1] === "seats");
    expect(seatsCall).toBeTruthy();
    const next = seatsCall[2](table().seats);
    expect(next[0].pairing).toBe("");
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
