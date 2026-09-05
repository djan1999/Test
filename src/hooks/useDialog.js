import { useEffect, useRef } from "react";

const dialogs = [];
const focusable = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])';

export function useDialog() {
  const ref = useRef(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return undefined;
    const previous = document.activeElement;
    dialogs.push(root);
    const isTop = () => !dialogs.some(other => other !== root && root.contains(other))
      && dialogs.filter(other => other === root || !other.contains(root)).at(-1) === root;
    const targets = () => [...root.querySelectorAll(focusable)].filter(el =>
      !el.closest('[hidden], [aria-hidden="true"]') && getComputedStyle(el).display !== "none");
    if (!root.contains(document.activeElement)) (targets()[0] || root).focus();
    const onKeyDown = (event) => {
      if (event.key !== "Tab" || !isTop()) return;
      const items = targets();
      const first = items[0] || root;
      const last = items.at(-1) || root;
      if (!root.contains(document.activeElement) || (event.shiftKey ? document.activeElement === first : document.activeElement === last) || !items.length) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      dialogs.splice(dialogs.indexOf(root), 1);
      document.removeEventListener("keydown", onKeyDown);
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return ref;
}
