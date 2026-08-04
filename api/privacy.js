/**
 * Admin-only data portability and guest erasure.
 *
 * The route authenticates the caller, proves Admin membership in the supplied
 * workspace, and only then uses the server-only key. Guest erasure removes
 * matching reservation rows and redacts party-linked fields in service table
 * history; unrelated operational history remains intact.
 */
import { createClient } from "@supabase/supabase-js";
import {
  checkRateLimit,
  setPrivateResponseHeaders,
  stablePrivateToken,
} from "./_security.js";

const EXPORT_TABLES = [
  "workspace_members",
  "service_settings",
  "services",
  "service_tables",
  "service_archive",
  "reservations",
  "menu_courses",
  "wines",
  "beverages",
  "audit_log",
];

const REDACTED_NAME = "[erased]";

export function normalizeGuestName(value) {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("en");
}

export function partyMatches(data, normalizedName) {
  return Boolean(
    data && typeof data === "object"
    && normalizeGuestName(data.resName) === normalizedName,
  );
}

export function redactPartyData(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return data;
  return {
    ...data,
    resName: REDACTED_NAME,
    guestType: "",
    room: "",
    rooms: [],
    restrictions: [],
    birthday: false,
    cakeNote: "",
    notes: "",
    source: "",
    reference: "",
    kitchenCourseNotes: {},
  };
}

export function redactLegacyArchiveState(state, normalizedName) {
  if (!state || typeof state !== "object" || !Array.isArray(state.tables)) {
    return { changed: false, value: state };
  }
  let changed = false;
  const tables = state.tables.map((table) => {
    if (!partyMatches(table, normalizedName)) return table;
    changed = true;
    return redactPartyData(table);
  });
  return { changed, value: changed ? { ...state, tables } : state };
}

export function redactAuditValue(value, normalizedName) {
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item) => {
      const result = redactAuditValue(item, normalizedName);
      changed ||= result.changed;
      return result.value;
    });
    return { changed, value: changed ? next : value };
  }
  if (!value || typeof value !== "object") return { changed: false, value };

  let changed = false;
  let base = value;
  if (partyMatches(value, normalizedName)) {
    base = redactPartyData(value);
    changed = true;
  }
  const out = {};
  for (const [key, item] of Object.entries(base)) {
    const result = redactAuditValue(item, normalizedName);
    changed ||= result.changed;
    out[key] = result.value;
  }
  return { changed, value: changed ? out : value };
}

function jsonBody(req) {
  if (req.body == null || req.body === "") return {};
  if (typeof req.body === "object") return req.body;
  try { return JSON.parse(req.body); } catch { return null; }
}

function bearerFrom(req) {
  const header = String(req.headers?.authorization || "");
  return header.startsWith("Bearer ") ? header.slice(7).trim() : null;
}

async function selectAll(client, table, workspaceId, columns = "*") {
  const rows = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await client
      .from(table)
      .select(columns)
      .eq("workspace_id", workspaceId)
      .range(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < pageSize) return rows;
  }
}

async function updateRow(client, table, workspaceId, idFilters, patch) {
  let query = client.from(table).update(patch).eq("workspace_id", workspaceId);
  for (const [key, value] of Object.entries(idFilters)) query = query.eq(key, value);
  const { error } = await query;
  if (error) throw error;
}

function erasureMatches({ reservations, serviceTables, legacyArchives, auditRows }, normalizedName) {
  const reservationRows = reservations.filter((row) => partyMatches(row.data, normalizedName));
  const boardRows = serviceTables.filter((row) => partyMatches(row.data, normalizedName));
  const archives = legacyArchives.flatMap((row) => {
    const result = redactLegacyArchiveState(row.state, normalizedName);
    return result.changed ? [{ row, redacted: result.value }] : [];
  });
  const audits = auditRows.flatMap((row) => {
    const before = redactAuditValue(row.before_data, normalizedName);
    const after = redactAuditValue(row.after_data, normalizedName);
    return before.changed || after.changed
      ? [{ row, before: before.value, after: after.value }]
      : [];
  });
  return { reservationRows, boardRows, archives, audits };
}

const countsOf = (matches) => ({
  reservations: matches.reservationRows.length,
  serviceTables: matches.boardRows.length,
  legacyArchives: matches.archives.length,
  auditRows: matches.audits.length,
});

