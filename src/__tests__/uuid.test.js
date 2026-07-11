import { describe, it, expect, vi, afterEach } from "vitest";
import { randomUuid } from "../utils/uuid.js";

// The kitchen display's frozen browser predates crypto.randomUUID (Chrome 92)
// — these pin that every fallback tier still yields a well-formed v4 uuid, so
// an id mint can never be the thing that kills a reservation/archive write.

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => vi.unstubAllGlobals());

describe("randomUuid", () => {
  it("uses the native API when present", () => {
    vi.stubGlobal("crypto", { randomUUID: () => "native-uuid" });
    expect(randomUuid()).toBe("native-uuid");
  });

  it("falls back to getRandomValues on browsers without randomUUID (the kitchen display)", () => {
    vi.stubGlobal("crypto", {
      getRandomValues: (arr) => { for (let i = 0; i < arr.length; i++) arr[i] = i * 16; return arr; },
    });
    expect(randomUuid()).toMatch(V4);
  });

  it("never throws even with no crypto object at all", () => {
    vi.stubGlobal("crypto", undefined);
    const a = randomUuid();
    const b = randomUuid();
    expect(a).toMatch(V4);
    expect(b).toMatch(V4);
    expect(a).not.toBe(b);
  });
});
