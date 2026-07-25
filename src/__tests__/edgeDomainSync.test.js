// The Supabase edge function used to carry its own hand-written copy of the
// availability rules. It had drifted: it knew nothing about joinable tables, so
// it offered no combination to a party that needed one, and — worse — it read a
// joined party as holding only its first table, leaving the second free for the
// next booking. Two engines, one of them wrong, and no way to tell from a test.
//
// There is now one engine. The Supabase bundler cannot reach ../../src, so the
// domain modules are copied into supabase/functions/_shared/reservations by
// `npm run sync:edge-domain`, and this test is what stops the copies drifting
// again: change a rule without re-running the sync and the suite fails here.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SYNCED_FILES, TARGET_DIR, currentContent, drifted, expectedContent } from "../../scripts/syncEdgeDomain.mjs";

describe("edge function domain copies", () => {
  it("are byte-identical to src/domain/reservations", () => {
    expect(drifted()).toEqual([]);
  });

  SYNCED_FILES.forEach((file) => {
    it(`${file} is present and marked as generated`, () => {
      const content = currentContent(file);
      expect(content, `${file} is missing — run npm run sync:edge-domain`).toBeTruthy();
      expect(content.startsWith("// GENERATED FILE — DO NOT EDIT.")).toBe(true);
      expect(content).toBe(expectedContent(file));
    });
  });

  it("carries the rules the edge copy used to get wrong", () => {
    const availability = readFileSync(join(TARGET_DIR, "availability.js"), "utf8");
    // A joined party holds every table in its group.
    expect(availability).toContain("tableGroup");
    // And a party too big for any single table may be given a configured pair.
    expect(availability).toContain("combos");
  });
});
