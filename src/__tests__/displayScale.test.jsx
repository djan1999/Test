import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDisplayScale, SCALE_MIN, SCALE_MAX } from "../hooks/useDisplayScale.js";

const KEY = "milka_display_scale";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.style.zoom = "";
});

describe("useDisplayScale", () => {
  it("defaults to 1 (100%) when nothing is stored", () => {
    const { result } = renderHook(() => useDisplayScale());
    expect(result.current.scale).toBe(1);
  });

  it("hydrates from the persisted device value on mount", () => {
    localStorage.setItem(KEY, "0.7");
    const { result } = renderHook(() => useDisplayScale());
    expect(result.current.scale).toBe(0.7);
  });

  it("zoomOut steps down by 0.1 and persists", () => {
    const { result } = renderHook(() => useDisplayScale());
    act(() => result.current.zoomOut());
    expect(result.current.scale).toBe(0.9);
    expect(localStorage.getItem(KEY)).toBe("0.9");
  });

  it("zoomIn steps up by 0.1 and persists", () => {
    const { result } = renderHook(() => useDisplayScale());
    act(() => result.current.zoomIn());
    expect(result.current.scale).toBe(1.1);
    expect(localStorage.getItem(KEY)).toBe("1.1");
  });

  it("stays on the 0.1 grid across repeated steps (no float drift)", () => {
    const { result } = renderHook(() => useDisplayScale());
    act(() => result.current.zoomOut()); // 0.9
    act(() => result.current.zoomOut()); // 0.8
    act(() => result.current.zoomOut()); // 0.7
    expect(result.current.scale).toBe(0.7);
  });

  it("clamps at the minimum", () => {
    localStorage.setItem(KEY, String(SCALE_MIN));
    const { result } = renderHook(() => useDisplayScale());
    act(() => result.current.zoomOut());
    expect(result.current.scale).toBe(SCALE_MIN);
  });

  it("clamps at the maximum", () => {
    localStorage.setItem(KEY, String(SCALE_MAX));
    const { result } = renderHook(() => useDisplayScale());
    act(() => result.current.zoomIn());
    expect(result.current.scale).toBe(SCALE_MAX);
  });

  it("clamps an out-of-range stored value back into bounds", () => {
    localStorage.setItem(KEY, "9");
    const { result } = renderHook(() => useDisplayScale());
    expect(result.current.scale).toBe(SCALE_MAX);
  });

  it("ignores a corrupt stored value and falls back to 1", () => {
    localStorage.setItem(KEY, "not-a-number");
    const { result } = renderHook(() => useDisplayScale());
    expect(result.current.scale).toBe(1);
  });

  it("reset returns to 100%", () => {
    localStorage.setItem(KEY, "0.6");
    const { result } = renderHook(() => useDisplayScale());
    act(() => result.current.reset());
    expect(result.current.scale).toBe(1);
    expect(localStorage.getItem(KEY)).toBe("1");
  });
});
