import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const requestWorkspaceMembers = vi.fn();
vi.mock("../lib/workspaceMembers.js", () => ({
  requestWorkspaceMembers: (...args) => requestWorkspaceMembers(...args),
}));

import SetupChecklistPanel from "../components/admin/SetupChecklistPanel.jsx";
import { buildDefaultFloorMaps } from "../utils/floorMaps.js";
import { makeDefaultRestaurantConfig } from "../config/restaurantConfig.js";

const renderPanel = (overrides = {}) => {
  const props = {
    restaurantConfig: makeDefaultRestaurantConfig({ name: "Gostilna Test" }),
    floorMaps: buildDefaultFloorMaps(),
    menuCourses: [{ course_key: "main", is_active: true, menu: { name: "Beef cheek" } }],
    restrictionsList: [{ key: "gluten", label: "Gluten" }],
    accessToken: "token",
    workspaceId: "ws-1",
    onNavigate: vi.fn(),
    ...overrides,
  };
  render(<SetupChecklistPanel {...props} />);
  return props;
};

beforeEach(() => {
  requestWorkspaceMembers.mockReset();
  requestWorkspaceMembers.mockResolvedValue({
    members: [
      { user_id: "u1", role: "admin" },
      { user_id: "u2", role: "service" },
      { user_id: "u3", role: "kitchen" },
    ],
  });
});

describe("setup checklist panel", () => {
  it("states the verdict in one line", async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/ready to run a service/i));
  });

  it("lists all eight steps in order", () => {
    renderPanel();
    expect(screen.getAllByRole("listitem")).toHaveLength(8);
  });

  it("jumps to the panel that fixes a step", () => {
    const props = renderPanel();
    fireEvent.click(screen.getAllByRole("button", { name: "OPEN" })[0]);
    expect(props.onNavigate).toHaveBeenCalledWith("restaurant");
  });

  it("keeps the other seven steps readable when the staff list cannot be read", async () => {
    requestWorkspaceMembers.mockRejectedValue(new Error("members endpoint unreachable"));
    renderPanel();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/members endpoint unreachable/i));
    expect(screen.getAllByRole("listitem")).toHaveLength(8);
  });

  it("does not fetch staff before a workspace is known", () => {
    renderPanel({ accessToken: null, workspaceId: null });
    expect(requestWorkspaceMembers).not.toHaveBeenCalled();
  });

  it("names the first blocker when the restaurant cannot open yet", async () => {
    renderPanel({ menuCourses: [] });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/must be finished/i));
    expect(screen.getByText(/start with/i)).toBeInTheDocument();
  });
});
