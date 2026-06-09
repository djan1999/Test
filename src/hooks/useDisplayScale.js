import { useState, useLayoutEffect, useCallback } from "react";

// ── Display scale (device-level zoom) ─────────────────────────────────────────
// The board is built with fixed-px inline styles tuned for a tablet held close.
// On a large service/kitchen touchscreen (e.g. a 32" panel, often running at high
// OS display scaling) that same layout renders "zoomed in" and only a handful of
// kitchen tickets fit per row. This hook lets staff scale the whole app down (or
// up) to fit the screen — e.g. zoom out so ~10 kitchen tickets fit at once.
//
// It is a property of the *physical screen*, not the restaurant, so it is
// persisted per-device under a plain localStorage key (NOT workspace-namespaced)
// and survives workspace switches. It is applied via CSS `zoom` on the document
// root, which reflows the layout (so zooming out genuinely fits more content),
// unlike `transform: scale` which would just shrink-and-letterbox.

const STORAGE_KEY = "milka_display_scale";

export const SCALE_MIN = 0.5;
export const SCALE_MAX = 1.3;
export const SCALE_STEP = 0.1;

const clamp = (n) => Math.min(SCALE_MAX, Math.max(SCALE_MIN, n));
// Keep values on the 0.1 grid so the % readout and stored value never drift
// (avoids 0.7000000000000001 from repeated float addition).
const round1 = (n) => Math.round(n * 10) / 10;

function readScale() {
  if (typeof window === "undefined") return 1;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw == null) return 1;
    const n = parseFloat(raw);
    return Number.isFinite(n) ? clamp(round1(n)) : 1;
  } catch {
    return 1;
  }
}

function applyScale(scale) {
  if (typeof document === "undefined") return;
  // Leave the property cleared at 100% so the DOM stays tidy when unscaled.
  document.documentElement.style.zoom = scale === 1 ? "" : String(scale);
}

export function useDisplayScale() {
  const [scale, setScale] = useState(readScale);

  // useLayoutEffect applies (and persists) before the browser paints, so the
  // saved scale is already in effect on first render — no flash of unscaled UI.
  useLayoutEffect(() => {
    applyScale(scale);
    try { window.localStorage.setItem(STORAGE_KEY, String(scale)); } catch {}
  }, [scale]);

  // Functional updaters so rapid taps never read a stale scale.
  const zoomOut = useCallback(() => setScale((s) => clamp(round1(s - SCALE_STEP))), []);
  const zoomIn  = useCallback(() => setScale((s) => clamp(round1(s + SCALE_STEP))), []);
  const reset   = useCallback(() => setScale(1), []);

  return { scale, zoomIn, zoomOut, reset };
}
