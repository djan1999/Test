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
