import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ values: {}, save: vi.fn() }));
vi.mock("../lib/supabaseClient.js", () => ({ supabase: {}, getWorkspaceId: () => "menu-test", TABLES: {} }));
vi.mock("../lib/stateStore.js", () => ({
  readStateKey: async key => h.values[key] ?? null,
  pendingStateKeys: () => [], saveStateKey: h.save,
}));
import MenuWorkspace from "../components/menu/MenuWorkspace.jsx";
import { invalidateLiveData } from "../lib/liveData.js";
const input = label => screen.getByText(label).parentElement.querySelector("input");

beforeEach(() => {
  localStorage.clear(); h.save.mockReset().mockResolvedValue({ ok: true });
  h.values = { menu_gen_title: { en: "Dinner", si: "Večerja" },
    menu_gen_team: { value: "Original team" }, menu_gen_thankyou: { en: "Thanks", si: "Hvala" } };
});
describe("menu text synchronization", () => {
  it("adopts remote edits and deliberate empty values without writing them back", async () => {
    render(<MenuWorkspace initialTableId={1} tables={[{ id: 1, active: true, resName: "Guest", guests: 1, seats: [{ id: 1 }], lang: "en" }]} menuCourses={[]} />);
    await waitFor(() => expect(input("MENU TITLE")).toHaveValue("Dinner"));
    h.values.menu_gen_title.en = "Updated dinner";
    h.values.menu_gen_team.value = "";
    h.values.menu_gen_thankyou.en = "";
    await act(() => invalidateLiveData("service_settings"));
    expect(input("MENU TITLE")).toHaveValue("Updated dinner");
    expect(input("TEAM")).toHaveValue(""); expect(input("THANK-YOU LINE")).toHaveValue("");
    expect(h.save).not.toHaveBeenCalled();
    fireEvent.change(input("MENU TITLE"), { target: { value: "My edit" } });
    expect(h.save).toHaveBeenCalledWith("menu_gen_title", { en: "My edit", si: "Večerja" });
  });
});
