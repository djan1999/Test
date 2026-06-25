import { describe, it, expect } from "vitest";
import { nextArchiveLabel, isSameServiceLabel } from "../utils/archiveDedup.js";

const LABEL = "13.06.2026 – DINNER";

describe("nextArchiveLabel (always save; distinguish duplicates)", () => {
  it("uses the plain label for the first service of a day+session", () => {
    expect(nextArchiveLabel([], LABEL)).toBe(LABEL);
  });

  it("suffixes a second service of the same day+session", () => {
    const existing = [{ label: LABEL }];
    expect(nextArchiveLabel(existing, LABEL)).toBe(`${LABEL} · 2`);
  });

  it("numbers a third (counting base + variants)", () => {
    const existing = [{ label: LABEL }, { label: `${LABEL} · 2` }];
    expect(nextArchiveLabel(existing, LABEL)).toBe(`${LABEL} · 3`);
  });

  it("ignores archives for other days/sessions", () => {
    const existing = [{ label: "13.06.2026 – LUNCH" }, { label: "14.06.2026 – DINNER" }];
    expect(nextArchiveLabel(existing, LABEL)).toBe(LABEL);
  });

  it("is safe with missing input", () => {
    expect(nextArchiveLabel(undefined, LABEL)).toBe(LABEL);
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
