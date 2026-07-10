import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Supabase mock ────────────────────────────────────────────────────────────
// A chain-recording, awaitable PostgREST builder (same shape as the real
// supabase-js fluent client). Every method records its call and returns the
// builder so chains keep flowing; awaiting the builder (or calling a terminal
// like .single()/.maybeSingle()) resolves to a per-table configured result.
const sb = vi.hoisted(() => {
  const builders = [];
  const rpcCalls = [];
  // Terminal results keyed by table. Defaults to { data: null, error: null }.
  let resultsByTable = {};
  const VERBS = [
    "select", "insert", "upsert", "update", "delete",
    "eq", "match", "not", "is", "in", "order", "single", "maybeSingle", "gte", "lte",
  ];
  const makeBuilder = (table) => {
    const result = () =>
      Object.prototype.hasOwnProperty.call(resultsByTable, table)
        ? resultsByTable[table]
        : { data: null, error: null };
    const b = { _table: table, _calls: [] };
    VERBS.forEach((m) => {
      b[m] = (...args) => {
        b._calls.push([m, ...args]);
        return b;
      };
    });
    // Make the builder awaitable so `await supabase.from(t).insert(...)` works.
    b.then = (onFulfilled, onRejected) => Promise.resolve(result()).then(onFulfilled, onRejected);
    builders.push(b);
    return b;
  };
  return {
    builders,
    rpcCalls,
    reset(results = {}) {
      builders.length = 0;
      rpcCalls.length = 0;
      resultsByTable = results;
    },
    from: (table) => makeBuilder(table),
    rpc: (name, args) => {
      rpcCalls.push({ name, args });
      return Promise.resolve(resultsByTable[`rpc:${name}`] || { data: {}, error: null });
    },
    // Helper: all recorded builders for a given table.
    forTable: (table) => builders.filter((b) => b._table === table),
  };
});

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: (t) => sb.from(t),
    rpc: (name, args) => sb.rpc(name, args),
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) },
  }),
}));

