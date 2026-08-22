import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import LoginScreen from "../components/login/LoginScreen.jsx";

// The gate's FULLSCREEN toggle (22.08 — it replaced the wine-sync button;
// the sync lives on in Admin → Inventory / System). jsdom has no Fullscreen
// API, so a minimal one is installed here: without it the button must not
// render at all (unsupported surfaces hide it).

describe("gate FULLSCREEN toggle", () => {
  let fsElement = null;
  const request = vi.fn(() => {
    fsElement = document.documentElement;
    document.dispatchEvent(new Event("fullscreenchange"));
    return Promise.resolve();
  });
  const exit = vi.fn(() => {
    fsElement = null;
    document.dispatchEvent(new Event("fullscreenchange"));
    return Promise.resolve();
  });

  beforeEach(() => {
    fsElement = null;
    request.mockClear();
    exit.mockClear();
    document.documentElement.requestFullscreen = request;
    document.exitFullscreen = exit;
    Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => fsElement });
  });
  afterEach(() => {
    delete document.documentElement.requestFullscreen;
    delete document.exitFullscreen;
    delete document.fullscreenElement;
  });

  it("replaces the wine sync: no SYNC WINES on the gate, for admins either", () => {
    const { queryByText } = render(<LoginScreen onEnter={vi.fn()} role="admin" />);
    expect(queryByText(/SYNC WINES/)).toBeNull();
  });

  it("toggles: FULLSCREEN requests, the label flips, EXIT FULLSCREEN exits", () => {
    const { getByText } = render(<LoginScreen onEnter={vi.fn()} role="kitchen" />);
    fireEvent.click(getByText("FULLSCREEN"));
    expect(request).toHaveBeenCalled();
    fireEvent.click(getByText("EXIT FULLSCREEN")); // change event flipped the label
    expect(exit).toHaveBeenCalled();
    getByText("FULLSCREEN"); // and back
  });

  it("hides itself where the Fullscreen API does not exist", () => {
    delete document.documentElement.requestFullscreen;
    const { queryByText } = render(<LoginScreen onEnter={vi.fn()} role="service" />);
    expect(queryByText("FULLSCREEN")).toBeNull();
  });
});
