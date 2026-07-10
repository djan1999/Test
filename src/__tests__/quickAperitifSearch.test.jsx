import { fireEvent, render } from "@testing-library/react";
import QuickAperitifSearch from "../components/service/QuickAperitifSearch.jsx";

describe("QuickAperitifSearch", () => {
  it("opens on demand, searches the complete catalog and returns the picked item", () => {
    const onAdd = vi.fn();
    const negroni = { id: "c1", name: "Negroni", notes: "bitter" };
    const { getByLabelText, getByPlaceholderText, getByText, queryByPlaceholderText } = render(
      <QuickAperitifSearch
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
});
