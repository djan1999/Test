import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("../components/floor/FloorEditor.jsx", () => ({ default: () => <div data-testid="floor-editor" /> }));

import FloorPanel from "../components/admin/FloorPanel.jsx";
import { buildDefaultFloorMaps } from "../utils/floorMaps.js";

const reservation = (id, table_id) => ({
  id, table_id, date: "2026-07-15", data: { resName: `Guest ${id}`, service_session: "dinner", tableGroup: [] },
});
const renderPanel = (overrides = {}) => {
  const props = {
    floorMaps: buildDefaultFloorMaps(), tableIds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    reservations: [reservation("r2", 2)], boardTables: [],
    onUpdateFloorMaps: vi.fn(), onApplyLayoutSwitch: vi.fn(async () => ({ ok: true })),
    ...overrides,
  };
  render(<FloorPanel {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "LAYOUT B" }));
  return props;
};

describe("FloorPanel layout activation readiness", () => {
  it("blocks unresolved NEEDS TABLE plans", () => {
    const props = renderPanel({ reservations: [reservation("r5", 5)] });
    expect(screen.getByRole("button", { name: "CONFIRM SWITCH" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("Resolve every conflict");
    expect(props.onApplyLayoutSwitch).not.toHaveBeenCalled();
  });

  it("retains the active layout and surfaces an accessible error when the batch fails", async () => {
    const props = renderPanel({ onApplyLayoutSwitch: vi.fn(async () => ({ ok: false, error: new Error("batch offline") })) });
    fireEvent.click(screen.getByRole("button", { name: "CONFIRM SWITCH" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("batch offline"));
    expect(props.onUpdateFloorMaps).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "LAYOUT A" })).toBeInTheDocument();
  });

  it("shows SAVING and waits for reservation persistence before activation", async () => {
    let resolveBatch;
    const batch = new Promise((resolve) => { resolveBatch = resolve; });
    const props = renderPanel({ onApplyLayoutSwitch: vi.fn(() => batch) });
    fireEvent.click(screen.getByRole("button", { name: "CONFIRM SWITCH" }));
    expect(await screen.findByRole("button", { name: "SAVING…" })).toBeDisabled();
    expect(props.onUpdateFloorMaps).not.toHaveBeenCalled();
    resolveBatch({ ok: true });
    await waitFor(() => expect(props.onUpdateFloorMaps).toHaveBeenCalledTimes(1));
  });
});
