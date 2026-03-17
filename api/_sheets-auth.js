// api/_sheets-auth.js — shared Google Sheets service-account helpers
// Uses the full `spreadsheets` scope (read + write).

import { createSign } from "crypto";

export const SHEET_ID  = process.env.MENU_SHEET_ID  || process.env.VITE_MENU_SHEET_ID  || "1aPVGmKNcvDOFzyr3jSPT_KL5lKEYKPgkad3y0_E_Vl4";
export const SHEET_TAB = process.env.MENU_SHEET_TAB || process.env.VITE_MENU_SHEET_TAB || "MILKA MENU V2";

function makeJWT(clientEmail, privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const header  = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    iss:   clientEmail,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud:   "https://oauth2.googleapis.com/token",
    exp:   now + 3600,
    iat:   now,
  })).toString("base64url");
  const msg  = `${header}.${payload}`;
  const sign = createSign("RSA-SHA256");
  sign.update(msg);
  return `${msg}.${sign.sign(privateKey, "base64url")}`;
}

export async function getSheetsToken() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY is not set");
  const key = typeof raw === "string" ? JSON.parse(raw) : raw;
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
  if (!data.access_token) throw new Error("Token exchange failed: " + JSON.stringify(data));
  return data.access_token;
}

/** Read values from a range. Returns array-of-arrays (rows). */
export async function sheetsGet(token, range) {
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(range)}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`Sheets GET error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.values || [];
}

/** Write values to a range (overwrites). valueInputOption defaults to USER_ENTERED. */
export async function sheetsUpdate(token, range, values, valueInputOption = "USER_ENTERED") {
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(range)}?valueInputOption=${valueInputOption}`,
    {
      method:  "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body:    JSON.stringify({ range, values }),
    }
  );
  if (!res.ok) throw new Error(`Sheets PUT error ${res.status}: ${await res.text()}`);
  return await res.json();
}

/** Batch-update multiple ranges at once. data = [{ range, values }, ...] */
export async function sheetsBatchUpdate(token, data, valueInputOption = "USER_ENTERED") {
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values:batchUpdate`,
    {
      method:  "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body:    JSON.stringify({ valueInputOption, data }),
    }
  );
  if (!res.ok) throw new Error(`Sheets batchUpdate error ${res.status}: ${await res.text()}`);
  return await res.json();
}

/** Append rows below existing data in a range. */
export async function sheetsAppend(token, range, values, valueInputOption = "USER_ENTERED") {
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(range)}:append?valueInputOption=${valueInputOption}&insertDataOption=INSERT_ROWS`,
    {
      method:  "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body:    JSON.stringify({ values }),
    }
  );
  if (!res.ok) throw new Error(`Sheets append error ${res.status}: ${await res.text()}`);
  return await res.json();
}
