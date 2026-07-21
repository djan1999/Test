import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const { signInWithPassword, signUp, setRememberMe } = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  setRememberMe: vi.fn(),
}));

vi.mock("../lib/supabaseClient.js", () => ({
  supabase: { auth: { signInWithPassword, signUp, resetPasswordForEmail: vi.fn() } },
  setRememberMe,
  getRememberMe: () => true,
}));

import AuthScreen from "../components/auth/AuthScreen.jsx";
import ProfilePicker from "../components/auth/ProfilePicker.jsx";

describe("restaurant-owner account entry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    signUp.mockResolvedValue({ data: { user: { id: "owner-id" }, session: null }, error: null });
  });

  it("offers account creation on the login screen and routes email confirmation to onboarding", async () => {
    render(<AuthScreen managedOnboardingEnabled />);

    fireEvent.click(screen.getByRole("button", { name: "Create a restaurant account" }));
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "owner@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "safe-password" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "safe-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => expect(signUp).toHaveBeenCalledWith({
      email: "owner@example.com",
      password: "safe-password",
      options: { emailRedirectTo: expect.stringMatching(/\/platform-onboarding$/) },
    }));
    expect(await screen.findByText(/Account created\. Check your email/i)).toBeInTheDocument();
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it("catches a mistyped password before calling Supabase", () => {
    render(<AuthScreen managedOnboardingEnabled />);
    fireEvent.click(screen.getByRole("button", { name: "Create a restaurant account" }));
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "owner@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "safe-password" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "different-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(screen.getByRole("alert")).toHaveTextContent("The two passwords do not match.");
    expect(signUp).not.toHaveBeenCalled();
  });

  it("gives signed-in accounts without a workspace a direct creation link", () => {
    render(<ProfilePicker workspaces={[]} managedOnboardingEnabled />);
    expect(screen.getByRole("link", { name: "create your restaurant" }))
      .toHaveAttribute("href", "/platform-onboarding");
  });
});
