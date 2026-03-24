// api/sync-menu.js — Vercel serverless function
// Fetches MILKA MENU V2 sheet from Google Sheets and upserts into menu_courses.
// Prefers service-account auth (GOOGLE_SERVICE_ACCOUNT_KEY env var) and falls
// back to the public CSV export URL when no key is configured.

import { createClient } from "@supabase/supabase-js";
import { getSheetsToken, sheetsGet, SHEET_ID, SHEET_TAB } from "./_sheets-auth.js";
import { parseCSV, normHeader } from "../src/utils/csv.js";
import { firstFilled, parseMenuRow, RESTRICTION_KEYS } from "../src/utils/menuUtils.js";

const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(SHEET_TAB)}`;

const SYNC_SECRET = process.env.SYNC_SECRET;
const CRON_SECRET = process.env.CRON_SECRET;

export function parseRows(rows) {
  if (rows.length < 2) return [];
  const headers = rows[0].map(normHeader);
  const records = rows.slice(1).map(cols => {
    const obj = {};
    headers.forEach((header, idx) => { obj[header] = cols[idx] ?? ""; });
    return obj;
  });

  return records.map((row) => {
    const parsed = parseMenuRow(row);
    if (!parsed) return null;

    // Build the flat DB-schema shape from the canonical parsed structure
    const restrictionColsSi = {};
    const restrictionNotes = {};
    RESTRICTION_KEYS.forEach(k => {
      if (parsed.restrictions[`${k}_si`]) restrictionColsSi[k] = parsed.restrictions[`${k}_si`];
      if (parsed.restrictions[`${k}_note`]) restrictionNotes[k] = parsed.restrictions[`${k}_note`];
    });

    const restrictions_si = (() => {
      const combined = { ...restrictionColsSi };
      Object.entries(restrictionNotes).forEach(([k, v]) => { combined[`${k}__note`] = v; });
      return Object.keys(combined).length ? combined : null;
    })();

    return {
      position:            parsed.position,
      menu:                parsed.menu,
      menu_si:             parsed.menu_si,
      veg:                 parsed.restrictions.veg,
      hazards:             null,
      na:                  parsed.na,
      na_si:               parsed.na_si,
      wp:                  parsed.wp,
      wp_si:               parsed.wp_si,
      os:                  parsed.os,
      os_si:               parsed.os_si,
      premium:             parsed.premium,
      premium_si:          parsed.premium_si,
      is_snack:            parsed.is_snack,
      course_key:          parsed.course_key,
      optional_flag:       parsed.optional_flag,
      section_gap_before:  parsed.section_gap_before,
      show_on_short:       parsed.show_on_short,
      short_order:         parsed.short_order,
      force_pairing_title: parsed.force_pairing_title,
      force_pairing_sub:   parsed.force_pairing_sub,
      kitchen_note:        parsed.kitchen_note,
      aperitif_btn:        parsed.aperitif_btn,
      restrictions_si,
      vegan:            parsed.restrictions.vegan,
      pescetarian:      parsed.restrictions.pescetarian,
      gluten_free:      parsed.restrictions.gluten_free,
      dairy_free:       parsed.restrictions.dairy_free,
      nut_free:         parsed.restrictions.nut_free,
      no_red_meat:      parsed.restrictions.no_red_meat,
      no_pork:          parsed.restrictions.no_pork,
      no_game:          parsed.restrictions.no_game,
      no_offal:         parsed.restrictions.no_offal,
      egg_free:         parsed.restrictions.egg_free,
      shellfish_free:   parsed.restrictions.shellfish_free,
      no_alcohol:       parsed.restrictions.no_alcohol,
      no_garlic_onion:  parsed.restrictions.no_garlic_onion,
      halal:            parsed.restrictions.halal,
      low_fodmap:       parsed.restrictions.low_fodmap,
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
  const isSameOrigin = req.headers["sec-fetch-site"] === "same-origin";
  if (validSecrets.length > 0 && !validSecrets.includes(provided) && !isSameOrigin) {
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

    // All columns present in the current schema
    const ALL_KEYS = [
      "position","menu","veg","hazards","na","wp","os","premium","is_snack",
      "gluten_free","dairy_free","nut_free","pescetarian","no_red_meat",
      "no_pork","no_game","no_offal","egg_free",
      "menu_si","course_key","optional_flag","section_gap_before","show_on_short",
      "short_order","force_pairing_title","force_pairing_sub","kitchen_note",
      "vegan","shellfish_free","no_alcohol","no_garlic_onion","halal","low_fodmap",
      "wp_si","na_si","os_si","premium_si","restrictions_si","aperitif_btn",
    ];

    const pick = (obj, keys) => Object.fromEntries(keys.map(k => [k, obj[k] ?? null]));

    const { error } = await supabase
      .from("menu_courses")
      .upsert(courses.map(c => pick(c, ALL_KEYS)), { onConflict: "position" });
    if (error) throw new Error("Supabase upsert failed: " + error.message);

    const positions = courses.map(c => c.position);
    await supabase.from("menu_courses").delete().not("position", "in", `(${positions.join(",")})`);

    return res.status(200).json({ ok: true, synced: courses.length });
  } catch (err) {
    console.error("sync-menu error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
