import { describe, it, expect } from "vitest";
import { stampWineSources, wineFingerprint } from "../utils/wineEdit.js";

const syncWine = (over = {}) => ({
  id: "movia|veliko_belo|2019|slovenia",
  name: "Veliko Belo",
  producer: "Movia",
  vintage: "2019",
  region: "Brda",
  country: "Slovenia",
  byGlass: false,
  source: "sync",
  ...over,
});

describe("stampWineSources (copy-on-edit for synced wines)", () => {
  it("keeps an untouched sync wine as sync", () => {
    const orig = [syncWine()];
    const [out] = stampWineSources([syncWine()], orig);
    expect(out.source).toBe("sync");
  });

  it("flips an edited sync wine to manual (typo fix)", () => {
    const orig = [syncWine()];
    const [out] = stampWineSources([syncWine({ name: "Veliko Belo Reserve" })], orig);
    expect(out.source).toBe("manual");
  });

  it("flips when only the by-glass toggle changed", () => {
    const orig = [syncWine()];
    const [out] = stampWineSources([syncWine({ byGlass: true })], orig);
    expect(out.source).toBe("manual");
  });

  it("never reverts a manual-flipped wine back to sync, even when content matches the original again", () => {
    // First save flipped it; second save passes identical content. The row in
    // the DB is manual — writing source:'sync' would re-expose it to the
    // nightly delete.
    const orig = [syncWine({ source: "manual" })];
    const [out] = stampWineSources([syncWine({ source: "manual" })], orig);
    expect(out.source).toBe("manual");
  });

  it("keeps manual| keyed wines manual", () => {
    const w = { id: "manual|abc", name: "House Red", source: undefined };
    const [out] = stampWineSources([w], []);
    expect(out.source).toBe("manual");
  });

  it("treats legacy numeric ids as manual", () => {
    const w = { id: 42, name: "Old Entry" };
    const [out] = stampWineSources([w], []);
    expect(out.source).toBe("manual");
  });

  it("infers sync from a non-manual key when source is missing", () => {
    const w = { id: "movia|rebula|2020|slovenia", name: "Rebula" };
    const [out] = stampWineSources([w], [{ ...w }]);
    expect(out.source).toBe("sync");
  });
});

describe("wineFingerprint", () => {
  it("ignores fields that are not human-editable content", () => {
    expect(wineFingerprint(syncWine({ source: "sync" })))
      .toBe(wineFingerprint(syncWine({ source: "manual" })));
  });

  it("normalizes a missing vintage to NV", () => {
    expect(wineFingerprint(syncWine({ vintage: undefined })))
      .toBe(wineFingerprint(syncWine({ vintage: "NV" })));
  });
});