export default async function handler(req, res) {
  setPrivateResponseHeaders(res);
  if (String(req.method || "POST").toUpperCase() !== "POST") {
    res.setHeader?.("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const body = jsonBody(req);
  if (body == null) return res.status(400).json({ error: "Invalid JSON request body" });
  const action = String(body.action || "").trim();
  const workspaceId = String(body.workspaceId || "").trim();
  const accessToken = bearerFrom(req);
  if (!workspaceId) return res.status(400).json({ error: "No active restaurant was supplied." });
  if (!accessToken) return res.status(401).json({ error: "Sign in again to manage restaurant data." });

  const destructive = action === "erase-guest";
  const rate = checkRateLimit(req, {
    scope: destructive ? "privacy-erase" : "privacy-read",
    limit: destructive ? 3 : 20,
    windowMs: destructive ? 60 * 60 * 1000 : 10 * 60 * 1000,
  });
  if (!rate.allowed) {
    res.setHeader?.("Retry-After", String(rate.retryAfterSeconds));
    return res.status(429).json({ error: "Too many data-management requests. Wait and retry." });
  }

  const url = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim();
  const serviceKey = String(
    process.env.SUPABASE_SERVICE_KEY
    || process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.SUPABASE_SECRET_KEY
    || "",
  ).trim();
  if (!url || !serviceKey) {
    return res.status(500).json({ error: "Data management is not configured on the server." });
  }

  const client = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const { data: authData, error: authError } = await client.auth.getUser(accessToken);
    const requester = authData?.user;
    if (authError || !requester?.id) {
      return res.status(401).json({ error: "Your login expired. Sign in again." });
    }
    const { data: membership, error: membershipError } = await client
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", workspaceId)
      .eq("user_id", requester.id)
      .maybeSingle();
    if (membershipError) throw membershipError;
    if (membership?.role !== "admin") {
      return res.status(403).json({ error: "Only an Admin can export or erase restaurant data." });
    }

    if (action === "export") {
      const { data: workspace, error: workspaceError } = await client
        .from("workspaces")
        .select("id, name, slug, kind, created_at")
        .eq("id", workspaceId)
        .single();
      if (workspaceError) throw workspaceError;
      const datasets = {};
      for (const table of EXPORT_TABLES) datasets[table] = await selectAll(client, table, workspaceId);
      const filename = `${String(workspace.slug || "restaurant").replace(/[^a-z0-9-]+/gi, "-")}-export-${new Date().toISOString().slice(0, 10)}.json`;
      res.setHeader?.("Content-Disposition", `attachment; filename="${filename}"`);
      return res.status(200).json({
        format: "service-board-workspace-export",
        version: 1,
        generatedAt: new Date().toISOString(),
        workspace,
        datasets,
      });
    }

    if (action !== "preview-erasure" && action !== "erase-guest") {
      return res.status(400).json({ error: "Choose export, preview-erasure, or erase-guest." });
    }

    const guestName = String(body.guestName || "").trim().replace(/\s+/g, " ");
    const normalizedName = normalizeGuestName(guestName);
    if (normalizedName.length < 2 || normalizedName === normalizeGuestName(REDACTED_NAME)) {
      return res.status(400).json({ error: "Enter the guest's exact current reservation name." });
    }
    if (destructive && String(body.confirmation || "").trim() !== guestName) {
      return res.status(400).json({ error: "The erasure confirmation must exactly match the supplied guest name." });
    }

    const rows = {
      reservations: await selectAll(client, "reservations", workspaceId, "id,data"),
      serviceTables: await selectAll(client, "service_tables", workspaceId, "service_id,table_id,data"),
      legacyArchives: await selectAll(client, "service_archive", workspaceId, "id,state"),
      auditRows: await selectAll(client, "audit_log", workspaceId, "id,before_data,after_data"),
    };
    const matches = erasureMatches(rows, normalizedName);
    const counts = countsOf(matches);
    if (!destructive) return res.status(200).json({ ok: true, preview: true, counts });

    const reservationIds = matches.reservationRows.map((row) => row.id);
    for (let index = 0; index < reservationIds.length; index += 100) {
      const { error } = await client
        .from("reservations")
        .delete()
        .eq("workspace_id", workspaceId)
        .in("id", reservationIds.slice(index, index + 100));
      if (error) throw error;
    }
    for (const row of matches.boardRows) {
      await updateRow(client, "service_tables", workspaceId, {
        service_id: row.service_id,
        table_id: row.table_id,
      }, { data: redactPartyData(row.data), updated_at: new Date().toISOString() });
    }
    for (const entry of matches.archives) {
      await updateRow(client, "service_archive", workspaceId, { id: entry.row.id }, { state: entry.redacted });
    }
    for (const entry of matches.audits) {
      await updateRow(client, "audit_log", workspaceId, { id: entry.row.id }, {
        before_data: entry.before,
        after_data: entry.after,
      });
    }

    const { error: auditError } = await client.from("audit_log").insert({
      workspace_id: workspaceId,
      actor_id: requester.id,
      actor_email: requester.email || null,
      action: "delete",
      entity_type: "privacy_guest_erasure",
      entity_key: stablePrivateToken(`${workspaceId}:${normalizedName}`),
      before_data: { matched: counts },
      after_data: { status: "erased" },
    });
    if (auditError) throw auditError;

    return res.status(200).json({ ok: true, erased: true, counts });
  } catch (error) {
    console.error(JSON.stringify({
      level: "error",
      event: "privacy_request_failed",
      route: "/api/privacy",
      action,
      error: String(error?.message || error).slice(0, 500),
    }));
    return res.status(500).json({
      error: "The data-management request did not complete. Re-run the preview before retrying; completed redactions are idempotent.",
    });
  }
}
