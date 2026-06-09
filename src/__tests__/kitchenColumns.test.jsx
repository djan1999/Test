import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useKitchenColumns, AUTO, COLS_MIN, COLS_MAX } from "../hooks/useKitchenColumns.js";

const KEY = "milka_kitchen_columns";

beforeEach(() => {
  localStorage.clear();
});

describe("useKitchenColumns", () => {
  it("defaults to auto when nothing is stored", () => {
    const { result } = renderHook(() => useKitchenColumns());
    expect(result.current.columns).toBe(AUTO);
  });

  it("hydrates an explicit column count from storage", () => {
    localStorage.setItem(KEY, "10");
    const { result } = renderHook(() => useKitchenColumns());
    expect(result.current.columns).toBe(10);
  });

  it("hydrates the auto sentinel from storage", () => {
    localStorage.setItem(KEY, AUTO);
    const { result } = renderHook(() => useKitchenColumns());
    expect(result.current.columns).toBe(AUTO);
  });

  it("sets and persists an explicit column count", () => {
    const { result } = renderHook(() => useKitchenColumns());
    act(() => result.current.setColumns(10));
    expect(result.current.columns).toBe(10);
    expect(localStorage.getItem(KEY)).toBe("10");
  });

  it("sets and persists auto", () => {
    localStorage.setItem(KEY, "8");
    const { result } = renderHook(() => useKitchenColumns());
    act(() => result.current.setColumns(AUTO));
    expect(result.current.columns).toBe(AUTO);
    expect(localStorage.getItem(KEY)).toBe(AUTO);
  });

  it("clamps an explicit count into [MIN, MAX]", () => {
    const { result } = renderHook(() => useKitchenColumns());
    act(() => result.current.setColumns(999));
    expect(result.current.columns).toBe(COLS_MAX);
    act(() => result.current.setColumns(0));
    expect(result.current.columns).toBe(COLS_MIN);
  });

  it("rounds a fractional count to a whole number", () => {
    const { result } = renderHook(() => useKitchenColumns());
    act(() => result.current.setColumns(7.6));
    expect(result.current.columns).toBe(8);
  });

  it("falls back to auto on a corrupt stored value", () => {
    localStorage.setItem(KEY, "not-a-number");
    const { result } = renderHook(() => useKitchenColumns());
    expect(result.current.columns).toBe(AUTO);
  });
});
