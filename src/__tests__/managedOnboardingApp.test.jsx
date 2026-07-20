import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const { requestManagedRestaurants, getSession } = vi.hoisted(() => ({
  requestManagedRestaurants: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock("../lib/supabaseClient.js", () => ({
  hasSupabaseConfig: true,
  supabase: { auth: { getSession } },
}));

vi.mock("../lib/managedOnboarding.js", () => ({ requestManagedRestaurants }));

import ManagedOnboardingApp from "../components/onboarding/ManagedOnboardingApp.jsx";

describe("managed onboarding screen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("scrollTo", vi.fn());
    getSession.mockResolvedValue({ data: { session: { access_token: "token" } }, error: null });
    requestManagedRestaurants.mockResolvedValue({
      ok: true,
      operator: { id: "operator-id", email: "operator@example.com" },
      restaurants: [],
    });
  });

  it("requires a reviewed setup before creating an isolated restaurant", async () => {
    render(<ManagedOnboardingApp />);
    expect(await screen.findByRole("heading", { name: "Create a restaurant" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Restaurant name"), { target: { value: "Nova" } });
    fireEvent.change(screen.getByLabelText(/^Admin email/), { target: { value: "admin@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /review setup/i }));

    expect(await screen.findByText("Nothing live is copied or changed.")).toBeInTheDocument();
    expect(screen.getByText("nova")).toBeInTheDocument();
    expect(requestManagedRestaurants).toHaveBeenCalledTimes(1);

    requestManagedRestaurants.mockResolvedValueOnce({
      ok: true,
      invited: true,
      restaurant: { id: "workspace-id", name: "Nova", slug: "nova", tableCount: 10 },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create restaurant" }));

    await waitFor(() => expect(requestManagedRestaurants).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("RESTAURANT CREATED")).toBeInTheDocument();
    expect(screen.getByText(/secure Admin invitation was sent/i)).toBeInTheDocument();
  });

  it("does not expose the form when the signed-in account is denied", async () => {
    requestManagedRestaurants.mockRejectedValueOnce(new Error("This account cannot create restaurants."));
    render(<ManagedOnboardingApp />);
    expect(await screen.findByText("This account cannot create restaurants.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Restaurant name")).not.toBeInTheDocument();
  });
});
