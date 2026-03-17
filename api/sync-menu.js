// api/sync-menu.js — Vercel serverless function
// Fetches MILKA MENU V2 sheet from Google Sheets and upserts into menu_courses.
// Prefers service-account auth (GOOGLE_SERVICE_ACCOUNT_KEY env var) and falls
// back to the public CSV export URL when no key is configured.

import { createClient } from "@supabase/supabase-js";
import { getSheetsToken, sheetsGet, SHEET_ID, SHEET_TAB } from "./_sheets-auth.js";

const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(SHEET_TAB)}`;

const SYNC_SECRET = process.env.SYNC_SECRET;
const CRON_SECRET = process.env.CRON_SECRET;

// ── CSV parser (fallback path) ────────────────────────────────────────────────

function parseCSV(text) {
  const rows = [];
  let row = [], field = "", inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuote) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (ch === '"') inQuote = false;
      else field += ch;
    } else {
      if (ch === '"') inQuote = true;
      else if (ch === ',') { row.push(field); field = ""; }
      else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ""; }
      else if (ch !== '\r') field += ch;
    }
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// ── Row normalisation ─────────────────────────────────────────────────────────

const normHeader = value => String(value || "")
  .trim()
  .toLowerCase()
  .replace(/\s+/g, "_")
  .replace(/[^a-z0-9_/?#]+/g, "_")
  .replace(/^_+|_+$/g, "");

const firstFilled = (...vals) => vals.find(v => String(v ?? "").trim()) ?? "";
const truthyCell = value => ["true", "yes", "y", "1", "wahr"].includes(String(value ?? "").trim().toLowerCase());

const splitMainSubCell = (title, sub = "") => {
  const rawTitle = String(title ?? "").trim();
  const rawSub = String(sub ?? "").trim();
  if (!rawTitle && !rawSub) return null;
  if (rawTitle.includes("|")) {
    const [left, ...rest] = rawTitle.split("|");
    return { name: left.trim(), sub: rest.join("|").trim() || rawSub || "" };
  }
  return { name: rawTitle, sub: rawSub };
};

const RESTRICTION_KEYS = [
  "veg","vegan","pescetarian","gluten_free","dairy_free","nut_free","shellfish_free",
  "no_red_meat","no_pork","no_game","no_offal","egg_free","no_alcohol",
  "no_garlic_onion","halal","low_fodmap",
];

function parseRows(rows) {
  if (rows.length < 2) return [];
  const headers = rows[0].map(normHeader);
  const records = rows.slice(1).map(cols => {
    const obj = {};
    headers.forEach((header, idx) => { obj[header] = cols[idx] ?? ""; });
    return obj;
  });

  return records.map((row) => {
    const menu = splitMainSubCell(row.dish, row.description);
    if (!menu?.name) return null;

    const courseKey = String(firstFilled(row.course_key, row.key, row.dish) || "")
      .trim().toLowerCase()
      .replace(/&/g, "and").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

    // Per-restriction columns + optional _sub and _note columns
    const restrictionCols = {};
    RESTRICTION_KEYS.forEach(k => {
      restrictionCols[k] = splitMainSubCell(row[k], row[`${k}_sub`]);
    });

    return {
      position:            Number(firstFilled(row["#"], row.position, row.order_index)) || 0,
      menu,
      menu_si:             splitMainSubCell(row.dish_si, row.dish_si_sub) || null,
      veg:                 restrictionCols.veg,
      hazards:             null,
      na:                  splitMainSubCell(row.na_drink,  row.na_sub),
      wp:                  splitMainSubCell(row.wp_drink,  row.wp_sub),
      os:                  splitMainSubCell(row.os_drink,  row.os_sub),
      premium:             splitMainSubCell(row.premium,   row.premium_sub),
      is_snack:            truthyCell(firstFilled(row["snack?"], row.snack)),
      course_key:          courseKey,
      optional_flag:       String(firstFilled(row.optional_flag)).trim().toLowerCase(),
      section_gap_before:  truthyCell(firstFilled(row.section_gap_before)),
      show_on_short:       truthyCell(firstFilled(row.show_on_short)),
      short_order:         Number(firstFilled(row.short_order)) || null,
      force_pairing_title: String(firstFilled(row.force_pairing_title)).trim(),
      force_pairing_sub:   String(firstFilled(row.force_pairing_sub)).trim(),
      kitchen_note:        String(firstFilled(row.kitchen_note)).trim(),
      // Individual restriction columns (for Supabase flat storage)
      ...Object.fromEntries(RESTRICTION_KEYS.map(k => [k, restrictionCols[k]])),
    };
  }).filter(Boolean).sort((a, b) => a.position - b.position);
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  const authHeader = req.headers.authorization;
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const provided = bearerToken || req.headers["x-sync-secret"] || req.query.secret;

  const validSecrets = [CRON_SECRET, SYNC_SECRET].filter(Boolean);
  if (validSecrets.length > 0 && !validSecrets.includes(provided)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    let rows;

    if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
      const token = await getSheetsToken();
      rows = await sheetsGet(token, `'${SHEET_TAB}'`);
    } else {
      const response = await fetch(CSV_URL);
      if (!response.ok) throw new Error(`Google Sheets CSV fetch failed: ${response.status}`);
      rows = parseCSV(await response.text());
    }

    const courses = parseRows(rows);
    if (courses.length === 0) throw new Error("No courses parsed from sheet");

    const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseKey) throw new Error("Supabase env vars not configured");
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { error } = await supabase.from("menu_courses").upsert(courses, { onConflict: "position" });
    if (error) throw new Error("Supabase upsert failed: " + error.message);

    const positions = courses.map(c => c.position);
    await supabase.from("menu_courses").delete().not("position", "in", `(${positions.join(",")})`);

    return res.status(200).json({ ok: true, synced: courses.length });
  } catch (err) {
    console.error("sync-menu error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
