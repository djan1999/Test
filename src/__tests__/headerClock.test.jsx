import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import Header from "../components/ui/Header.jsx";
import { formatClock } from "../hooks/useClock.js";

// The kitchen panel's only clock. These pin the two things that make it
// trustworthy at the pass: 24-hour reading regardless of device locale, and a
// tick that lands on the minute instead of drifting behind it.
describe("header clock", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 10, 19, 42, 47));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const renderHeader = (props = {}) =>
    act(() => { render(<Header modeLabel="KITCHEN" showClock onExit={vi.fn()} {...props} />); });

  it("shows the wall clock in 24-hour time", () => {
    renderHeader();
    expect(screen.getByText("19:42")).toBeInTheDocument();
  });

  it("formats an evening hour as 19:05, never 7:05 PM", () => {
    expect(formatClock(new Date(2026, 7, 10, 19, 5))).toBe("19:05");
    expect(formatClock(new Date(2026, 7, 10, 0, 0))).toBe("00:00");
    expect(formatClock(new Date(2026, 7, 10, 9, 7))).toBe("09:07");
  });

  it("flips on the minute boundary, not 60s after mount", () => {
    renderHeader();
    expect(screen.getByText("19:42")).toBeInTheDocument();

    // 13s and change remain of 19:42. A flat 60s interval would still be
    // showing 19:42 here — and would stay a further 47s behind all night.
    act(() => { vi.advanceTimersByTime(13_100); });
    expect(screen.getByText("19:43")).toBeInTheDocument();

    // And every minute after it stays anchored to the boundary.
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(screen.getByText("19:44")).toBeInTheDocument();
  });

  it("re-reads the time when a slept panel wakes", () => {
    renderHeader();
    expect(screen.getByText("19:42")).toBeInTheDocument();

    // Panel asleep: timers frozen, the world moved on two hours.
    act(() => {
      vi.setSystemTime(new Date(2026, 7, 10, 21, 15, 3));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(screen.getByText("21:15")).toBeInTheDocument();
  });

  it("stays out of the service header, which has an OS clock above it", () => {
    act(() => { render(<Header modeLabel="SERVICE" onExit={vi.fn()} />); });
    expect(screen.queryByText("19:42")).not.toBeInTheDocument();
  });
});
