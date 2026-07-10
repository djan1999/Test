/**
 * Workspace Catalog Sync — Vercel Cron + authenticated manual function
 * Runs nightly at 02:00 UTC (configured in vercel.json)
 *
 * Scrapes vinska-karta.hotelmilka.si and syncs:
 *   → wines table      : all wines by country
 *   → beverages table  : cocktails, beers, and all spirits subcategories
 *
 * Cron trigger: GET with Vercel's Authorization: Bearer CRON_SECRET header.
 * Manual trigger: POST with the signed-in Supabase access token and active
 * workspace id. Cron targets Milka; manual sync targets only that membership.
 * Browser-visible build variables must never contain a server secret.
 */

import { createClient } from "@supabase/supabase-js";

// Vercel function timeout — the scrape can take 30-45 s for 15 pages.
// Default is 10 s on Hobby/Pro, which is why the sync was timing out.
export const config = { maxDuration: 60 };

const BASE = "https://vinska-karta.hotelmilka.si";
// Per-page budget: 2 attempts × 10 s + 1 s back-off = worst case 21 s per page.
// All 15 pages run in parallel, so the network phase is bounded by the slowest
// page (~21 s) and leaves ample headroom under the 60 s function cap for
// Supabase deletes + batched inserts. Previously 3 × 12 s = 38 s, which could
// blow past 60 s when the source WordPress site responded slowly.
const FETCH_TIMEOUT_MS = 10000;
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
  { param: "Slovenija",     label: "SI", name: "Slovenia" },
  { param: "Avstrija",      label: "AT", name: "Austria"  },
  { param: "Italija",       label: "IT", name: "Italy"    },
  { param: "Francija",      label: "FR", name: "France"   },
  { param: "Hrva%C5%A1ka",  label: "HR", name: "Croatia"  },
];

// Country code → full name, used when formatting the region string that ends
// up in the admin drinks editor. Kept in sync with src/constants/countries.js.
const COUNTRY_NAMES = {
  SI: "Slovenia", AT: "Austria", IT: "Italy", FR: "France", HR: "Croatia",
  ES: "Spain", DE: "Germany", PT: "Portugal", GR: "Greece", HU: "Hungary",
  CH: "Switzerland", GE: "Georgia", RO: "Romania", BG: "Bulgaria", RS: "Serbia",
  CZ: "Czech Republic", SK: "Slovakia", MD: "Moldova", AM: "Armenia",
  US: "USA", AR: "Argentina", CL: "Chile", AU: "Australia", NZ: "New Zealand",
  ZA: "South Africa", UY: "Uruguay",
};

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
        url: String(p?.url || "").trim().replace(/\/+$/, ""),
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

/** Same trailing-slash normalization as saved sync config (stable URL compare). */
function canonicalBeverageUrl(url) {
  return String(url || "").trim().replace(/\/+$/, "");
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
      // Site tables use producer | wine name | vintage | region | [volume] | [price]
      let rawProducer = cells[0];
      let rawName = cells[1];
      let vintage = cells[2];
      let region = cells[3];
      if (!rawProducer || rawProducer.length > 80) continue;
      if (rawProducer.toLowerCase().includes("producer") || rawProducer.toLowerCase().includes("proizvajalec")) continue;
      const byGlass = /^\d+\.\s*/.test(rawProducer);
      const producer = rawProducer.replace(/^\d+\.\s*/, "").trim();
      const name = rawName
        .replace(/(?:natural|eco)+\s*$/gi, "")
        .replace(/\s{2,}/g, " ")
        .trim();
      if (!producer || !name) continue;
      const vintageClean = (vintage || "").trim() || "NV";
      const key = `${producer}|${name}|${vintageClean}|${countryLabel}`.toLowerCase().replace(/\s/g, "_");
      const countryName = COUNTRY_NAMES[countryLabel] || countryLabel;
      wines.push({
        key,
        source: "sync",
        producer,
        name: `${producer} – ${name}`,
        wine_name: name,
        vintage: vintageClean,
        region: `${(region || "").trim()}, ${countryName}`,
        country: countryLabel,
        by_glass: byGlass,
      });
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
        // cocktails/beers: description is col 1; extra cols (volume, price) are ignored
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
  if (wines.length === 0) {
    throw new Error(`Source page for ${label} returned no wine rows; preserving existing data`);
  }
  console.log(`[sync] wines ${label} → ${wines.length}`);
  return { label, wines };
}

