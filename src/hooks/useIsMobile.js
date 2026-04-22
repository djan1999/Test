import { useState, useEffect } from "react";

// Centralised breakpoints — import BP wherever you call useIsMobile.
export const BP = {
  sm: 640,  // narrow phone — Header, FullModal compact chrome
  md: 700,  // general mobile/tablet — forms, panels, modals
  lg: 768,  // wide tablet — AdminLayout sidebar collapse
  // 560 used by ResvForm for its 1-col grid layout (intentionally tighter)
  // 860 used by Detail view to keep wide mobile layout on tablets
};

export function useIsMobile(bp = BP.md) {
  const getValue = () => (typeof window !== "undefined" ? window.innerWidth < bp : false);
  const [isMobile, setIsMobile] = useState(getValue);

  useEffect(() => {
    const onResize = () => setIsMobile(getValue());
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [bp]);

  return isMobile;
}
