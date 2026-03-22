// api/sync-menu.js — Vercel serverless function
// Fetches MILKA MENU V2 sheet from Google Sheets and upserts into menu_courses.
// Prefers service-account auth (GOOGLE_SERVICE_ACCOUNT_KEY env var) and falls
// back to the public CSV export URL when no key is configured.

import { createClient } from "@supabase/supabase-js";
import { getSheetsToken, sheetsGet, SHEET_ID, SHEET_TAB } from "./_sheets-auth.js";
import { parseCSV, normHeader } from "../src/utils/csv.js";
import { firstFilled, truthyCell, splitMainSubCell, parseBilingual } from "../src/utils/menuUtils.js";

const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(SHEET_TAB)}`;

const SYNC_SECRET = process.env.SYNC_SECRET;
const CRON_SECRET = process.env.CRON_SECRET;

const RESTRICTION_KEYS = [
  "veg","vegan","pescetarian","gluten_free","dairy_free","nut_free","shellfish_free",
  "no_red_meat","no_pork","no_game","no_offal","egg_free","no_alcohol",
  "no_garlic_onion","halal","low_fodmap",
];

export function parseRows(rows) {
  if (rows.length < 2) return [];
  const headers = rows[0].map(normHeader);
  const records = rows.slice(1).map(cols => {
    const obj = {};
    headers.forEach((header, idx) => { obj[header] = cols[idx] ?? ""; });
    return obj;
  });

  return records.map((row) => {
    // Google Sheets cells may contain up to 3 lines: line 1 = EN, line 2 = SI, line 3 = kitchen note only.
    // Split on single \n to preserve blank-line positions — a blank line 2 must NOT shift line 3 into SI slot.
    const dishLines = String(row.dish ?? "").split("\n").map(s => s.trim());
    const descLines = String(row.description ?? "").split("\n").map(s => s.trim());
    const dishEnRaw = dishLines[0] || "";
    const descEnRaw = descLines[0] || "";
    // Prefer an explicit dish_si / dish_si_sub column; fall back to line 2 of dish/description.
    const dishSiRaw = String(row.dish_si ?? "").trim() || dishLines[1] || "";
    const descSiRaw = String(row.dish_si_sub ?? "").trim() || descLines[1] || "";

    const menu = splitMainSubCell(dishEnRaw, descEnRaw);
    if (!menu?.name) return null;

    const courseKey = String(firstFilled(row.course_key, row.key, dishEnRaw) || "")
      .trim().toLowerCase()
      .replace(/&/g, "and").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

    // Per-restriction columns: line 1 = EN (menu gen), line 2 = SI (menu gen), line 3 = kitchen note.
    const restrictionCols = {};
    const restrictionColsSi = {};
    const restrictionNotes = {};
    RESTRICTION_KEYS.forEach(k => {
      const { en, si, note } = parseBilingual(row[k], row[`${k}_sub`]);
      restrictionCols[k] = en;
      if (si) restrictionColsSi[k] = si;
      // Kitchen note: prefer explicit "{k}_note" column, fall back to line 3 of the restriction cell.
      const resolvedNote = String(firstFilled(row[`${k}_note`], note) || "").trim();
      if (resolvedNote) restrictionNotes[k] = resolvedNote;
    });

    // Pairings — bilingual (line 1 = EN, line 2 = SI)
    const wpBi   = parseBilingual(row.wp_drink,  row.wp_sub);
    const naBi   = parseBilingual(row.na_drink,  row.na_sub);
    const osBi   = parseBilingual(row.os_drink,  row.os_sub);
    const premBi = parseBilingual(row.premium,   row.premium_sub);

    const menuSi = splitMainSubCell(dishSiRaw, descSiRaw);
    // Line 3 of dish cell = kitchen note fallback
    const kitchenNoteFallback = dishLines[2] || "";

    return {
      position:            Number(firstFilled(row["#"], row.position, row.order_index)) || 0,
      menu,
      menu_si:             menuSi?.name ? menuSi : null,
      veg:                 restrictionCols.veg,
      hazards:             null,
      na:                  naBi.en,
      na_si:               naBi.si || null,
      wp:                  wpBi.en,
      wp_si:               wpBi.si || null,
      os:                  osBi.en,
      os_si:               osBi.si || null,
      premium:             premBi.en,
      premium_si:          premBi.si || null,
      is_snack:            truthyCell(firstFilled(row["snack?"], row.snack)),
      course_key:          courseKey,
      optional_flag:       String(firstFilled(row.optional_flag)).trim().toLowerCase(),
      section_gap_before:  truthyCell(firstFilled(row.section_gap_before)),
      show_on_short:       truthyCell(firstFilled(row.show_on_short)),
      short_order:         Number(firstFilled(row.short_order)) || null,
      force_pairing_title: String(firstFilled(row.force_pairing_title)).trim(),
      force_pairing_sub:   String(firstFilled(row.force_pairing_sub)).trim(),
      kitchen_note:        String(firstFilled(row.kitchen_note, kitchenNoteFallback)).trim(),
      aperitif_btn:        String(firstFilled(row.aperitif_btn, row.aperitif) || "").trim() || null,
      // Slovenian restriction substitutes + kitchen notes stored in one jsonb map.
      // Notes are stored with a "__note" suffix key (e.g. "no_pork__note": "no guanciale").
      restrictions_si: (() => {
        const combined = { ...restrictionColsSi };
        Object.entries(restrictionNotes).forEach(([k, v]) => { combined[`${k}__note`] = v; });
        return Object.keys(combined).length ? combined : null;
      })(),
      // Original restriction columns (always present in schema)
      vegan:        restrictionCols.vegan,
      pescetarian:  restrictionCols.pescetarian,
      gluten_free:  restrictionCols.gluten_free,
      dairy_free:   restrictionCols.dairy_free,
      nut_free:     restrictionCols.nut_free,
      no_red_meat:  restrictionCols.no_red_meat,
      no_pork:      restrictionCols.no_pork,
      no_game:      restrictionCols.no_game,
      no_offal:     restrictionCols.no_offal,
      egg_free:     restrictionCols.egg_free,
      // Extended restriction columns (added via migration)
      shellfish_free:   restrictionCols.shellfish_free,
      no_alcohol:       restrictionCols.no_alcohol,
      no_garlic_onion:  restrictionCols.no_garlic_onion,
      halal:            restrictionCols.halal,
      low_fodmap:       restrictionCols.low_fodmap,
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
