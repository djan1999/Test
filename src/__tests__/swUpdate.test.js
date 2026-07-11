// PWA update handshake — pins the 11.07 rule: a deployed build downloads in
// the background and WAITS; nothing force-reloads a device mid-service. The
// SYSTEM panel consumes this store to offer a deliberate APPLY UPDATE.

import { describe, it, expect, vi } from "vitest";
import { setUpdateReady, isUpdateReady, applyUpdate, onUpdateReady } from "../lib/swUpdate.js";

describe("swUpdate store", () => {
  it("marking ready never applies by itself — apply is a deliberate call", () => {
    const apply = vi.fn();
    expect(isUpdateReady()).toBe(false);
    setUpdateReady(apply);
    expect(isUpdateReady()).toBe(true);
    expect(apply).not.toHaveBeenCalled(); // ← the whole point: no auto-reload
    applyUpdate();
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("subscribers hear about readiness, including late subscribers", () => {
    const heard = vi.fn();
    const un = onUpdateReady(heard);   // already ready from the prior test's set
    expect(heard).toHaveBeenCalled();
    un();
    const heard2 = vi.fn();
    setUpdateReady(vi.fn());
    onUpdateReady(heard2);
    expect(heard2).toHaveBeenCalled();
  });
});
