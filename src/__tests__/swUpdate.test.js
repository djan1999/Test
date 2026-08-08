// PWA update handshake — pins the 11.07 rule: a deployed build downloads in
// the background and WAITS; nothing force-reloads a device mid-service. The
// SYSTEM panel consumes this store to offer a deliberate APPLY UPDATE, and
// the boot gate applies the waiting build FORCIBLY while the CONNECTING
// splash is still up (08.08 rule: an online device may not open on an
// outdated build — an old build is old bugs).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  setUpdateReady, isUpdateReady, applyUpdate, onUpdateReady,
  setSwRegistration, forceBootUpdateIfAvailable,
} from "../lib/swUpdate.js";

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

// ── Boot update gate ─────────────────────────────────────────────────────────
// The CONNECTING splash may not release while a deployed build is applicable:
// forceBootUpdateIfAvailable activates it and reloads FIRST. Everything is
// bounded so a wedged worker or dead network can never brick a boot, and a
// one-shot sessionStorage guard makes a reload loop structurally impossible.
describe("forceBootUpdateIfAvailable", () => {
  const GUARD = "milka_boot_update_reload_once";
  let controllerListeners;

  const installFakeSw = (registration) => {
    controllerListeners = [];
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        addEventListener: (event, fn) => { if (event === "controllerchange") controllerListeners.push(fn); },
        getRegistration: async () => registration,
      },
    });
  };

  beforeEach(() => {
    sessionStorage.clear();
    setSwRegistration(null);
    setUpdateReady(null); // route activation through the raw SKIP_WAITING path
  });
  afterEach(() => {
    delete navigator.serviceWorker;
  });

  it("resolves false when the browser has no service-worker support", async () => {
    delete navigator.serviceWorker;
    await expect(forceBootUpdateIfAvailable()).resolves.toBe(false);
  });

  it("applies a WAITING build: activation requested, guard set, reload on controllerchange", async () => {
    const postMessage = vi.fn();
    const reg = { waiting: { postMessage }, update: vi.fn() };
    installFakeSw(reg);
    const reload = vi.fn();
    const onApplying = vi.fn();
    const gate = forceBootUpdateIfAvailable({ onApplying, reload, reloadTimeoutMs: 2000 });
    await Promise.resolve(); // let the gate reach the apply step
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" }));
    expect(onApplying).toHaveBeenCalled();
    expect(sessionStorage.getItem(GUARD)).toBe("1"); // loop guard armed BEFORE the reload
    controllerListeners.forEach((fn) => fn()); // the new worker takes control
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    void gate; // the page is "gone" — the promise needs no verdict
  });

  it("the reloaded boot passes through ONCE and clears the guard (no reload loops)", async () => {
    sessionStorage.setItem(GUARD, "1");
    const reg = { waiting: { postMessage: vi.fn() }, update: vi.fn() };
    installFakeSw(reg);
    await expect(forceBootUpdateIfAvailable()).resolves.toBe(false);
    expect(sessionStorage.getItem(GUARD)).toBe(null);
    expect(reg.waiting.postMessage).not.toHaveBeenCalled();
  });

  it("offline: the server check rejects and the boot proceeds on the cached build", async () => {
    const reg = { waiting: null, update: vi.fn().mockRejectedValue(new Error("offline")) };
    installFakeSw(reg);
    await expect(forceBootUpdateIfAvailable()).resolves.toBe(false);
  });

  it("already current: check succeeds, nothing waiting → false, nothing applied", async () => {
    const reg = { waiting: null, installing: null, update: vi.fn().mockResolvedValue(undefined) };
    setSwRegistration(reg); // the registration handed over by main.jsx
    installFakeSw(reg);
    await expect(forceBootUpdateIfAvailable()).resolves.toBe(false);
    expect(reg.update).toHaveBeenCalledTimes(1);
  });

  it("a build found by the boot check downloads, reaches WAITING and is applied", async () => {
    const stateListeners = [];
    const installing = {
      state: "installing",
      addEventListener: (event, fn) => { if (event === "statechange") stateListeners.push(fn); },
    };
    const postMessage = vi.fn();
    const reg = { waiting: null, installing, update: vi.fn().mockResolvedValue(undefined) };
    installFakeSw(reg);
    const reload = vi.fn();
    const onApplying = vi.fn();
    forceBootUpdateIfAvailable({ onApplying, reload, reloadTimeoutMs: 2000 });
    await vi.waitFor(() => expect(onApplying).toHaveBeenCalled()); // splash flips to UPDATING…
    // the download finishes: the worker becomes the WAITING build
    installing.state = "installed";
    reg.installing = null;
    reg.waiting = { postMessage };
    stateListeners.forEach((fn) => fn());
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" }));
    controllerListeners.forEach((fn) => fn());
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });

  it("a wedged worker cannot brick the boot: no controllerchange → false, guard cleared", async () => {
    const reg = { waiting: { postMessage: vi.fn() }, update: vi.fn() };
    installFakeSw(reg);
    const reload = vi.fn();
    await expect(forceBootUpdateIfAvailable({ reload, reloadTimeoutMs: 60 })).resolves.toBe(false);
    expect(sessionStorage.getItem(GUARD)).toBe(null); // next boot force-updates again
    expect(reload).not.toHaveBeenCalled();
  });
});
