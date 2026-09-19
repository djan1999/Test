import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ rows: [], fail: false, save: vi.fn() }));
vi.mock("../lib/supabaseClient.js", () => ({ supabase: {}, getWorkspaceId: () => "inventory-test" }));
vi.mock("../lib/stateStore.js", () => ({
  readStatePrefix: async () => { if (h.fail) throw new Error("offline"); return h.rows; },
  readStateKey: async () => null, pendingStateKeys: () => [], saveStateKey: h.save,
}));
import InventoryModal from "../components/modals/InventoryModal.jsx";
import { invalidateLiveData } from "../lib/liveData.js";
beforeEach(() => {
  localStorage.clear(); localStorage.setItem("milka-inv-did", "mine");
  h.fail = false; h.rows = []; h.save.mockReset().mockResolvedValue({ ok: true });
});
const mount = () => render(<InventoryModal wines={[{ id: "wine", name: "Wine" }]} onClose={() => {}} />);
describe("inventory refresh and saves", () => {
  it("queues a count immediately so closing the window cannot cancel it", async () => {
    const view = mount(); await screen.findByText("SYNCED");
    fireEvent.click(screen.getByText("+")); view.unmount();
    expect(h.save).toHaveBeenCalledWith("inventory_device:mine", expect.objectContaining({ counts: { wine: 1 } }));
  });
  it("refreshes other devices, including deletions, while keeping this device's count", async () => {
    h.rows = [{ id: "inventory_device:other", state: { label: "Other", counts: { wine: 3 } } }];
    mount(); await screen.findByText("Other: 3");
    fireEvent.click(screen.getByText("+"));
    h.rows = []; await act(() => invalidateLiveData("service_settings"));
    expect(screen.queryByText("Other: 3")).toBeNull(); expect(screen.getByRole("spinbutton")).toHaveValue(1);
  });
  it("keeps the last successful inventory when a refresh fails", async () => {
    h.rows = [{ id: "inventory_device:other", state: { label: "Other", counts: { wine: 3 } } }];
    mount(); await screen.findByText("Other: 3"); h.fail = true;
    await act(() => invalidateLiveData("service_settings"));
    await waitFor(() => expect(screen.getByText("SYNC ERROR")).toBeInTheDocument());
    expect(screen.getByText("Other: 3")).toBeInTheDocument();
  });
});
