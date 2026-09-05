import { describe, expect, it } from "vitest";
import { evaluateDeviceHealth, supportSummary, HEALTH, STALL_AFTER_MS } from "../lib/deviceHealth.js";

const NOW = Date.UTC(2026, 7, 10, 20, 5, 0); // the call comes at 20:05

const healthyStatus = (overrides = {}) => ({
  connected: true,
  connecting: false,
  hasSynced: true,
  hasSyncedP1: true,
  lastSyncedAt: NOW - 4_000,
  streamError: null,
  ...overrides,
});

const evaluate = (input = {}) => evaluateDeviceHealth({ now: NOW, powerSyncStatus: healthyStatus(), ...input });

describe("device health — the 20:05 kitchen call", () => {
  it("names the network as the cause and forbids clearing the device", () => {
    const health = evaluate({ online: false });
    expect(health.state).toBe(HEALTH.OFFLINE);
    expect(health.meaning).toMatch(/saved locally/i);
    // RESET LOCAL SYNC DB discards un-uploaded edits. Never suggest it here.
    expect(health.action).toMatch(/do not reset/i);
  });

  it("treats a down stream as offline even when the browser claims a network", () => {
    expect(evaluate({ powerSyncStatus: healthyStatus({ connected: false, connecting: false }) }).state)
      .toBe(HEALTH.OFFLINE);
  });

  it("says the service was never started rather than blaming the device", () => {
    const health = evaluate({ serviceActive: false });
    expect(health.state).toBe(HEALTH.IDLE);
    expect(health.action).toMatch(/start service/i);
    expect(health.meaning).toMatch(/nothing is wrong|no service has been started/i);
  });

  it("points at the other device when this one is fine — the answer support gets wrong", () => {
    const health = evaluate();
    expect(health.state).toBe(HEALTH.HEALTHY);
    expect(health.meaning).toMatch(/never left the other device/i);
    expect(health.action).toMatch(/floor device/i);
    expect(health.escalate).toBe(false);
  });

  it("reports a stream that is up but silent, and escalates it", () => {
    const health = evaluate({
      powerSyncStatus: healthyStatus({ lastSyncedAt: NOW - (STALL_AFTER_MS + 60_000) }),
    });
    expect(health.state).toBe(HEALTH.STALLED);
    expect(health.meaning).toMatch(/nothing has arrived/i);
    expect(health.escalate).toBe(true);
  });

  it("quotes the stream's own error when it has one", () => {
    const health = evaluate({
      powerSyncStatus: healthyStatus({ streamError: "WebSocket refused (401)" }),
    });
    expect(health.state).toBe(HEALTH.STALLED);
    expect(health.meaning).toMatch(/WebSocket refused \(401\)/);
  });

  it("does not call a quiet minute a stall", () => {
    expect(evaluate({ powerSyncStatus: healthyStatus({ lastSyncedAt: NOW - 45_000 }) }).state)
      .toBe(HEALTH.HEALTHY);
  });

  it("separates a first sync in progress from a stall", () => {
    const health = evaluate({ powerSyncStatus: healthyStatus({ hasSyncedP1: false, lastSyncedAt: null }) });
    expect(health.state).toBe(HEALTH.CONNECTING);
    expect(health.action).toMatch(/minute/i);
  });
});

describe("device health — refused operations", () => {
  it("ranks a refused operation above every other symptom", () => {
    const health = evaluate({
      diagnostics: [{ source: "uploadData", message: "POWERSYNC_ZERO_MATCH on service_tables" }],
      // Also stalled: the refusal is the more important thing to say.
      powerSyncStatus: healthyStatus({ lastSyncedAt: NOW - 600_000 }),
    });
    expect(health.state).toBe(HEALTH.BLOCKED);
    expect(health.escalate).toBe(true);
    expect(health.action).toMatch(/write down|escalate/i);
  });

  it("recognises an RLS denial reaching the client", () => {
    expect(evaluate({
      diagnostics: [{ source: "supabase", message: "new row violates row-level security policy (42501)" }],
    }).state).toBe(HEALTH.BLOCKED);
  });

  it("ignores ordinary noise", () => {
    expect(evaluate({
      diagnostics: [{ source: "window.error", message: "ResizeObserver loop limit exceeded" }],
    }).state).toBe(HEALTH.HEALTHY);
  });

  it("still puts the network first — an offline device explains its own diagnostics", () => {
    expect(evaluate({
      online: false,
      diagnostics: [{ source: "uploadData", message: "POWERSYNC_ZERO_MATCH" }],
    }).state).toBe(HEALTH.OFFLINE);
  });
});

describe("device health — what support can read back", () => {
  it("admits when it cannot see anything rather than reporting health", () => {
    const health = evaluateDeviceHealth({ now: NOW });
    expect(health.state).toBe(HEALTH.UNKNOWN);
  });

  it("always carries the six facts, whatever the verdict", () => {
    for (const input of [{}, { online: false }, { serviceActive: false }]) {
      expect(evaluate(input).facts.map(([label]) => label)).toEqual([
        "Network", "Sync stream", "First sync", "Last sync", "Service", "Refused operations",
      ]);
    }
  });

  it("produces a phone-readable summary with no guest data in it", () => {
    const line = supportSummary({
      health: evaluate(), buildId: "2026-08-10-a1b2c3", role: "kitchen",
      workspaceSlug: "gostilna-test", now: NOW,
    });
    expect(line).toBe("state=healthy · build=2026-08-10-a1b2c3 · role=kitchen · restaurant=gostilna-test · at=2026-08-10T20:05:00Z");
  });
});
