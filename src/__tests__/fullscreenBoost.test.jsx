import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useFullscreenBoost } from "../hooks/useIsFullscreen.js";

// The fullscreen SCALE-UP is space-gated, not flag-gated (per Djan, 22.08):
// the installed PWA runs in fullscreen display-mode permanently, so on a
// tablet the fullscreen flag is ALWAYS true — the flag alone must never hand
// a ~1280×800 slab the laptop-sized layout.

const setViewport = (w, h) => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: w });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: h });
};

describe("useFullscreenBoost — fullscreen only scales up where the pixels exist", () => {
  let fsElement = null;
  beforeEach(() => {
    Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => fsElement });
  });
  afterEach(() => {
    fsElement = null;
    delete document.fullscreenElement;
    setViewport(1024, 768); // jsdom's defaults
  });

  it("a fullscreen tablet-sized viewport (1280×800) gets NO boost", () => {
    fsElement = document.documentElement;
    setViewport(1280, 800);
    const { result } = renderHook(() => useFullscreenBoost());
    expect(result.current).toBe(false);
  });

  it("a fullscreen laptop-sized viewport (1920×1080) gets the boost", () => {
    fsElement = document.documentElement;
    setViewport(1920, 1080);
    const { result } = renderHook(() => useFullscreenBoost());
    expect(result.current).toBe(true);
  });

  it("wide but short (1366×768) still gets no boost — the 680px map wouldn't fit", () => {
    fsElement = document.documentElement;
    setViewport(1366, 768);
    const { result } = renderHook(() => useFullscreenBoost());
    expect(result.current).toBe(false);
  });

  it("a roomy viewport WITHOUT fullscreen gets no boost either", () => {
    setViewport(1920, 1080);
    const { result } = renderHook(() => useFullscreenBoost());
    expect(result.current).toBe(false);
  });
});