async function fetchBeveragePage({ url, category, label }) {
  const html = await withRetry(() => fetchHtml(url), label);
  const items = parseBeveragesFromHtml(html, category, label);
  if (items.length === 0) {
    throw new Error(`Source page for ${label} returned no beverage rows; preserving existing data`);
  }
  console.log(`[sync] ${label} → ${items.length}`);
  return items;
}

export default async function handler(req, res) {
  const authHeader = req.headers.authorization;
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const serverAuthorized = isAuthorizedSyncSecret(
    bearerToken || req.headers["x-cron-secret"],
  );
  if (String(req.method || "GET").toUpperCase() !== "POST" && !serverAuthorized) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const dry = new URL(req.url, "http://localhost").searchParams.get("dry") === "true";

  try {
    const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
    // Accept the service-role key under its documented name and common aliases,
    // including Supabase's newer secret-key format (sb_secret_...). The anon key
    // is only a last resort — it can READ public data, but every insert/delete
    // below needs the service role to bypass RLS.
    const serviceKey =
      process.env.SUPABASE_SERVICE_KEY ||
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SECRET_KEY;
    const supabaseKey = serviceKey;
    if (!supabaseUrl || !supabaseKey) {
      throw new Error("Supabase not configured: set SUPABASE_URL and SUPABASE_SERVICE_KEY in the deployment environment.");
    }
    const supabase = createClient(supabaseUrl, supabaseKey);

    // A cron may authenticate with a server-only secret. A person pressing the
    // admin button must authenticate with their normal short-lived Supabase
    // access token, which is verified server-side before any service-role work.
    let requestingUserId = null;
    let requestBody = {};
    if (String(req.method || "GET").toUpperCase() === "POST" && req.body != null) {
      try {
        requestBody = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
        if (!requestBody || typeof requestBody !== "object") requestBody = {};
      } catch {
        return res.status(400).json({ error: "Invalid JSON request body" });
      }
    }
    if (!serverAuthorized) {
      if (String(req.method || "GET").toUpperCase() !== "POST" || !bearerToken) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      const { data: authData, error: authError } = await supabase.auth.getUser(bearerToken);
      if (authError || !authData?.user?.id) {
        return res.status(401).json({ error: "Your login expired. Sign in again and retry." });
      }
      requestingUserId = authData.user.id;
    }

    let WORKSPACE_ID;
    if (requestingUserId) {
      // A manual sync belongs to the active restaurant, including the isolated
      // Demo sandbox. Never infer Milka here: that made a test-account button
      // overwrite the production catalogue.
      WORKSPACE_ID = String(requestBody.workspaceId || "").trim();
      if (!WORKSPACE_ID) {
        return res.status(400).json({ error: "No active restaurant was supplied." });
      }
      const { data: membership, error: membershipError } = await supabase
        .from("workspace_members").select("user_id")
        .eq("workspace_id", WORKSPACE_ID).eq("user_id", requestingUserId).maybeSingle();
      if (membershipError || !membership) {
        return res.status(403).json({ error: "This account is not linked to that restaurant." });
      }
    } else {
      // Scheduled server sync remains deliberately fixed to Milka. The
      // service-role client bypasses RLS, so the target must be explicit.
      const { data: milkaWs, error: wsErr } = await supabase
        .from("workspaces").select("id").eq("slug", "milka").single();
      if (wsErr || !milkaWs) {
        const msg = wsErr?.message || "not found";
        if (/invalid api key|jwt|api ?key/i.test(msg)) {
          throw new Error(
            `Supabase rejected the server key ("${msg}"). Set SUPABASE_SERVICE_KEY to the current service_role / secret key for the project at SUPABASE_URL (${supabaseUrl}) and redeploy. A stale key — or a URL and key that belong to different projects — is the usual cause.`
          );
        }
        throw new Error(`Could not resolve Milka workspace: ${msg}`);
      }
      WORKSPACE_ID = milkaWs.id;
    }

    const { data: syncSettingsRow } = await supabase
      .from("service_settings")
      .select("state")
      .eq("id", "wine_sync_config")
      .eq("workspace_id", WORKSPACE_ID)
      .maybeSingle();
    let configFromRequest = parseSyncConfigFromRequestUrl(req.url);
    if (requestBody.config && typeof requestBody.config === "object") configFromRequest = requestBody.config;
    const syncConfig = normalizeSyncConfig(
      configFromRequest !== null ? configFromRequest : (syncSettingsRow?.state || DEFAULT_SYNC_CONFIG)
    );
    const enabledWineCountries = WINE_COUNTRIES.filter((c) => syncConfig.wineCountries.includes(String(c.label || "").toUpperCase()));
    const enabledBeveragePages = BEVERAGE_PAGES.filter((page) => {
      const normalizedUrl = canonicalBeverageUrl(page.url);
      return syncConfig.beveragePages.some((cfgPage) =>
        cfgPage.category === page.category &&
        canonicalBeverageUrl(cfgPage.url) === normalizedUrl
      );
    });

    const wineTargets = syncConfig.winesEnabled ? enabledWineCountries : [];
    const beverageTargets = syncConfig.beveragesEnabled ? enabledBeveragePages : [];
    const [wineResults, bevResults] = await Promise.all([
      Promise.allSettled(wineTargets.map(fetchWineCountry)),
      Promise.allSettled(beverageTargets.map(fetchBeveragePage)),
    ]);

    const successfulCountries = wineResults.filter(r => r.status === "fulfilled").map(r => r.value);
    const failedCountries = wineTargets.filter((_, i) => wineResults[i].status !== "fulfilled");
    if (failedCountries.length > 0) {
      console.warn(`[sync] failed countries: ${failedCountries.map(c => c.label).join(", ")}`);
    }
    const allWines = successfulCountries.flatMap(r => r.wines);
    const successfulBeveragePages = bevResults
      .map((r, i) => ({ result: r, page: beverageTargets[i] }))
      .filter(x => x.result.status === "fulfilled");
    const failedBeveragePages = bevResults
      .map((r, i) => ({ result: r, page: beverageTargets[i] }))
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

    // If every enabled wine country failed, do not modify either catalog. A
    // source site outage must never look like a valid empty menu.
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

    const seenWineKeys = new Set();
    const uniqueWines = allWines.filter((wine) => {
      if (seenWineKeys.has(wine.key)) return false;
      seenWineKeys.add(wine.key);
      return true;
    });
    const syncedCountryLabels = successfulCountries.map((result) => result.label);

    const skippedCategories = [];
    const categoriesToWrite = [];
    const rowsToWrite = [];
    if (syncConfig.beveragesEnabled && enabledBeveragePages.length > 0) {
      const failedPagesByCategory = new Set(
        bevResults
          .map((r, i) => ({ r, page: enabledBeveragePages[i] }))
          .filter(x => x.r.status !== "fulfilled")
          .map(x => x.page.category)
      );
      categoriesToWrite.push(
        ...[...new Set(enabledBeveragePages.map(p => p.category))]
          .filter(cat => !failedPagesByCategory.has(cat)),
      );
      skippedCategories.push(...failedPagesByCategory);

      if (categoriesToWrite.length > 0) {
        for (const cat of categoriesToWrite) {
          let position = 0;
          for (const b of allBeverages.filter(x => x.category === cat)) {
            rowsToWrite.push({ category: cat, name: b.name, notes: b.notes || "", position: position++, source: "sync" });
          }
        }
      }
      if (skippedCategories.length > 0) {
        console.warn(`[sync] preserved existing rows for failed categories: ${skippedCategories.join(", ")}`);
      }
    }

    // One Postgres function owns the replacement transaction. Any delete or
    // insert failure rolls the whole catalog change back, and only categories
    // whose source pages succeeded are touched.
    const { error: replaceError } = await supabase.rpc("replace_synced_catalog", {
      p_workspace_id: WORKSPACE_ID,
      p_wines: uniqueWines,
      p_wine_countries: syncedCountryLabels,
      p_beverages: rowsToWrite,
      p_beverage_categories: categoriesToWrite,
    });
    if (replaceError) {
      const hint = /replace_synced_catalog|schema cache|function/i.test(replaceError.message || "")
        ? " Apply the bundled Supabase migration before deploying this build."
        : "";
      throw new Error(`Catalog transaction failed: ${replaceError.message}.${hint}`);
    }

    const winesUpserted = uniqueWines.length;
    const beveragesUpserted = rowsToWrite.length;

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
