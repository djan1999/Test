/**
 * Milka Full Menu Sync — Vercel Cron Function
 * Runs nightly at 02:00 UTC (configured in vercel.json)
 *
 * Scrapes vinska-karta.hotelmilka.si and syncs:
 *   → wines table      : all wines by country
 *   → beverages table  : cocktails, beers, and all spirits subcategories
 *
 * Manual trigger:
 *   GET /api/sync-wines?secret=YOUR_CRON_SECRET        → full sync
 *   GET /api/sync-wines?secret=...&dry=true            → parse only, no DB write
 */

import { createClient } from "@supabase/supabase-js";

const BASE = "https://vinska-karta.hotelmilka.si";

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

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; MilkaSyncBot/1.0)", Accept: "text/html" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

export async function withRetry(fn, label, maxAttempts = 4) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (attempt < maxAttempts) {
        const delay = Math.pow(2, attempt - 1) * 1000; // 1s, 2s, 4s
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
      if (cells.length < 5) continue;
      let [rawProducer, rawName, vintage, region] = cells;
      if (!rawProducer || rawProducer.length > 80) continue;
      if (rawProducer.toLowerCase().includes("producer")) continue;
      const byGlass = /^\d{2}\.\s*/.test(rawProducer);
      const producer = rawProducer.replace(/^\d{2}\.\s*/, "").trim();
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
  try {
    const html = await withRetry(() => fetchHtml(url), label);
    const items = parseBeveragesFromHtml(html, category, label);
    console.log(`[sync] ${label} → ${items.length}`);
    return items;
  } catch (e) { console.warn(`[sync] ${label} failed after retries: ${e.message}`); return []; }
}

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  const authHeader = req.headers.authorization;
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const provided = bearerToken ||
    req.headers["x-cron-secret"] ||
    new URL(req.url, "http://localhost").searchParams.get("secret");
  if (!secret) return res.status(500).json({ error: "CRON_SECRET not configured" });
  if (provided !== secret) return res.status(401).json({ error: "Unauthorized" });

  const dry = new URL(req.url, "http://localhost").searchParams.get("dry") === "true";

  try {
    const [wineResults, bevResults] = await Promise.all([
      Promise.allSettled(WINE_COUNTRIES.map(fetchWineCountry)),
      Promise.allSettled(BEVERAGE_PAGES.map(fetchBeveragePage)),
    ]);

    const successfulCountries = wineResults.filter(r => r.status === "fulfilled").map(r => r.value);
    const failedCountries = WINE_COUNTRIES.filter((_, i) => wineResults[i].status !== "fulfilled");
    if (failedCountries.length > 0) {
      console.warn(`[sync] failed countries: ${failedCountries.map(c => c.label).join(", ")}`);
    }
    const allWines     = successfulCountries.flatMap(r => r.wines);
    const allBeverages = bevResults.flatMap(r  => r.status === "fulfilled" ? r.value : []);

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
        sampleCocktail: allBeverages.find(b => b.category === "cocktail"),
        sampleSpirit:   allBeverages.find(b => b.category === "spirit"),
        sampleBeer:     allBeverages.find(b => b.category === "beer"),
      });
    }

    const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseKey) throw new Error("Supabase env vars not configured (SUPABASE_URL / SUPABASE_SERVICE_KEY)");
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Sync wines
    let winesUpserted = 0;
    if (allWines.length > 0) {
      const seen = new Set();
      const uniqueWines = allWines.filter(w => { if (seen.has(w.key)) return false; seen.add(w.key); return true; });
      const BATCH = 200;
      for (let i = 0; i < uniqueWines.length; i += BATCH) {
        const { error } = await supabase.from("wines").upsert(uniqueWines.slice(i, i + BATCH), { onConflict: "key" });
        if (error) throw error;
        winesUpserted += uniqueWines.slice(i, i + BATCH).length;
      }
      const freshKeys = uniqueWines.map(w => w.key);
      const syncedCountryLabels = successfulCountries.map(r => r.label);
      // Only delete stale wines from countries we successfully fetched.
      // This prevents wiping a country's wines when its page fails to load.
      const { error: deleteError } = await supabase
        .from("wines")
        .delete()
        .in("country", syncedCountryLabels)
        .not("key", "in", `(${freshKeys.map(k => `"${k}"`).join(",")})`);
      if (deleteError) console.warn("[sync] wines delete error:", deleteError.message);
    }

    // Sync beverages — replace all 3 categories fresh every run
    let beveragesUpserted = 0;
    if (allBeverages.length > 0) {
      const catCounters = {};
      const rows = allBeverages.map(b => {
        catCounters[b.category] = (catCounters[b.category] || 0);
        return { category: b.category, name: b.name, notes: b.notes || "", position: catCounters[b.category]++ };
      });
      await supabase.from("beverages").delete().in("category", ["cocktail", "spirit", "beer"]);
      const BATCH = 200;
      for (let i = 0; i < rows.length; i += BATCH) {
        const { error } = await supabase.from("beverages").insert(rows.slice(i, i + BATCH));
        if (error) throw error;
        beveragesUpserted += rows.slice(i, i + BATCH).length;
      }
    }

    return res.status(200).json({
      ok: true,
      wines: winesUpserted, byGlass: byGlassCount,
      cocktails: cocktailCount, beers: beerCount, spirits: spiritCount,
      failedCountries: failedCountries.map(c => c.label),
      timestamp: new Date().toISOString(),
    });

  } catch (err) {
    console.error("[sync] Error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
