// Build-time old-browser compat transforms — the only protection that reaches
// @powersync/wa-sqlite's WEB WORKERS on the kitchen display (page polyfills
// don't). Pins: dependency call sites get rewritten, first-party and
// already-guarded code stays untouched, and the rewritten expressions are
// valid, working JavaScript.

import { describe, it, expect } from "vitest";
import {
  abortSignalTimeoutCompat, cryptoRandomUuidCompat, modernRuntimeCompat,
} from "../../vite/compat-plugins.js";

const DEP = "/repo/node_modules/@powersync/web/lib/thing.js";
const SRC = "/repo/src/utils/uuid.js";

describe("abortSignalTimeoutCompat", () => {
  const plugin = abortSignalTimeoutCompat();
  it("rewrites dependency call sites into a guarded expression", () => {
    const out = plugin.transform("const s = AbortSignal.timeout(5000);", DEP);
    expect(out.code).not.toContain("= AbortSignal.timeout(");
    expect(out.code).toContain('typeof AbortSignal!=="undefined"');
    // the rewritten expression must actually run (modern env: native path)
    const val = new Function(`return ${out.code.replace("const s = ", "").replace(/;\s*$/, "")}`)();
    expect(val).toBeTruthy(); // an AbortSignal
  });
  it("leaves first-party code alone", () => {
    expect(plugin.transform("AbortSignal.timeout(1)", SRC)).toBeNull();
  });
});

describe("cryptoRandomUuidCompat", () => {
  const plugin = cryptoRandomUuidCompat();
  it("rewrites bare dependency calls (the @powersync worker lease ids)", () => {
    const out = plugin.transform("const id = crypto.randomUUID();", DEP);
    expect(out.code).not.toContain("= crypto.randomUUID();");
    const id = new Function(out.code.replace("const id = ", "return ").replace(/;\s*$/, ""))();
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });
  it("the fallback branch yields a well-formed v4 uuid without crypto", () => {
    const out = plugin.transform("const id = crypto.randomUUID();", DEP);
    const body = out.code.replace("const id = ", "return ").replace(/;\s*$/, "");
    const id = new Function("crypto", body)(undefined); // crypto shadowed to undefined
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
  it("does NOT touch already-guarded globalThis.crypto.randomUUID() (would splice broken syntax)", () => {
    expect(plugin.transform("return globalThis.crypto.randomUUID();", DEP)).toBeNull();
  });
  it("leaves first-party code alone", () => {
    expect(plugin.transform("crypto.randomUUID()", SRC)).toBeNull();
  });
});

describe("modernRuntimeCompat", () => {
  const plugin = modernRuntimeCompat();
  it("prepends the prelude to dependency modules using toSorted/findLast/structuredClone", () => {
    const out = plugin.transform("export const x = [3,1].toSorted();", DEP);
    expect(out.code.startsWith(";(function(){var A=Array.prototype;")).toBe(true);
    expect(out.code).toContain("export const x");
  });
  it("the prelude polyfills behave like the real methods", () => {
    const preludeOnly = plugin.transform("a.toSorted(", DEP).code.split("\n")[0];
    const run = new Function("Array", `
      ${preludeOnly.replace(/var A=Array\.prototype;/, "var A=Array.prototype;A.toSorted=undefined;A.toReversed=undefined;A.findLast=undefined;A.findLastIndex=undefined;")}
      const base = [3, 1, 2];
      return {
        sorted: base.toSorted((a,b)=>a-b), reversed: base.toReversed(),
        last: base.findLast(v=>v<3), lastIdx: base.findLastIndex(v=>v<3),
        baseUntouched: base.join(","),
      };
    `)(Array);
    expect(run.sorted).toEqual([1, 2, 3]);
    expect(run.reversed).toEqual([2, 1, 3]);
    expect(run.last).toBe(2);
    expect(run.lastIdx).toBe(2);
    expect(run.baseUntouched).toBe("3,1,2"); // non-mutating, like the spec
  });
  it("skips modules that don't use any covered API", () => {
    expect(plugin.transform("export const y = 1;", DEP)).toBeNull();
  });
});
