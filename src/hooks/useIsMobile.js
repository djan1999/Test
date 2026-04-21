import { useState, useEffect } from "react";
import { tokens } from "../styles/tokens.js";

export function useIsMobile(bp = tokens.breakpoints.md) {
  const supportsMatchMedia =
    typeof window !== "undefined" && typeof window.matchMedia === "function";
  const getValue = () =>
    supportsMatchMedia
      ? window.matchMedia(`(max-width: ${bp - 0.02}px)`).matches
      : false;
  const [isMobile, setIsMobile] = useState(getValue);

  useEffect(() => {
    if (!supportsMatchMedia) {
      setIsMobile(false);
      return undefined;
    }
    const media = window.matchMedia(`(max-width: ${bp - 0.02}px)`);
    const onChange = () => setIsMobile(media.matches);
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [bp, supportsMatchMedia]);

  return isMobile;
}
