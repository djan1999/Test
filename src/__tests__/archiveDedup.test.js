import { describe, it, expect } from "vitest";
import { resolveArchiveDedup, isSameServiceLabel } from "../utils/archiveDedup.js";

const LABEL = "13.06.2026 – DINNER";

describe("resolveArchiveDedup", () => {
  it("files the first service of a day+session under the plain label", () => {
    const r = resolveArchiveDedup({ existing: [], startedAt: "A", archiveLabel: LABEL });
    expect(r).toEqual({ isDuplicate: false, label: LABEL });
  });

  it("treats a re-file of the SAME instance as a duplicate (double-tap / 2nd device)", () => {
    const existing = [{ label: LABEL, state: { startedAt: "A" }, created_at: new Date().toISOString() }];
    const r = resolveArchiveDedup({ existing, startedAt: "A", archiveLabel: LABEL });
    expect(r.isDuplicate).toBe(true);
  });

  it("keeps a GENUINE second service of the same day+session, with a distinct label", () => {
    // First (broken) service already archived under instance "A".
    const existing = [{ label: LABEL, state: { startedAt: "A" }, created_at: new Date().toISOString() }];
    // Second (good) service has a different instance id "B" — must NOT be dropped.
    const r = resolveArchiveDedup({ existing, startedAt: "B", archiveLabel: LABEL });
    expect(r.isDuplicate).toBe(false);
    expect(r.label).toBe(`${LABEL} · 2`);
  });

  it("numbers a third service of the same slot correctly", () => {
    const existing = [
      { label: LABEL, state: { startedAt: "A" }, created_at: new Date().toISOString() },
      { label: `${LABEL} · 2`, state: { startedAt: "B" }, created_at: new Date().toISOString() },
    ];
    const r = resolveArchiveDedup({ existing, startedAt: "C", archiveLabel: LABEL });
    expect(r.isDuplicate).toBe(false);
    expect(r.label).toBe(`${LABEL} · 3`);
  });

  it("falls back to a recency window when no instance id is present (legacy/orphan)", () => {
    const now = Date.now();
    const recent = [{ label: LABEL, state: {}, created_at: new Date(now - 30 * 1000).toISOString() }];
    expect(resolveArchiveDedup({ existing: recent, startedAt: null, archiveLabel: LABEL, now }).isDuplicate).toBe(true);

    const old = [{ label: LABEL, state: {}, created_at: new Date(now - 60 * 60 * 1000).toISOString() }];
    expect(resolveArchiveDedup({ existing: old, startedAt: null, archiveLabel: LABEL, now }).isDuplicate).toBe(false);
  });
});

describe("isSameServiceLabel", () => {
  it("matches the base label and its numbered variants", () => {
    expect(isSameServiceLabel(LABEL, LABEL)).toBe(true);
    expect(isSameServiceLabel(`${LABEL} · 2`, LABEL)).toBe(true);
  });
  it("does not match a different session or day", () => {
    expect(isSameServiceLabel("13.06.2026 – LUNCH", LABEL)).toBe(false);
    expect(isSameServiceLabel("14.06.2026 – DINNER", LABEL)).toBe(false);
  });
});
