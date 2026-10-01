import { describe, it, expect, vi } from "vitest";
import { handlePreloadError, PRELOAD_RELOAD_GUARD_KEY } from "../lib/preloadRecovery.js";

const memoryStorage = () => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
};

describe("handlePreloadError", () => {
  it("REGRESSION: first stale-chunk failure reloads once WITHOUT suppressing, so import() rejects instead of resolving undefined", () => {
    const storage = memoryStorage();
    const reload = vi.fn();
    const event = { preventDefault: vi.fn() };
    expect(handlePreloadError(event, { storage, reload })).toBe(true);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(storage.getItem(PRELOAD_RELOAD_GUARD_KEY)).toBe("1");
  });

  it("a failure right after the reload does not reload-loop and is not suppressed", () => {
    const storage = memoryStorage();
    storage.setItem(PRELOAD_RELOAD_GUARD_KEY, "1");
    const reload = vi.fn();
    const event = { preventDefault: vi.fn() };
    expect(handlePreloadError(event, { storage, reload })).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    expect(storage.getItem(PRELOAD_RELOAD_GUARD_KEY)).toBeNull();
  });

  it("blocked storage: does not suppress or reload-loop", () => {
    const storage = { getItem: () => { throw new Error("blocked"); } };
    const reload = vi.fn();
    const event = { preventDefault: vi.fn() };
    expect(handlePreloadError(event, { storage, reload })).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });
});
