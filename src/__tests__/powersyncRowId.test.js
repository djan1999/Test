import { describe, expect, it } from "vitest";
import { localRowId, naturalKeyFromLocalId } from "../powersync/rowId.js";

describe("PowerSync workspace-qualified row ids", () => {
  it("keeps identical natural keys from different workspaces distinct", () => {
    expect(localRowId("ws-a", 3)).toBe("ws-a|3");
    expect(localRowId("ws-b", 3)).toBe("ws-b|3");
    expect(localRowId("ws-a", 3)).not.toBe(localRowId("ws-b", 3));
  });

  it("preserves pipes inside a natural wine key", () => {
    const id = localRowId("ws-a", "manual|rebula");
    expect(naturalKeyFromLocalId(id, "ws-a")).toBe("manual|rebula");
  });
});
