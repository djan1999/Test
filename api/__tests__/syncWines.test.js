import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  extractCells,
  parseWinesFromHtml,
  parseBeveragesFromHtml,
  withRetry,
  resolveSyncConfig,
} from "../sync-wines.js";
import handler from "../sync-wines.js";

// ── extractCells ───────────────────────────────────────────────────────────────

describe("extractCells", () => {
  it("extracts text from <td> elements", () => {
    expect(extractCells("<tr><td>Producer</td><td>Wine Name</td></tr>"))
      .toEqual(["Producer", "Wine Name"]);
  });

  it("strips inner HTML tags", () => {
    expect(extractCells("<tr><td><strong>Bold</strong></td></tr>"))
      .toEqual(["Bold"]);
  });

  it("decodes HTML entities", () => {
    expect(extractCells("<tr><td>Vina &amp; Spirits</td></tr>"))
      .toEqual(["Vina & Spirits"]);
    expect(extractCells("<tr><td>&nbsp;Space</td></tr>"))
      .toEqual(["Space"]);
    expect(extractCells("<tr><td>&#039;Apostrophe&#039;</td></tr>"))
      .toEqual(["'Apostrophe'"]);
    expect(extractCells("<tr><td>&quot;Quoted&quot;</td></tr>"))
      .toEqual(['"Quoted"']);
  });

  it("decodes numeric HTML entities", () => {
    expect(extractCells("<tr><td>&#65;</td></tr>")).toEqual(["A"]);
  });

  it("returns empty array for row with no <td>", () => {
    expect(extractCells("<tr><th>Header</th></tr>")).toEqual([]);
  });

  it("trims whitespace from cell content", () => {
    expect(extractCells("<tr><td>  trimmed  </td></tr>")).toEqual(["trimmed"]);
  });
});

// ── parseWinesFromHtml ─────────────────────────────────────────────────────────

const WINE_TABLE_HTML = `
<table>
  <tr><td>Producer</td><td>Wine</td><td>2020</td><td>Brda</td><td>45</td></tr>
  <tr><td>Movia</td><td>Lunar</td><td>2019</td><td>Brda</td><td>38</td></tr>
  <tr><td>11. Edi Simčič</td><td>Kolos natural</td><td>2018</td><td>Vipava</td><td>42</td></tr>
</table>
`;

describe("parseWinesFromHtml", () => {
  it("parses wine rows from an HTML table", () => {
    const wines = parseWinesFromHtml(WINE_TABLE_HTML, "SI");
    expect(wines.length).toBeGreaterThan(0);
  });

  it("skips header rows containing 'producer'", () => {
    const wines = parseWinesFromHtml(WINE_TABLE_HTML, "SI");
    expect(wines.every(w => !w.producer.toLowerCase().includes("producer"))).toBe(true);
  });

  it("assigns the correct country label", () => {
    const wines = parseWinesFromHtml(WINE_TABLE_HTML, "SI");
    expect(wines.every(w => w.country === "SI")).toBe(true);
  });

  it("detects by-glass wines from numeric prefix (e.g. '11.')", () => {
    const wines = parseWinesFromHtml(WINE_TABLE_HTML, "SI");
    const byGlass = wines.find(w => w.producer.includes("Edi Simčič"));
    expect(byGlass).toBeDefined();
    expect(byGlass.by_glass).toBe(true);
  });

  it("detects by-glass wines from single-digit prefix (e.g. '1.')", () => {
    const html = `<table><tr><td>1. Movia</td><td>Lunar</td><td>2019</td><td>Brda</td><td>38</td></tr></table>`;
    const [wine] = parseWinesFromHtml(html, "SI");
    expect(wine.by_glass).toBe(true);
    expect(wine.producer).toBe("Movia");
  });

  it("strips numeric prefix from producer name", () => {
    const wines = parseWinesFromHtml(WINE_TABLE_HTML, "SI");
    const w = wines.find(w => w.producer.includes("Edi Simčič"));
    expect(w.producer).not.toMatch(/^\d+\./);
  });

  it("strips 'natural' and 'eco' from wine name", () => {
    const wines = parseWinesFromHtml(WINE_TABLE_HTML, "SI");
    const kolos = wines.find(w => w.wine_name.toLowerCase().includes("kolos"));
    expect(kolos.wine_name).not.toMatch(/natural/i);
  });

  it("generates a deterministic key", () => {
    const wines = parseWinesFromHtml(WINE_TABLE_HTML, "SI");
    wines.forEach(w => {
      expect(typeof w.key).toBe("string");
      expect(w.key.length).toBeGreaterThan(0);
    });
  });

  it("uses 'NV' as vintage when vintage cell is empty", () => {
    const html = `<table><tr><td>Movia</td><td>Lunar</td><td></td><td>Brda</td><td>38</td></tr></table>`;
    const [wine] = parseWinesFromHtml(html, "SI");
    expect(wine.vintage).toBe("NV");
  });

  it("returns empty array when no table present", () => {
    expect(parseWinesFromHtml("<div>no table here</div>", "SI")).toEqual([]);
  });

  it("returns empty array for empty HTML", () => {
    expect(parseWinesFromHtml("", "SI")).toEqual([]);
  });

  it("skips rows with fewer than 5 cells", () => {
    const html = `<table><tr><td>A</td><td>B</td></tr></table>`;
    expect(parseWinesFromHtml(html, "SI")).toEqual([]);
  });
});

