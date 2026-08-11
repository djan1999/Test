import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearClientDiagnostics,
  readClientDiagnostics,
  recordClientDiagnostic,
  diagnosticKind,
} from "../lib/clientDiagnostics.js";

describe("client diagnostics", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("records the newest browser failure first", () => {
    recordClientDiagnostic("sync", new Error("first"));
    recordClientDiagnostic("render", new Error("second"));
    expect(readClientDiagnostics().map((entry) => entry.message)).toEqual(["second", "first"]);
  });

  it("redacts bearer tokens and Supabase secret keys", () => {
    recordClientDiagnostic("api", new Error("Bearer abc123 sb_secret_do-not-store"));
    const [entry] = readClientDiagnostics();
    expect(entry.message).toContain("Bearer [redacted]");
    expect(entry.message).toContain("[redacted-key]");
    expect(entry.message).not.toContain("do-not-store");
  });

  // A defence that fired is the system WORKING. Filing it next to crashes
  // trains the owner that red is normal, which is how a real alarm gets
  // ignored on a busy night.
  it("separates a defence that held from an error that broke something", () => {
    recordClientDiagnostic("window.error", new Error("boom"));
    recordClientDiagnostic(
      "board write refused (newer table kept)",
      new Error("Service table 7 holds worked content this device never synced"),
      { kind: "defence" },
    );
    const entries = readClientDiagnostics();
    expect(entries[0].kind).toBe("defence");
    expect(entries[1].kind).toBe("error");
  });

  it("classifies LEGACY entries (recorded before the split) by their source", () => {
    // The real 10.08 entry from the 3-device test, stored with no `kind`.
    localStorage.setItem("milka_client_diagnostics_v1", JSON.stringify([
      {
        id: "1786363726671-vnd2bg",
        at: "2026-08-10T12:08:46.671Z",
        source: "board write refused (newer table kept)",
        message: "Service table 7 holds worked content this device never synced; the un-synced overwrite was refused and the server's table was kept.",
        stack: "",
      },
      { id: "x", at: "2026-08-10T12:00:00.000Z", source: "window.error", message: "crash", stack: "" },
    ]));
    const [shield, crash] = readClientDiagnostics();
    expect(shield.kind).toBe("defence"); // the wipe that was blocked reads green
    expect(crash.kind).toBe("error");
  });

  it("an unknown source defaults to error — nothing is quietly downgraded", () => {
    expect(diagnosticKind({ source: "something new nobody classified" })).toBe("error");
    expect(diagnosticKind({ source: "end service" })).toBe("error");
    expect(diagnosticKind({ source: "floor settings conflict" })).toBe("defence");
  });

  it("keeps a bounded history and can clear it", () => {
    vi.useFakeTimers();
    for (let index = 0; index < 35; index += 1) {
      vi.setSystemTime(new Date(2026, 0, 1, 0, 0, index));
      recordClientDiagnostic("test", `issue-${index}`);
    }
    vi.useRealTimers();
    expect(readClientDiagnostics()).toHaveLength(30);
    clearClientDiagnostics();
    expect(readClientDiagnostics()).toEqual([]);
  });
});