import {
  extractCells,
  parseWinesFromHtml,
  parseBeveragesFromHtml,
  withRetry,
  isAuthorizedSyncSecret,
  parseSyncConfigFromRequestUrl,
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

  it("strips trailing natural/eco tags from wine name only", () => {
    const wines = parseWinesFromHtml(WINE_TABLE_HTML, "SI");
    const kolos = wines.find(w => w.wine_name.toLowerCase().includes("kolos"));
    expect(kolos.wine_name).not.toMatch(/natural$/i);
  });

  it("does not strip 'natural' from mid-word in wine name", () => {
    const html = `<table><tr><td>Movia</td><td>Supernatural blend</td><td>2020</td><td>Brda</td></tr></table>`;
    const [w] = parseWinesFromHtml(html, "SI");
    expect(w.wine_name.toLowerCase()).toContain("supernatural");
  });

  it("includes source sync on parsed rows", () => {
    const html = `<table><tr><td>Movia</td><td>Lunar</td><td>2019</td><td>Brda</td></tr></table>`;
    const [w] = parseWinesFromHtml(html, "SI");
    expect(w.source).toBe("sync");
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

  it("skips rows with fewer than 4 cells", () => {
    const html = `<table><tr><td>A</td><td>B</td><td>C</td></tr></table>`;
    expect(parseWinesFromHtml(html, "SI")).toEqual([]);
  });

  it("parses rows with exactly 4 cells (no price column)", () => {
    const html = `<table><tr><td>Movia</td><td>Lunar</td><td>2019</td><td>Brda</td></tr></table>`;
    const wines = parseWinesFromHtml(html, "SI");
    expect(wines.length).toBe(1);
    expect(wines[0].producer).toBe("Movia");
  });

  it("parses rows with volume and price columns after region (live site layout)", () => {
    const html = `<table><tr><td>05. Štemberger</td><td>Robinia</td><td>2018</td><td>Kras</td><td>0,1L / 0,75 L</td><td>12€ / 70€</td></tr></table>`;
    const wines = parseWinesFromHtml(html, "SI");
    expect(wines).toHaveLength(1);
    expect(wines[0].producer).toBe("Štemberger");
    expect(wines[0].wine_name).toBe("Robinia");
    expect(wines[0].region).toBe("Kras, Slovenia");
    expect(wines[0].country).toBe("SI");
    expect(wines[0].by_glass).toBe(true);
  });

  it("skips Slovenian header row label proizvajalec", () => {
    const html = `<table><tr><td>Proizvajalec</td><td>Znamka</td><td>Letnik</td><td>Regija</td></tr><tr><td>Movia</td><td>Lunar</td><td>2019</td><td>Brda</td></tr></table>`;
    const wines = parseWinesFromHtml(html, "SI");
    expect(wines).toHaveLength(1);
    expect(wines[0].producer).toBe("Movia");
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

  afterEach(() => {
    vi.useRealTimers();
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

  it("uses a fixed delay between retry attempts", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("fail 1"))
      .mockRejectedValueOnce(new Error("fail 2"))
      .mockResolvedValue("ok");

    const promise = withRetry(fn, "test", 3);

    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    const result = await promise;

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

// ── handler auth ────────────────────────────────────────────────────────────────

describe("isAuthorizedSyncSecret", () => {
  it("accepts CRON_SECRET when set", () => {
    const prevCron = process.env.CRON_SECRET;
    const prevSync = process.env.SYNC_SECRET;
    process.env.CRON_SECRET = "cron-only";
    delete process.env.SYNC_SECRET;
    try {
      expect(isAuthorizedSyncSecret("cron-only")).toBe(true);
      expect(isAuthorizedSyncSecret("wrong")).toBe(false);
    } finally {
      if (prevCron === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = prevCron;
      if (prevSync === undefined) delete process.env.SYNC_SECRET;
      else process.env.SYNC_SECRET = prevSync;
    }
  });

  it("accepts SYNC_SECRET when CRON_SECRET is unset", () => {
    const prevCron = process.env.CRON_SECRET;
    const prevSync = process.env.SYNC_SECRET;
    delete process.env.CRON_SECRET;
    process.env.SYNC_SECRET = "sync-only";
    try {
      expect(isAuthorizedSyncSecret("sync-only")).toBe(true);
      expect(isAuthorizedSyncSecret("wrong")).toBe(false);
    } finally {
      if (prevCron === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = prevCron;
      if (prevSync === undefined) delete process.env.SYNC_SECRET;
      else process.env.SYNC_SECRET = prevSync;
    }
  });

  it("accepts either secret when both are set", () => {
    const prevCron = process.env.CRON_SECRET;
    const prevSync = process.env.SYNC_SECRET;
    process.env.CRON_SECRET = "a";
    process.env.SYNC_SECRET = "b";
    try {
      expect(isAuthorizedSyncSecret("a")).toBe(true);
      expect(isAuthorizedSyncSecret("b")).toBe(true);
      expect(isAuthorizedSyncSecret("c")).toBe(false);
    } finally {
      if (prevCron === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = prevCron;
      if (prevSync === undefined) delete process.env.SYNC_SECRET;
      else process.env.SYNC_SECRET = prevSync;
    }
  });
});

describe("parseSyncConfigFromRequestUrl", () => {
  it("returns null when config param is absent", () => {
    expect(parseSyncConfigFromRequestUrl("http://localhost/api/sync-wines?dry=true")).toBeNull();
  });

  it("parses JSON config from query string", () => {
    const cfg = { wineCountries: ["SI"], beveragesEnabled: false };
    const encoded = encodeURIComponent(JSON.stringify(cfg));
    const parsed = parseSyncConfigFromRequestUrl(`http://localhost/api/sync-wines?config=${encoded}`);
    expect(parsed).toEqual(cfg);
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

  it("allows any authenticated workspace member to sync only its active workspace", async () => {
    const req = {
      method: "POST",
      url: "http://localhost/api/sync-wines?dry=true",
      headers: { authorization: "Bearer user-access-token" },
      body: { workspaceId: "demo-ws", config: { winesEnabled: false, beveragesEnabled: false } },
    };
    const res = {
      statusCode: 200,
      payload: null,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.payload = body; return this; },
    };
    const previous = {
      url: process.env.SUPABASE_URL,
      key: process.env.SUPABASE_SERVICE_KEY,
    };
    process.env.SUPABASE_URL = "https://fake.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "server-only-key";
    sb.reset({
      workspace_members: { data: { user_id: "user-1" }, error: null },
    });
    try {
      await handler(req, res);
      expect(res.statusCode).toBe(200);
      expect(res.payload).toMatchObject({ ok: true, dry: true });
      expect(sb.forTable("workspaces")).toHaveLength(0);
      expect(sb.forTable("workspace_members")[0]._calls).toContainEqual(["eq", "workspace_id", "demo-ws"]);
    } finally {
      if (previous.url === undefined) delete process.env.SUPABASE_URL;
      else process.env.SUPABASE_URL = previous.url;
      if (previous.key === undefined) delete process.env.SUPABASE_SERVICE_KEY;
      else process.env.SUPABASE_SERVICE_KEY = previous.key;
    }
  });

  it("rejects an account that is not a member of the requested workspace", async () => {
    const req = {
      method: "POST",
      url: "http://localhost/api/sync-wines?dry=true",
      headers: { authorization: "Bearer user-access-token" },
      body: { workspaceId: "milka-ws", config: { winesEnabled: false, beveragesEnabled: false } },
    };
    const res = {
      statusCode: 200,
      payload: null,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.payload = body; return this; },
    };
    const previous = {
      url: process.env.SUPABASE_URL,
      key: process.env.SUPABASE_SERVICE_KEY,
    };
    process.env.SUPABASE_URL = "https://fake.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "server-only-key";
    sb.reset({
      workspace_members: { data: null, error: null },
    });
    try {
      await handler(req, res);
      expect(res.statusCode).toBe(403);
    } finally {
      if (previous.url === undefined) delete process.env.SUPABASE_URL;
      else process.env.SUPABASE_URL = previous.url;
      if (previous.key === undefined) delete process.env.SUPABASE_SERVICE_KEY;
      else process.env.SUPABASE_SERVICE_KEY = previous.key;
    }
  });
});

describe("sync-wines handler — all-wine-pages-failed returns 502", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("returns 502 with descriptive error when all wine countries fail", async () => {
    const req = {
      url: `http://localhost/api/sync-wines?dry=false`,
      headers: { authorization: "Bearer s" },
    };
    const res = {
      statusCode: 200,
      payload: null,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.payload = body; return this; },
    };

    const prevCron = process.env.CRON_SECRET;
    const prevSync = process.env.SYNC_SECRET;
    const prevUrl  = process.env.SUPABASE_URL;
    const prevKey  = process.env.SUPABASE_SERVICE_KEY;
    const prevVUrl = process.env.VITE_SUPABASE_URL;
    const prevVKey = process.env.VITE_SUPABASE_ANON_KEY;

    process.env.CRON_SECRET = "s";
    delete process.env.SYNC_SECRET;
    process.env.SUPABASE_URL = "https://fake.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "fake-key";
    delete process.env.VITE_SUPABASE_URL;
    delete process.env.VITE_SUPABASE_ANON_KEY;

    // Workspace resolves fine; the 502 must come from the failed scrape, not
    // from the workspace lookup. service_settings falls back to defaults (null).
    sb.reset({ workspaces: { data: { id: "milka-ws" }, error: null } });

    // Patch global fetch so every page request fails with 403 immediately.
    const realFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => "",
    });

    try {
      const handlerPromise = handler(req, res);
      // Advance past the withRetry back-off delay (1 s per page; all 15 pages are parallel).
      // Don't use runAllTimersAsync() — AbortSignal.timeout() creates recurring internal
      // timers that would trigger vitest's infinite-loop guard.
      await vi.advanceTimersByTimeAsync(2000);
      await handlerPromise;
      expect(res.statusCode).toBe(502);
      expect(res.payload.ok).toBe(false);
      expect(res.payload.error).toMatch(/source site/i);
    } finally {
      globalThis.fetch = realFetch;
      if (prevCron === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = prevCron;
      if (prevSync === undefined) delete process.env.SYNC_SECRET; else process.env.SYNC_SECRET = prevSync;
      if (prevUrl  === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = prevUrl;
      if (prevKey  === undefined) delete process.env.SUPABASE_SERVICE_KEY; else process.env.SUPABASE_SERVICE_KEY = prevKey;
      if (prevVUrl === undefined) delete process.env.VITE_SUPABASE_URL; else process.env.VITE_SUPABASE_URL = prevVUrl;
      if (prevVKey === undefined) delete process.env.VITE_SUPABASE_ANON_KEY; else process.env.VITE_SUPABASE_ANON_KEY = prevVKey;
    }
  });
});

describe("sync-wines handler — workspace scoping (Milka)", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  // Wine table: producer | name | vintage | region | volume | price.
  const WINE_HTML = `<table>
    <tr><td>Movia</td><td>Lunar</td><td>2019</td><td>Brda</td><td>0,75L</td><td>38€</td></tr>
  </table>`;
  // Two-column table parses as a beverage row for whatever category the page declares.
  const BEV_HTML = `<table>
    <tr><td>Negroni</td><td>Classic cocktail</td></tr>
  </table>`;

  it("sends one workspace-scoped atomic catalog replacement RPC", async () => {
    const req = {
      url: `http://localhost/api/sync-wines?dry=false`,
      headers: { authorization: "Bearer s" },
    };
    const res = {
      statusCode: 200,
      payload: null,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.payload = body; return this; },
    };

    const prevCron = process.env.CRON_SECRET;
    const prevSync = process.env.SYNC_SECRET;
    const prevUrl  = process.env.SUPABASE_URL;
    const prevKey  = process.env.SUPABASE_SERVICE_KEY;
    const prevVUrl = process.env.VITE_SUPABASE_URL;
    const prevVKey = process.env.VITE_SUPABASE_ANON_KEY;

    process.env.CRON_SECRET = "s";
    delete process.env.SYNC_SECRET;
    process.env.SUPABASE_URL = "https://fake.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "fake-key";
    delete process.env.VITE_SUPABASE_URL;
    delete process.env.VITE_SUPABASE_ANON_KEY;

    // workspaces lookup resolves to a fake Milka id; service_settings has no row
    // (state: null) so the handler falls back to the default sync config, which
    // enables every wine country and beverage page.
    sb.reset({ workspaces: { data: { id: "milka-ws" }, error: null } });

    // Every scrape succeeds: wine pages return a wine table, beverage pages a
    // 2-column table that parses for that page's declared category.
    const realFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation((url) => Promise.resolve({
      ok: true,
      status: 200,
      text: async () => (String(url).includes("/category/vino/") ? WINE_HTML : BEV_HTML),
    }));

    try {
      const handlerPromise = handler(req, res);
      // Network phase is parallel; no retries fire on success, but advance timers
      // anyway in case any back-off is scheduled.
      await vi.advanceTimersByTimeAsync(2000);
      await handlerPromise;

      expect(res.statusCode).toBe(200);
      expect(res.payload.ok).toBe(true);

      expect(sb.rpcCalls).toHaveLength(1);
      const call = sb.rpcCalls[0];
      expect(call.name).toBe("replace_synced_catalog");
      expect(call.args.p_workspace_id).toBe("milka-ws");
      expect(call.args.p_wines.length).toBeGreaterThan(0);
      expect(call.args.p_beverages.length).toBeGreaterThan(0);
      expect(call.args.p_wine_countries).toEqual(expect.arrayContaining(["SI", "AT", "IT", "FR", "HR"]));
      expect(call.args.p_beverage_categories).toEqual(expect.arrayContaining(["cocktail", "beer", "spirit"]));

      // ── service_settings read is scoped to the workspace too ────────────────
      const settingsReads = sb.forTable("service_settings");
      expect(settingsReads.length).toBeGreaterThan(0);
      expect(settingsReads.every((b) =>
        b._calls.some((c) => c[0] === "eq" && c[1] === "workspace_id" && c[2] === "milka-ws")
      )).toBe(true);
    } finally {
      globalThis.fetch = realFetch;
      if (prevCron === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = prevCron;
      if (prevSync === undefined) delete process.env.SYNC_SECRET; else process.env.SYNC_SECRET = prevSync;
      if (prevUrl  === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = prevUrl;
      if (prevKey  === undefined) delete process.env.SUPABASE_SERVICE_KEY; else process.env.SUPABASE_SERVICE_KEY = prevKey;
      if (prevVUrl === undefined) delete process.env.VITE_SUPABASE_URL; else process.env.VITE_SUPABASE_URL = prevVUrl;
      if (prevVKey === undefined) delete process.env.VITE_SUPABASE_ANON_KEY; else process.env.VITE_SUPABASE_ANON_KEY = prevVKey;
    }
  });
});