// ── parseBeveragesFromHtml ─────────────────────────────────────────────────────

const COCKTAIL_HTML = `
<table>
  <tr><td>Name</td><td>Description</td></tr>
  <tr><td>Negroni</td><td>Classic cocktail</td></tr>
  <tr><td>Spritz</td><td>Light and fizzy</td></tr>
</table>
`;

const SPIRIT_HTML = `
<table>
  <tr><td>Name</td><td>Producer</td><td>Region</td><td>ABV</td><td>Notes</td></tr>
  <tr><td>Glenfiddich 12</td><td>Glenfiddich</td><td>Speyside</td><td>40%</td><td></td></tr>
</table>
`;

describe("parseBeveragesFromHtml", () => {
  it("parses cocktail rows from HTML", () => {
    const beverages = parseBeveragesFromHtml(COCKTAIL_HTML, "cocktail", "Cocktail");
    expect(beverages.length).toBeGreaterThan(0);
  });

  it("skips header rows (name/ime/naziv)", () => {
    const beverages = parseBeveragesFromHtml(COCKTAIL_HTML, "cocktail", "Cocktail");
    expect(beverages.every(b => !["name", "ime", "naziv"].includes(b.name.toLowerCase()))).toBe(true);
  });

  it("assigns the correct category", () => {
    const beverages = parseBeveragesFromHtml(COCKTAIL_HTML, "cocktail", "Cocktail");
    expect(beverages.every(b => b.category === "cocktail")).toBe(true);
  });

  it("uses notes column as description for cocktails", () => {
    const beverages = parseBeveragesFromHtml(COCKTAIL_HTML, "cocktail", "Cocktail");
    const negroni = beverages.find(b => b.name === "Negroni");
    expect(negroni.notes).toBe("Classic cocktail");
  });

  it("combines name and producer for spirits", () => {
    const beverages = parseBeveragesFromHtml(SPIRIT_HTML, "spirit", "Whisky");
    const whisky = beverages.find(b => b.name.includes("Glenfiddich 12"));
    expect(whisky).toBeDefined();
    expect(whisky.name).toContain("Glenfiddich");
  });

  it("includes subcategory label in spirit notes", () => {
    const beverages = parseBeveragesFromHtml(SPIRIT_HTML, "spirit", "Whisky");
    expect(beverages[0].notes).toContain("Whisky");
  });

  it("uses the region column for spirit notes (not ABV)", () => {
    const beverages = parseBeveragesFromHtml(SPIRIT_HTML, "spirit", "Whisky");
    expect(beverages[0].notes).toContain("Speyside");
    expect(beverages[0].notes).not.toContain("40%");
  });

  it("returns empty array for empty HTML", () => {
    expect(parseBeveragesFromHtml("", "cocktail", "Cocktail")).toEqual([]);
  });

  it("skips rows with fewer than 2 cells", () => {
    const html = `<table><tr><td>OnlyOne</td></tr></table>`;
    expect(parseBeveragesFromHtml(html, "cocktail", "Cocktail")).toEqual([]);
  });
});

