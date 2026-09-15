import { fireEvent, render } from "@testing-library/react";
import QuickBeverageSearch from "../components/service/QuickBeverageSearch.jsx";

describe("QuickBeverageSearch", () => {
  it("opens on demand, searches the complete catalog and returns the picked item", () => {
    const onAdd = vi.fn();
    const negroni = { id: "c1", name: "Negroni", notes: "bitter" };
    const { getByLabelText, getByPlaceholderText, getByText, queryByPlaceholderText } = render(
      <QuickBeverageSearch
        wines={[{ id: "w1", name: "Rebula", producer: "Klinec", vintage: "2022", byGlass: true }]}
        cocktails={[negroni]}
        spirits={[{ id: "s1", name: "Gin", notes: "dry" }]}
        beers={[{ id: "b1", name: "Lager", notes: "light" }]}
        onAdd={onAdd}
      />,
    );

    fireEvent.click(getByLabelText("Search all beverages for an aperitif"));
    const input = getByPlaceholderText("find any beverage for aperitif…");
    fireEvent.change(input, { target: { value: "negr" } });
    fireEvent.mouseDown(getByText("Negroni"));

    expect(onAdd).toHaveBeenCalledWith(negroni);
    expect(queryByPlaceholderText("find any beverage for aperitif…")).toBeNull();
  });

  it("takes the wording of whichever moment it is serving", () => {
    // One control, two ends of the menu. Its label has to say which, or the
    // digestivo row offers a server a button about the aperitif.
    const { getByLabelText, getByPlaceholderText } = render(
      <QuickBeverageSearch
        spirits={[{ id: "s1", name: "Chartreuse", notes: "herbal" }]}
        ariaLabel="Search all beverages for a digestivo"
        placeholder="find any beverage for digestivo…"
        onAdd={vi.fn()}
      />,
    );
    fireEvent.click(getByLabelText("Search all beverages for a digestivo"));
    expect(getByPlaceholderText("find any beverage for digestivo…")).toBeTruthy();
  });
});
