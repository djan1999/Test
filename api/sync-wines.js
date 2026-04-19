/**
 * Milka Full Menu Sync — Vercel Cron Function
 * Runs nightly at 02:00 UTC (configured in vercel.json)
 *
 * Scrapes vinska-karta.hotelmilka.si and syncs:
 *   → wines table      : all wines by country
 *   → beverages table  : cocktails, beers, and all spirits subcategories
 *
 * Manual trigger (secret must match CRON_SECRET or SYNC_SECRET):
 *   GET /api/sync-wines?secret=...                     → full sync
 *   GET /api/sync-wines?secret=...&dry=true            → parse only, no DB write
 * Optional `config=` (URL-encoded JSON) overrides wine_sync_config for that request.
 */

import { createClient } from "@supabase/supabase-js";

// Vercel function timeout — the scrape can take 30-45 s for 15 pages.
// Default is 10 s on Hobby/Pro, which is why the sync was timing out.
export const config = { maxDuration: 60 };

const BASE = "https://vinska-karta.hotelmilka.si";
const FETCH_TIMEOUT_MS = 8000;
const RETRY_ATTEMPTS = 2;

// Use a realistic browser UA so the site's WAF/CDN doesn't reject the request.
// The hotel's wine-card site (WordPress) returns 403 to obvious bot UAs.
const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9,sl;q=0.8",
  "Cache-Control": "no-cache",
};

const WINE_COUNTRIES = [
  { param: "Slovenija",     label: "SI" },
  { param: "Avstrija",      label: "AT" },
  { param: "Italija",       label: "IT" },
  { param: "Francija",      label: "FR" },
  { param: "Hrva%C5%A1ka",  label: "HR" },
];

const BEVERAGE_PAGES = [
  { url: `${BASE}/category/cocktails/`,   category: "cocktail", label: "Cocktail"        },
  { url: `${BASE}/category/pivo/`,        category: "beer",     label: "Beer"            },
  { url: `${BASE}/category/viski`,        category: "spirit",   label: "Whisky"          },
  { url: `${BASE}/category/cognac`,       category: "spirit",   label: "Cognac / Brandy" },
  { url: `${BASE}/category/rum`,          category: "spirit",   label: "Rum"             },
  { url: `${BASE}/category/agave`,        category: "spirit",   label: "Agave"           },
  { url: `${BASE}/category/gin`,          category: "spirit",   label: "Gin"             },
  { url: `${BASE}/category/vodka`,        category: "spirit",   label: "Vodka"           },
  { url: `${BASE}/category/other-ostalo`, category: "spirit",   label: "Other"           },
  { url: `${BASE}/category/likerji`,      category: "spirit",   label: "Liqueur"         },
];

const DEFAULT_SYNC_CONFIG = {
  winesEnabled: true,
  beveragesEnabled: true,
  wineCountries: ["SI", "AT", "IT", "FR", "HR"],
  beveragePages: [
    { category: "cocktail", label: "Cocktail", url: `${BASE}/category/cocktails/` },
    { category: "beer", label: "Beer", url: `${BASE}/category/pivo/` },
    { category: "spirit", label: "Whisky", url: `${BASE}/category/viski` },
    { category: "spirit", label: "Cognac / Brandy", url: `${BASE}/category/cognac` },
    { category: "spirit", label: "Rum", url: `${BASE}/category/rum` },
    { category: "spirit", label: "Agave", url: `${BASE}/category/agave` },
    { category: "spirit", label: "Gin", url: `${BASE}/category/gin` },
    { category: "spirit", label: "Vodka", url: `${BASE}/category/vodka` },
    { category: "spirit", label: "Other", url: `${BASE}/category/other-ostalo` },
    { category: "spirit", label: "Liqueur", url: `${BASE}/category/likerji` },
  ],
};

