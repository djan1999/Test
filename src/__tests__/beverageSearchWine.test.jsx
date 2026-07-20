import { fireEvent, render } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import BeverageSearch from "../components/service/BeverageSearch.jsx";

const glassWine = { id: "w1", name: "Rebula", producer: "Klinec", vintage: "2022", byGlass: true };
const bottleWine = { id: "w2", name: "Lunar", producer: "Movia", vintage: "2016", byGlass: false };

function renderSearch(wines, onAdd = vi.fn()) {
  const utils = render(
    <BeverageSearch wines={wines} cocktails={[]} spirits={[]} beers={[]} onAdd={onAdd} />,
  );
  return { ...utils, onAdd };
}

describe("BeverageSearch wine offering", () => {
  it("offers a by-the-glass wine as both a glass and a bottle", () => {
    const { getByPlaceholderText, getAllByText } = renderSearch([glassWine]);
    fireEvent.change(getByPlaceholderText("search beverages…"), { target: { value: "rebula" } });
    // Two dropdown rows: one Glass badge, one Bottle badge, same wine.
    expect(getAllByText("Glass")).toHaveLength(1);
    expect(getAllByText("Bottle")).toHaveLength(1);
    expect(getAllByText("Rebula")).toHaveLength(2);
  });

  it("adds the bottle option with byGlass:false so it renders as a bottle chip", () => {
    const { getByPlaceholderText, getByText, onAdd } = renderSearch([glassWine]);
    fireEvent.change(getByPlaceholderText("search beverages…"), { target: { value: "rebula" } });
    fireEvent.mouseDown(getByText("Bottle"));
    expect(onAdd).toHaveBeenCalledTimes(1);
    const entry = onAdd.mock.calls[0][0];
    expect(entry.type).toBe("bottle");
    expect(entry.item.byGlass).toBe(false);
    expect(entry.item.name).toBe("Rebula");
  });

  it("adds the glass option keeping the original by-the-glass wine", () => {
    const { getByPlaceholderText, getByText, onAdd } = renderSearch([glassWine]);
    fireEvent.change(getByPlaceholderText("search beverages…"), { target: { value: "rebula" } });
    fireEvent.mouseDown(getByText("Glass"));
    expect(onAdd).toHaveBeenCalledWith(
      expect.objectContaining({ type: "wine", item: expect.objectContaining({ byGlass: true }) }),
    );
  });

  it("offers a bottle-only wine only as a bottle", () => {
    const { getByPlaceholderText, getAllByText, queryByText } = renderSearch([bottleWine]);
    fireEvent.change(getByPlaceholderText("search beverages…"), { target: { value: "lunar" } });
    expect(getAllByText("Bottle")).toHaveLength(1);
    expect(queryByText("Glass")).toBeNull();
  });
});
