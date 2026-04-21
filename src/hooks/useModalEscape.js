import { useEffect } from "react";

// Module-level stack so only the top-most open modal responds to Escape.
const stack = [];

let listenerAttached = false;
const onKey = (e) => {
  if (e.key !== "Escape") return;
  if (stack.length === 0) return;
  const top = stack[stack.length - 1];
  e.stopPropagation();
  top();
};

function ensureListener() {
  if (listenerAttached) return;
  document.addEventListener("keydown", onKey);
  listenerAttached = true;
}

export function useModalEscape(onClose, enabled = true) {
  useEffect(() => {
    if (!enabled || typeof onClose !== "function") return;
    ensureListener();
    stack.push(onClose);
    return () => {
      const i = stack.lastIndexOf(onClose);
      if (i !== -1) stack.splice(i, 1);
    };
  }, [onClose, enabled]);
}