export function parseSyncConfigFromRequestUrl(reqUrl) {
  try {
    // searchParams.get() already URL-decodes the value — no extra decodeURIComponent needed.
    const raw = new URL(reqUrl, "http://localhost").searchParams.get("config");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/** True when `provided` matches CRON_SECRET and/or SYNC_SECRET (trimmed). */
export function isAuthorizedSyncSecret(provided) {
  const cronSecret = String(process.env.CRON_SECRET || "").trim();
  const syncSecret = String(process.env.SYNC_SECRET || "").trim();
  if (!cronSecret && !syncSecret) return false;
  return Boolean(
    (cronSecret.length > 0 && provided === cronSecret) ||
      (syncSecret.length > 0 && provided === syncSecret)
  );
}

function normalizeSyncConfig(raw) {
  const cfg = raw && typeof raw === "object" ? raw : {};
  const normalizeCountries = () => {
    const source = Array.isArray(cfg.wineCountries) ? cfg.wineCountries : DEFAULT_SYNC_CONFIG.wineCountries;
    return source.map(v => String(v || "").trim().toUpperCase()).filter(Boolean);
  };
  const normalizePages = () => {
    const source = Array.isArray(cfg.beveragePages) ? cfg.beveragePages : DEFAULT_SYNC_CONFIG.beveragePages;
    return source
      .map((p) => ({
        category: String(p?.category || "").trim().toLowerCase(),
        label: String(p?.label || "").trim(),
        url: String(p?.url || "").trim(),
      }))
      .filter((p) => p.category && p.label && p.url);
  };
  return {
    winesEnabled: cfg.winesEnabled !== false,
    beveragesEnabled: cfg.beveragesEnabled !== false,
    wineCountries: normalizeCountries(),
    beveragePages: normalizePages(),
  };
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: BROWSER_HEADERS,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

export async function withRetry(fn, label, maxAttempts = RETRY_ATTEMPTS) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (attempt < maxAttempts) {
        const delay = 1000; // short fixed backoff — stay inside the 60 s function budget
        console.warn(`[sync] ${label} attempt ${attempt} failed (${e.message}), retrying in ${delay}ms…`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
}

export function extractCells(row) {
  const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
  const cells = [];
  let m;
  while ((m = tdRe.exec(row)) !== null) {
    cells.push(
      m[1].replace(/<[^>]+>/g, "")
        .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
        .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
        .replace(/&nbsp;/g, " ").replace(/&#039;/g, "'").replace(/&quot;/g, '"')
        .trim()
    );
  }
  return cells;
}

export function parseWinesFromHtml(html, countryLabel) {
  const wines = [];
  const tableRe = /<table[\s\S]*?<\/table>/gi;
  for (const table of html.match(tableRe) || []) {
    for (const row of table.match(/<tr[\s\S]*?<\/tr>/gi) || []) {
      const cells = extractCells(row);
      if (cells.length < 4) continue;
      let [rawProducer, rawName, vintage, region] = cells;
      if (!rawProducer || rawProducer.length > 80) continue;
      if (rawProducer.toLowerCase().includes("producer")) continue;
      const byGlass = /^\d+\.\s*/.test(rawProducer);
      const producer = rawProducer.replace(/^\d+\.\s*/, "").trim();
      const name = rawName.replace(/natural/gi, "").replace(/eco/gi, "").replace(/\s{2,}/g, " ").trim();
      if (!producer || !name) continue;
      const vintageClean = (vintage || "").trim() || "NV";
      const key = `${producer}|${name}|${vintageClean}|${countryLabel}`.toLowerCase().replace(/\s/g, "_");
      wines.push({ key, producer, name: `${producer} – ${name}`, wine_name: name, vintage: vintageClean, region: `${(region || "").trim()}, ${countryLabel}`, country: countryLabel, by_glass: byGlass });
    }
  }
  return wines;
}

export function parseBeveragesFromHtml(html, category, subcategoryLabel) {
  const beverages = [];
  const tableRe = /<table[\s\S]*?<\/table>/gi;
  for (const table of html.match(tableRe) || []) {
    for (const row of table.match(/<tr[\s\S]*?<\/tr>/gi) || []) {
      const cells = extractCells(row);
      if (cells.length < 2) continue;
      const name = cells[0];
      if (!name || name.length > 120) continue;
      if (["name", "ime", "naziv"].includes(name.toLowerCase())) continue;
      let displayName, notes;
      if (category === "spirit") {
        const producer = cells[1] || "";
        const region   = cells[2] || "";
        displayName = producer ? `${name} – ${producer}` : name;
        notes = [subcategoryLabel, region].filter(Boolean).join(", ");
      } else {
        displayName = name;
        notes = cells[1] || "";
      }
      beverages.push({ name: displayName, notes, category });
    }
  }
  return beverages;
}

async function fetchWineCountry({ param, label }) {
  const html = await withRetry(
    () => fetchHtml(`${BASE}/category/vino/?drzava=${param}`),
    `wines ${label}`
  );
  const wines = parseWinesFromHtml(html, label);
  console.log(`[sync] wines ${label} → ${wines.length}`);
  return { label, wines };
}

async function fetchBeveragePage({ url, category, label }) {
  const html = await withRetry(() => fetchHtml(url), label);
  const items = parseBeveragesFromHtml(html, category, label);
  console.log(`[sync] ${label} → ${items.length}`);
  return items;
}

export default async function handler(req, res) {
  const cronSecret = String(process.env.CRON_SECRET || "").trim();
  const syncSecret = String(process.env.SYNC_SECRET || "").trim();
  const authHeader = req.headers.authorization;
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const provided = bearerToken ||
    req.headers["x-cron-secret"] ||
    new URL(req.url, "http://localhost").searchParams.get("secret");
  if (!cronSecret && !syncSecret) {
    return res.status(500).json({ error: "CRON_SECRET or SYNC_SECRET not configured" });
  }
  if (!isAuthorizedSyncSecret(provided)) return res.status(401).json({ error: "Unauthorized" });

  const dry = new URL(req.url, "http://localhost").searchParams.get("dry") === "true";

  try {
    const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseKey) throw new Error("Supabase env vars not configured (SUPABASE_URL / SUPABASE_SERVICE_KEY)");
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: syncSettingsRow } = await supabase
      .from("service_settings")
      .select("state")
      .eq("id", "wine_sync_config")
      .maybeSingle();
    const configFromQuery = parseSyncConfigFromRequestUrl(req.url);
    const syncConfig = normalizeSyncConfig(
      configFromQuery !== null ? configFromQuery : (syncSettingsRow?.state || DEFAULT_SYNC_CONFIG)
    );
    const enabledWineCountries = WINE_COUNTRIES.filter((c) => syncConfig.wineCountries.includes(String(c.label || "").toUpperCase()));
    const enabledBeveragePages = BEVERAGE_PAGES.filter((page) => {
      const normalizedUrl = String(page.url || "").replace(/\/+$/, "");
      return syncConfig.beveragePages.some((cfgPage) =>
        cfgPage.category === page.category &&
        String(cfgPage.url || "").replace(/\/+$/, "") === normalizedUrl
      );
    });

    const [wineResults, bevResults] = await Promise.all([
      Promise.allSettled((syncConfig.winesEnabled ? enabledWineCountries : []).map(fetchWineCountry)),
      Promise.allSettled((syncConfig.beveragesEnabled ? enabledBeveragePages : []).map(fetchBeveragePage)),
    ]);

    const successfulCountries = wineResults.filter(r => r.status === "fulfilled").map(r => r.value);
    const failedCountries = enabledWineCountries.filter((_, i) => wineResults[i].status !== "fulfilled");
    if (failedCountries.length > 0) {
      console.warn(`[sync] failed countries: ${failedCountries.map(c => c.label).join(", ")}`);
    }
    const allWines = successfulCountries.flatMap(r => r.wines);
    const successfulBeveragePages = bevResults
      .map((r, i) => ({ result: r, page: enabledBeveragePages[i] }))
      .filter(x => x.result.status === "fulfilled");
    const failedBeveragePages = bevResults
      .map((r, i) => ({ result: r, page: enabledBeveragePages[i] }))
      .filter(x => x.result.status !== "fulfilled")
      .map(x => x.page.label);
    if (failedBeveragePages.length > 0) {
      console.warn(`[sync] failed beverage pages: ${failedBeveragePages.join(", ")}`);
    }
    const allBeverages = successfulBeveragePages.flatMap(x => x.result.value);

    const byGlassCount  = allWines.filter(w => w.by_glass).length;
    const cocktailCount = allBeverages.filter(b => b.category === "cocktail").length;
    const beerCount     = allBeverages.filter(b => b.category === "beer").length;
    const spiritCount   = allBeverages.filter(b => b.category === "spirit").length;

    if (dry) {
      return res.status(200).json({
        ok: true, dry: true,
        wines: allWines.length, byGlass: byGlassCount,
        cocktails: cocktailCount, beers: beerCount, spirits: spiritCount,
        failedCountries: failedCountries.map(c => c.label),
        failedBeveragePages,
        sampleCocktail: allBeverages.find(b => b.category === "cocktail"),
        sampleSpirit:   allBeverages.find(b => b.category === "spirit"),
        sampleBeer:     allBeverages.find(b => b.category === "beer"),
      });
    }

    // Sync wines — delete existing rows for synced countries, then insert fresh ones.
    // This avoids a huge NOT IN query (400+ keys would exceed PostgREST URL limits).
    let winesUpserted = 0;
    if (syncConfig.winesEnabled && successfulCountries.length > 0) {
      const seen = new Set();
      const uniqueWines = allWines.filter(w => { if (seen.has(w.key)) return false; seen.add(w.key); return true; });
      const syncedCountryLabels = successfulCountries.map(r => r.label);

      // Delete all existing wines for successfully-fetched countries first.
      // Countries that failed are left untouched so their wines remain available.
      const { error: deleteError } = await supabase
        .from("wines")
        .delete()
        .in("country", syncedCountryLabels);
      if (deleteError) console.warn("[sync] wines delete error:", deleteError.message);

      // Insert all fresh wines in batches.
      const BATCH = 200;
      for (let i = 0; i < uniqueWines.length; i += BATCH) {
        const { error } = await supabase.from("wines").insert(uniqueWines.slice(i, i + BATCH));
        if (error) throw error;
        winesUpserted += uniqueWines.slice(i, i + BATCH).length;
      }
    }

    // Sync beverages — replace each category independently so partial failures
    // don't wipe good data. A category is only deleted and re-written if every
    // page feeding it succeeded; failed categories keep their existing rows.
    let beveragesUpserted = 0;
    const skippedCategories = [];
    if (syncConfig.beveragesEnabled && enabledBeveragePages.length > 0) {
      const failedPagesByCategory = new Set(
        bevResults
          .map((r, i) => ({ r, page: enabledBeveragePages[i] }))
          .filter(x => x.r.status !== "fulfilled")
          .map(x => x.page.category)
      );
      const categoriesToWrite = [...new Set(enabledBeveragePages.map(p => p.category))]
        .filter(cat => !failedPagesByCategory.has(cat));
      skippedCategories.push(...failedPagesByCategory);

      if (categoriesToWrite.length > 0) {
        const rowsToWrite = [];
        for (const cat of categoriesToWrite) {
          let position = 0;
          for (const b of allBeverages.filter(x => x.category === cat)) {
            rowsToWrite.push({ category: cat, name: b.name, notes: b.notes || "", position: position++ });
          }
        }
        await supabase.from("beverages").delete().in("category", categoriesToWrite);
        if (rowsToWrite.length > 0) {
          const BATCH = 200;
          for (let i = 0; i < rowsToWrite.length; i += BATCH) {
            const { error } = await supabase.from("beverages").insert(rowsToWrite.slice(i, i + BATCH));
            if (error) throw error;
            beveragesUpserted += rowsToWrite.slice(i, i + BATCH).length;
          }
        }
      }
      if (skippedCategories.length > 0) {
        console.warn(`[sync] preserved existing rows for failed categories: ${skippedCategories.join(", ")}`);
      }
    }

    // If every enabled wine country failed (e.g. source site blocked all requests),
    // surface that as an explicit error so the UI shows "FAILED" rather than "0 wines".
    const allWinesFailed =
      syncConfig.winesEnabled &&
      enabledWineCountries.length > 0 &&
      successfulCountries.length === 0;
    if (allWinesFailed) {
      const sample = wineResults.find(r => r.status === "rejected")?.reason;
      const reason = sample?.message || "all source pages failed";
      return res.status(502).json({
        ok: false,
        error: `Could not fetch wine data from source site: ${reason}`,
        failedCountries: failedCountries.map(c => c.label),
        failedBeveragePages,
      });
    }

    const partial = failedCountries.length > 0 || failedBeveragePages.length > 0;
    return res.status(200).json({
      ok: true,
      partial,
      wines: winesUpserted, byGlass: byGlassCount,
      cocktails: cocktailCount, beers: beerCount, spirits: spiritCount,
      failedCountries: failedCountries.map(c => c.label),
      failedBeveragePages,
      skippedCategories,
      timestamp: new Date().toISOString(),
    });

  } catch (err) {
    console.error("[sync] Error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
