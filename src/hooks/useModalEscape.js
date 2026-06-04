import { useEffect, useRef } from "react";

// Module-level stack so only the top-most open modal responds to Escape.
const stack = [];

let listenerAttached = false;
const onKey = (e) => {
  if (e.key !== "Escape") return;
  // Walk from top, find the first handler that considers itself enabled.
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].enabled()) {
      stack[i].call();
      return;
    }
  }
};

function ensureListener() {
  if (listenerAttached) return;
  document.addEventListener("keydown", onKey);
  listenerAttached = true;
}

export function useModalEscape(onClose, enabled = true) {
  // Refs updated synchronously every render so the handler is immediately
  // inert when enabled flips to false — before the effect cleanup fires.
  const enabledRef = useRef(enabled);
  const onCloseRef = useRef(onClose);
  enabledRef.current = enabled;
  onCloseRef.current = onClose;

  useEffect(() => {
    ensureListener();
    const entry = {
      enabled: () => enabledRef.current,
      call: () => { if (typeof onCloseRef.current === "function") onCloseRef.current(); },
    };
    stack.push(entry);
    return () => {
      const i = stack.indexOf(entry);
      if (i !== -1) stack.splice(i, 1);
    };
  }, []); // register once on mount, remove on unmount
}
