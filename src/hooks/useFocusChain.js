import { useRef, useCallback } from "react";

// Linear focus chain for inputs/textareas. Fields register via bind(id);
// ArrowUp/ArrowDown jump between them in DOM order. For textareas, arrow
// nav only fires when the cursor is on the first/last visual line — so
// multi-line editing still works natively.
export function useFocusChain() {
  const fields = useRef(new Map());

  const sorted = () => {
    const live = [...fields.current.entries()].filter(
      ([, el]) => el && el.isConnected
    );
    live.sort(([, a], [, b]) => {
      const pos = a.compareDocumentPosition(b);
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });
    return live.map(([, el]) => el);
  };

  const focusEl = (el, atEnd) => {
    if (!el) return;
    el.focus();
    const len = el.value?.length ?? 0;
    const pos = atEnd ? len : 0;
    try {
      el.selectionStart = el.selectionEnd = pos;
    } catch {
      // some inputs (number, etc.) don't support selection
    }
  };

  const bind = useCallback((id, userOnKeyDown) => {
    return {
      ref: (el) => {
        if (el) fields.current.set(id, el);
        else fields.current.delete(id);
      },
      onKeyDown: (e) => {
        if (userOnKeyDown) userOnKeyDown(e);
        if (e.defaultPrevented) return;
        if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;

        const el = e.currentTarget;
        const tag = el.tagName;
        const start = el.selectionStart ?? 0;
        const val = el.value ?? "";

        if (tag === "TEXTAREA") {
          if (e.key === "ArrowUp") {
            const firstNl = val.indexOf("\n");
            const onFirstLine = firstNl === -1 || start <= firstNl;
            if (!onFirstLine) return;
          } else {
            const lastNl = val.lastIndexOf("\n");
            const onLastLine = lastNl === -1 || start > lastNl;
            if (!onLastLine) return;
          }
        }

        const list = sorted();
        const i = list.indexOf(el);
        if (i === -1) return;

        if (e.key === "ArrowUp" && i > 0) {
          e.preventDefault();
          focusEl(list[i - 1], true);
        } else if (e.key === "ArrowDown" && i < list.length - 1) {
          e.preventDefault();
          focusEl(list[i + 1], false);
        }
      },
    };
  }, []);

  const focusField = useCallback((id, atEnd = false) => {
    // Defer to next frame so newly-mounted fields have a chance to register.
    requestAnimationFrame(() => focusEl(fields.current.get(id), atEnd));
  }, []);

  return { bind, focusField };
}
