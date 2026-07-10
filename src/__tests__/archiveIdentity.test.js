import { describe, expect, it } from "vitest";
import { archiveIdForService } from "../utils/archiveIdentity.js";

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
});
