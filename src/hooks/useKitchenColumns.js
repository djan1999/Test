import { useState, useCallback } from "react";

// ── Kitchen Board column density (device-level) ───────────────────────────────
// The kitchen tickets used to be a fixed 248px wide, so on a large touchscreen
// (e.g. a 32" panel) only a handful fit per row. This setting drives a real CSS
// grid instead — so tickets render crisply at native resolution (no blurry zoom)
// while letting staff pack more on screen, e.g. ~10 tickets at once.
//
// Value is either "auto" (responsive: as many columns as comfortably fit the
// screen) or an explicit column count. It's a property of the *physical screen*,
// not the restaurant, so it's persisted per-device under a plain localStorage key
// (NOT workspace-namespaced) and survives workspace switches.

const STORAGE_KEY = "milka_kitchen_columns";

export const COLS_MIN = 1;
export const COLS_MAX = 16;
export const AUTO = "auto";

const clampCols = (n) => Math.min(COLS_MAX, Math.max(COLS_MIN, Math.round(n)));

function readColumns() {
  if (typeof window === "undefined") return AUTO;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw == null || raw === AUTO) return AUTO;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? clampCols(n) : AUTO;
  } catch {
    return AUTO;
  }
}

export function useKitchenColumns() {
  const [columns, setColumns] = useState(readColumns);

  const commit = useCallback((value) => {
    const next = value === AUTO ? AUTO : clampCols(value);
    setColumns(next);
    try { window.localStorage.setItem(STORAGE_KEY, String(next)); } catch {}
  }, []);

  return { columns, setColumns: commit };
}
