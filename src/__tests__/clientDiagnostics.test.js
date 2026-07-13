import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearClientDiagnostics,
  readClientDiagnostics,
  recordClientDiagnostic,
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