// ── withRetry ──────────────────────────────────────────────────────────────────

describe("withRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("returns result immediately on first success", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn, "test", 3);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on failure and succeeds on second attempt", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValue("ok");

    const promise = withRetry(fn, "test", 3);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("throws after exhausting all attempts", async () => {
    const error = new Error("always fails");
    const fn = vi.fn().mockRejectedValue(error);

    // Attach .catch() immediately to prevent unhandled rejection warning
    let caughtError;
    const promise = withRetry(fn, "test", 3).catch(e => { caughtError = e; });
    await vi.runAllTimersAsync();
    await promise;

    expect(caughtError).toBe(error);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("uses exponential backoff — delays grow with each retry", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("fail 1"))
      .mockRejectedValueOnce(new Error("fail 2"))
      .mockResolvedValue("ok");

    // Advance timers in steps to verify both retry delays fire
    const promise = withRetry(fn, "test", 3);

    // After attempt 1 fails, a 1000ms timer is pending
    await vi.advanceTimersByTimeAsync(1000);
    // After attempt 2 fails, a 2000ms timer is pending
    await vi.advanceTimersByTimeAsync(2000);
    const result = await promise;

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

// ── handler auth ────────────────────────────────────────────────────────────────

describe("resolveSyncConfig", () => {
  it("uses DB state when no config query param", () => {
    const cfg = resolveSyncConfig("http://localhost/api/sync-wines?dry=true", {
      wineCountries: ["SI"],
      beveragePages: [],
    });
    expect(cfg.wineCountries).toEqual(["SI"]);
    expect(cfg.beveragePages).toEqual([]);
  });

  it("prefers URL config over DB when config param is valid JSON", () => {
    const urlCfg = {
      wineCountries: ["SI", "AT"],
      beveragePages: [
        { category: "cocktail", label: "Cocktail", url: "https://example.com/cocktails/" },
      ],
    };
    const encoded = encodeURIComponent(JSON.stringify(urlCfg));
    const cfg = resolveSyncConfig(
      `http://localhost/api/sync-wines?config=${encoded}`,
      { wineCountries: ["HR"], beveragePages: [] },
    );
    expect(cfg.wineCountries).toEqual(["SI", "AT"]);
    expect(cfg.beveragePages).toHaveLength(1);
    expect(cfg.beveragePages[0].url).toBe("https://example.com/cocktails/");
  });

  it("falls back to DB when config param is invalid JSON", () => {
    const cfg = resolveSyncConfig(
      "http://localhost/api/sync-wines?config=not-json",
      { wineCountries: ["FR"], winesEnabled: true },
    );
    expect(cfg.wineCountries).toEqual(["FR"]);
  });
});

describe("sync-wines handler auth", () => {
  it("requires CRON secret even when sec-fetch-site is same-origin", async () => {
    const req = {
      url: "http://localhost/api/sync-wines?dry=true",
      headers: {
        "sec-fetch-site": "same-origin",
      },
    };
    const res = {
      statusCode: 200,
      payload: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        this.payload = body;
        return this;
      },
    };

    const prevSecret = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "super-secret";
    try {
      await handler(req, res);
      expect(res.statusCode).toBe(401);
      expect(res.payload).toEqual({ error: "Unauthorized" });
    } finally {
      if (prevSecret === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = prevSecret;
    }
  });
});
