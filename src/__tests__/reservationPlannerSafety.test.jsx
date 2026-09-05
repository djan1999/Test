import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import ReservationManager from "../components/reservations/ReservationManager.jsx";
import { blankTable } from "../utils/tableHelpers.js";

vi.mock("../components/reservations/GuestMemory.jsx", () => ({ default: () => null }));
const rows = [
  { id: "one", date: "2026-09-01", table_id: 4, data: { resName: "Žan Example", resTime: "19:00", guests: 2 } },
  { id: "two", date: "2026-10-02", table_id: 6, data: { resName: "Other Guest", resTime: "18:30", guests: 2 } },
];

describe("reservation planner search and save", () => {
  it("finds a guest outside the current week, preserves a failed edit, then closes after retry", async () => {
    const onUpsert = vi.fn().mockResolvedValueOnce({ ok: false, error: new Error("Save refused") }).mockResolvedValueOnce({ ok: true });
    render(<ReservationManager reservations={rows} menuCourses={[]} tables={[blankTable(4), blankTable(6)]} onUpsert={onUpsert} onExit={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Find a reservation"), { target: { value: "zan" } });
    expect(screen.getByRole("status")).toHaveTextContent("1 matching reservation");
    fireEvent.click(screen.getByRole("button", { name: /Žan Example/ }));
    const dialog = screen.getByRole("dialog", { name: /EDIT RESERVATION/ });
    fireEvent.change(within(dialog).getByPlaceholderText("Guest name…"), { target: { value: "Changed guest" } });
    fireEvent.click(within(dialog).getByText("SAVE"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Save refused");
    expect(screen.getByPlaceholderText("Guest name…")).toHaveValue("Changed guest");
    fireEvent.click(screen.getByText("SAVE"));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /EDIT RESERVATION/ })).toBeNull());
    expect(onUpsert.mock.calls[1][0]).toMatchObject({ id: "one", date: "2026-09-01", data: { resName: "Changed guest" } });
  });
});
