// AbortSignal.timeout / AbortSignal.any compatibility shims.
//
// The restaurant's kitchen display runs an older embedded browser without
// AbortSignal.timeout (added Chrome 103 / Safari 16) — and @powersync/web
// calls it on the WRITE path. The 10.07 rollout finally put that display on
// the local-first path, and its very first board save crashed with
// "AbortSignal.timeout is not a function", taking every cross-device flow
// down with it. These shims are no-ops on modern browsers (typeof guards)
// and MUST be imported before anything else in main.jsx — imports hoist, so
// this lives in its own module at the top of the import list rather than as
// inline code.
(() => {
  if (typeof AbortSignal === "undefined" || typeof AbortController === "undefined") return;

  if (typeof AbortSignal.timeout !== "function") {
    AbortSignal.timeout = (ms) => {
      const controller = new AbortController();
      setTimeout(() => {
        let reason;
        try { reason = new DOMException("The operation timed out.", "TimeoutError"); }
        catch { reason = new Error("The operation timed out."); }
        controller.abort(reason);
      }, ms);
      return controller.signal;
    };
  }

  // AbortSignal.any is even newer (Chrome 116 / Safari 17.4) — shim it too so
  // the next library update can't repeat this incident with its sibling.
  if (typeof AbortSignal.any !== "function") {
    AbortSignal.any = (signals) => {
      const controller = new AbortController();
      const follow = (signal) => controller.abort(signal.reason);
      for (const signal of signals || []) {
        if (signal.aborted) { follow(signal); break; }
        signal.addEventListener("abort", () => follow(signal), { once: true });
      }
      return controller.signal;
    };
  }
})();
