import { describe, it, expect } from "vitest";
import { stampWineSources, wineFingerprint, wineSaveDiff } from "../utils/wineEdit.js";

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

describe("wineSaveDiff (write only what changed)", () => {
  const catalogue = Array.from({ length: 50 }, (_, i) => syncWine({ id: `p|w${i}|2019|si`, name: `Wine ${i}` }));
  const diff = (updated) => wineSaveDiff(stampWineSources(updated, catalogue), catalogue);

  it("a no-op save writes nothing", () => {
    expect(diff(catalogue)).toEqual({ rows: [], deletedKeys: [] });
  });

  it("editing one wine writes exactly that row, flipped to manual", () => {
    const updated = catalogue.map((w, i) => (i === 7 ? { ...w, byGlass: true } : w));
    const { rows, deletedKeys } = diff(updated);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: "p|w7|2019|si", by_glass: true, source: "manual" });
    expect(deletedKeys).toEqual([]);
  });

  it("a new wine is written and a removed wine is deleted", () => {
    const added = { id: "manual|new_one", name: "New", producer: "", vintage: "", region: "", country: "", byGlass: false };
    const { rows, deletedKeys } = diff([...catalogue.slice(1), added]);
    expect(rows).toEqual([expect.objectContaining({ key: "manual|new_one", source: "manual", vintage: "NV" })]);
    expect(deletedKeys).toEqual(["p|w0|2019|si"]);
  });

  it("a wine stored without a source counts as sync, so it is not rewritten", () => {
    const legacy = [{ ...syncWine(), source: undefined }];
    expect(wineSaveDiff(stampWineSources(legacy, legacy), legacy).rows).toEqual([]);
  });
});
