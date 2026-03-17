// api/sync-menu.js — Vercel serverless function
// Fetches MILKA MENU V2 sheet from Google Sheets and upserts into menu_courses.
// Prefers service-account auth (GOOGLE_SERVICE_ACCOUNT_KEY env var) and falls
// back to the public CSV export URL when no key is configured.

import { createSign } from "crypto";
import { createClient } from "@supabase/supabase-js";

const SHEET_ID  = process.env.MENU_SHEET_ID || process.env.VITE_MENU_SHEET_ID || "1aPVGmKNcvDOFzyr3jSPT_KL5lKEYKPgkad3y0_E_Vl4";
const SHEET_TAB = process.env.MENU_SHEET_TAB || process.env.VITE_MENU_SHEET_TAB || "MILKA MENU V2";
const CSV_URL   = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(SHEET_TAB)}`;

const SYNC_SECRET = process.env.SYNC_SECRET;
const CRON_SECRET = process.env.CRON_SECRET;

// ── Service-account JWT helpers ───────────────────────────────────────────────

function makeJWT(clientEmail, privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const header  = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    iss:   clientEmail,
    scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
    aud:   "https://oauth2.googleapis.com/token",
    exp:   now + 3600,
    iat:   now,
  })).toString("base64url");
  const msg  = `${header}.${payload}`;
  const sign = createSign("RSA-SHA256");
  sign.update(msg);
  const sig = sign.sign(privateKey, "base64url");
  return `${msg}.${sig}`;
}

async function getAccessToken(key) {
  const jwt = makeJWT(key.client_email, key.private_key);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:    new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion:  jwt,
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error("Failed to obtain access token: " + JSON.stringify(data));
  return data.access_token;
}

async function fetchRowsViaAPI(token) {
  const range = encodeURIComponent(`'${SHEET_TAB}'`);
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`Sheets API error: ${res.status}`);
  const data = await res.json();
  return data.values || [];
}

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

// ── Row normalisation (shared) ────────────────────────────────────────────────

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
    return {
      position: Number(firstFilled(row["#"], row.position, row.order_index)) || 0,
      menu,
      veg:          splitMainSubCell(row.veg),
      hazards:      null,
      na:           splitMainSubCell(row.na_drink,  row.na_sub),
      wp:           splitMainSubCell(row.wp_drink,  row.wp_sub),
      os:           splitMainSubCell(row.os_drink,  row.os_sub),
      premium:      splitMainSubCell(row.premium,   row.premium_sub),
      is_snack:     truthyCell(firstFilled(row["snack?"], row.snack)),
      gluten_free:  splitMainSubCell(row.gluten_free),
      dairy_free:   splitMainSubCell(row.dairy_free),
      nut_free:     splitMainSubCell(row.nut_free),
      pescetarian:  splitMainSubCell(row.pescetarian),
      no_red_meat:  splitMainSubCell(row.no_red_meat),
      no_pork:      splitMainSubCell(row.no_pork),
      no_game:      splitMainSubCell(row.no_game),
      no_offal:     splitMainSubCell(row.no_offal),
      egg_free:     splitMainSubCell(row.egg_free),
    };
  }).filter(Boolean).sort((a, b) => a.position - b.position);
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  // Support Vercel cron auth (Authorization: Bearer <CRON_SECRET>),
  // manual trigger via x-sync-secret header, or ?secret= query param.
  const authHeader = req.headers.authorization;
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const provided = bearerToken || req.headers["x-sync-secret"] || req.query.secret;

  const validSecrets = [CRON_SECRET, SYNC_SECRET].filter(Boolean);
  if (validSecrets.length > 0 && !validSecrets.includes(provided)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    let rows;

    // Prefer service-account authentication when a key is configured.
    const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    if (rawKey) {
      const key = typeof rawKey === "string" ? JSON.parse(rawKey) : rawKey;
      const token = await getAccessToken(key);
      rows = await fetchRowsViaAPI(token);
    } else {
      // Fallback: fetch the sheet as a CSV (requires the sheet to be publicly accessible).
      const response = await fetch(CSV_URL);
      if (!response.ok) throw new Error(`Google Sheets CSV fetch failed: ${response.status}`);
      const csvText = await response.text();
      rows = parseCSV(csvText);
    }

    const courses = parseRows(rows);
    if (courses.length === 0) throw new Error("No courses parsed from sheet");

    const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseKey) throw new Error("Supabase env vars not configured (SUPABASE_URL / SUPABASE_SERVICE_KEY)");
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { error } = await supabase
      .from("menu_courses")
      .upsert(courses, { onConflict: "position" });

    if (error) throw new Error("Supabase upsert failed: " + error.message);

    const positions = courses.map(c => c.position);
    await supabase
      .from("menu_courses")
      .delete()
      .not("position", "in", `(${positions.join(",")})`);

    return res.status(200).json({ ok: true, synced: courses.length });
  } catch (err) {
    console.error("sync-menu error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
