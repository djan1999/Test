import { describe, expect, it, vi, afterEach } from "vitest";
import { archiveIdForService } from "../utils/archiveIdentity.js";

afterEach(() => vi.unstubAllGlobals());

describe("archive service identity", () => {
  it("returns the same UUID for the same service on every call", async () => {
    const a = await archiveIdForService("workspace-a", "2026-07-10T18:00:00.000Z");
    const b = await archiveIdForService("workspace-a", "2026-07-10T18:00:00.000Z");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("changes when the workspace or service start changes", async () => {
    const base = await archiveIdForService("workspace-a", "start-1");
    expect(await archiveIdForService("workspace-b", "start-1")).not.toBe(base);
    expect(await archiveIdForService("workspace-a", "start-2")).not.toBe(base);
  });

  it("is IDENTICAL on a browser with no crypto at all — the old kitchen display class", async () => {
    // The previous implementation fell back to a RANDOM uuid without
    // crypto.subtle, silently defeating the two-device dedup on exactly the
    // device it existed for. The derivation must not depend on crypto.
    const modern = await archiveIdForService("workspace-a", "2026-07-11T18:00:00.000Z");
    vi.stubGlobal("crypto", undefined);
    const oldDisplay = await archiveIdForService("workspace-a", "2026-07-11T18:00:00.000Z");
    expect(oldDisplay).toBe(modern);
  });

  it("still degrades to a random id only when there is no identity to derive from", async () => {
    const a = await archiveIdForService(null, "start-1");
    const b = await archiveIdForService(null, "start-1");
    expect(a).not.toBe(b);
  });
});
