/**
 * Admin-only data portability and guest erasure.
 *
 * The route authenticates the caller, proves Admin membership in the supplied
 * workspace, and only then uses the server-only key. Guest erasure removes
 * matching reservation rows and redacts party-linked fields in service table
 * history; unrelated operational history remains intact.
 */
import { createClient } from "@supabase/supabase-js";
import { once } from "node:events";
import {
  checkRateLimit,
  setPrivateResponseHeaders,
  stablePrivateToken,
} from "./_security.js";

const EXPORT_DATASETS = [
  { table: "workspace_members", keys: ["user_id"] },
  { table: "service_settings", keys: ["id"] },
  { table: "services", keys: ["id"] },
  { table: "service_tables", keys: ["service_id", "table_id"] },
  { table: "service_archive", keys: ["id"] },
  { table: "service_events", keys: ["id"] },
  { table: "reservations", keys: ["id"] },
  { table: "menu_courses", keys: ["position"] },
  { table: "wines", keys: ["key"] },
  { table: "beverages", keys: ["id"] },
  { table: "audit_log", keys: ["id"] },
];

const DATASET_KEYS = Object.fromEntries(EXPORT_DATASETS.map(({ table, keys }) => [table, keys]));

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

function afterCursor(query, keys, cursor) {
  if (!cursor) return query;
  if (keys.length === 1) return query.gt(keys[0], cursor[0]);
  const [first, second] = keys;
  return query.or(
    `${first}.gt.${cursor[0]},and(${first}.eq.${cursor[0]},${second}.gt.${cursor[1]})`,
  );
}

async function selectPage(client, table, workspaceId, columns, keys, cursor, pageSize) {
  let query = client.from(table).select(columns).eq("workspace_id", workspaceId);
  for (const key of keys) query = query.order(key, { ascending: true });
  query = afterCursor(query, keys, cursor);
  const { data, error } = await query.limit(pageSize);
  if (error) throw error;
  return data || [];
}

async function* selectPages(client, table, workspaceId, columns = "*", pageSize = 1000) {
  const keys = DATASET_KEYS[table];
  if (!keys) throw new Error(`No stable export cursor is configured for ${table}`);
  let cursor = null;
  for (;;) {
    const data = await selectPage(client, table, workspaceId, columns, keys, cursor, pageSize);
    if (data.length > 0) yield data;
    if (data.length < pageSize) return;
    const last = data[data.length - 1];
    cursor = keys.map((key) => last[key]);
  }
}

export async function selectAll(client, table, workspaceId, columns = "*") {
  const rows = [];
  for await (const page of selectPages(client, table, workspaceId, columns)) rows.push(...page);
  return rows;
}

async function writeChunk(res, chunk) {
  if (res.write(chunk) === false) await once(res, "drain");
}

export async function streamWorkspaceExport(res, client, workspace, generatedAt = new Date().toISOString()) {
  const filename = `${String(workspace.slug || "restaurant").replace(/[^a-z0-9-]+/gi, "-")}-export-${generatedAt.slice(0, 10)}.json`;
  res.setHeader?.("Content-Type", "application/json; charset=utf-8");
  res.setHeader?.("Content-Disposition", `attachment; filename="${filename}"`);
  res.status(200);
  res.flushHeaders?.();
  await writeChunk(res, `{"format":"service-board-workspace-export","version":1,"generatedAt":${JSON.stringify(generatedAt)},"workspace":${JSON.stringify(workspace)},"datasets":{`);
  let firstDataset = true;
  for (const { table } of EXPORT_DATASETS) {
    await writeChunk(res, `${firstDataset ? "" : ","}${JSON.stringify(table)}:[`);
    firstDataset = false;
    let firstRow = true;
    for await (const page of selectPages(client, table, workspace.id)) {
      for (const row of page) {
        await writeChunk(res, `${firstRow ? "" : ","}${JSON.stringify(row)}`);
        firstRow = false;
      }
    }
    await writeChunk(res, "]");
  }
  await writeChunk(res, "}}");
  res.end();
  return { streamed: true, filename };
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
      return await streamWorkspaceExport(res, client, workspace);
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

    const { data: erased, error: eraseError } = await client.rpc("erase_workspace_guest", {
      p_workspace_id: workspaceId,
      p_actor_id: requester.id,
      p_actor_email: requester.email || null,
      p_normalized_name: normalizedName,
      p_name_token: stablePrivateToken(`${workspaceId}:${normalizedName}`),
    });
    if (eraseError) throw eraseError;

    return res.status(200).json({ ok: true, erased: true, counts: erased?.counts || counts });
  } catch (error) {
    console.error(JSON.stringify({
      level: "error",
      event: "privacy_request_failed",
      route: "/api/privacy",
      action,
      error: String(error?.message || error).slice(0, 500),
    }));
    if (res.headersSent) {
      res.destroy?.(error);
      return undefined;
    }
    return res.status(500).json({
      error: "The data-management request did not complete. Re-run the preview before retrying; completed redactions are idempotent.",
    });
  }
}
