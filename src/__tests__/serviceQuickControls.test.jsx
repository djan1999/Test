import { fireEvent, render } from "@testing-library/react";
import { DisplayBoardCard } from "../App.jsx";

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

  it("does not render a no-pairing placeholder chip in normal service view", () => {
    const { queryByText, getByText } = render(
      <DisplayBoardCard t={table({ water: "XC", pairing: "—" })} quickMode={false} aperitifOptions={[]} />,
    );
    getByText("XC");
    expect(queryByText("—")).toBeNull();
  });
});
