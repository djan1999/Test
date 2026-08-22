import { useEffect, useState } from "react";

// True while the app owns the WHOLE screen — either the Fullscreen API is
// engaged (the gate's FULLSCREEN toggle, F11) or the installed PWA runs in
// the manifest's fullscreen display mode (the tablets). The service surfaces
// scale up on it: the extra rows of pixels belong to the map and the dock,
// not to margins. jsdom has neither API — every access is guarded.
const compute = () => {
  if (typeof document === "undefined") return false;
  if (document.fullscreenElement || document.webkitFullscreenElement) return true;
  return typeof window !== "undefined"
    && !!window.matchMedia?.("(display-mode: fullscreen)")?.matches;
};

export default function useIsFullscreen() {
  const [fs, setFs] = useState(compute);
  useEffect(() => {
    const on = () => setFs(compute());
    document.addEventListener("fullscreenchange", on);
    document.addEventListener("webkitfullscreenchange", on);
    const mq = typeof window !== "undefined" ? window.matchMedia?.("(display-mode: fullscreen)") : null;
    mq?.addEventListener?.("change", on);
    return () => {
      document.removeEventListener("fullscreenchange", on);
      document.removeEventListener("webkitfullscreenchange", on);
      mq?.removeEventListener?.("change", on);
    };
  }, []);
  return fs;
}

// The fullscreen SCALE-UP is gated on the screen actually having the pixels,
// not on the flag alone: the installed PWA runs in fullscreen display-mode
// permanently, so on a tablet the flag is always true and the flag-only gate
// handed a ~1280×800 slab the laptop-sized layout (too big — per Djan,
// 22.08). The thresholds are the boosted layout's real needs: the 680px map
// plus the app chrome wants ~860 rows, and 1360 columns is the first width
// that is a laptop and not a tablet. Below them fullscreen keeps the normal
// (already-fitting) desktop sizes.
const hasRoom = () => typeof window !== "undefined"
  && window.innerWidth >= 1360 && window.innerHeight >= 860;

export function useFullscreenBoost() {
  const fs = useIsFullscreen();
  const [roomy, setRoomy] = useState(hasRoom);
  useEffect(() => {
    const on = () => setRoomy(hasRoom());
    on();
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return fs && roomy;
}
