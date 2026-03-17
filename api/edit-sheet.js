// api/edit-sheet.js — Vercel serverless function
// General-purpose Google Sheets read/write endpoint.
//
// GET  /api/edit-sheet?range=A1:Z50            → read cells
// POST /api/edit-sheet  { range, values }       → overwrite a range
// POST /api/edit-sheet  { batch: [{range,values},...] } → batch overwrite
// POST /api/edit-sheet  { append: true, range, values } → append rows
//
// All requests require secret via ?secret=, x-sync-secret header, or Bearer token.

import { getSheetsToken, sheetsGet, sheetsUpdate, sheetsBatchUpdate, sheetsAppend, SHEET_TAB } from "./_sheets-auth.js";

const SYNC_SECRET = process.env.SYNC_SECRET;
const CRON_SECRET = process.env.CRON_SECRET;

function checkAuth(req) {
  const authHeader = req.headers.authorization;
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const provided = bearerToken || req.headers["x-sync-secret"] || req.query.secret;
  const validSecrets = [CRON_SECRET, SYNC_SECRET].filter(Boolean);
  return validSecrets.length === 0 || validSecrets.includes(provided);
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-sync-secret, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();

  if (!checkAuth(req)) return res.status(401).json({ error: "Unauthorized" });

  try {
    const token = await getSheetsToken();

    // ── GET: read a range ─────────────────────────────────────────────────────
    if (req.method === "GET") {
      const range = req.query.range || `'${SHEET_TAB}'`;
      const values = await sheetsGet(token, range);
      return res.status(200).json({ ok: true, range, values });
    }

    // ── POST: write ───────────────────────────────────────────────────────────
    if (req.method === "POST") {
      const body = req.body || {};

      // Batch update: { batch: [{ range, values }, ...] }
      if (body.batch) {
        const result = await sheetsBatchUpdate(token, body.batch, body.valueInputOption);
        return res.status(200).json({ ok: true, result });
      }

      // Append rows: { append: true, range, values }
      if (body.append) {
        const range = body.range || `'${SHEET_TAB}'`;
        const result = await sheetsAppend(token, range, body.values, body.valueInputOption);
        return res.status(200).json({ ok: true, result });
      }

      // Single range update: { range, values }
      if (!body.range || !body.values) {
        return res.status(400).json({ error: "Body must include `range` and `values` (or `batch` array, or `append: true`)" });
      }
      const result = await sheetsUpdate(token, body.range, body.values, body.valueInputOption);
      return res.status(200).json({ ok: true, result });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("edit-sheet error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
