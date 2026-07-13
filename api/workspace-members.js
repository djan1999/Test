/**
 * Admin-only staff management.
 *
 * The browser must never receive the Supabase service key. This server route
 * uses it only for Auth invitations/email lookup, while every membership write
 * is performed as the signed-in admin so normal RLS and audit triggers remain
 * authoritative.
 */
import { createClient } from "@supabase/supabase-js";

export const WORKSPACE_ROLES = new Set(["admin", "service", "kitchen"]);

export function normalizeRequestedRole(value) {
  const role = String(value || "").trim().toLowerCase();
  return WORKSPACE_ROLES.has(role) ? role : null;
}

export function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
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

function appUrl(req) {
  const configured = String(process.env.APP_URL || "").trim().replace(/\/$/, "");
  if (configured) return configured;
  const production = String(process.env.VERCEL_PROJECT_PRODUCTION_URL || "").trim().replace(/\/$/, "");
  if (production) return `https://${production}`;
  const host = String(req.headers?.host || "").trim();
  const proto = String(req.headers?.["x-forwarded-proto"] || "https").split(",")[0].trim();
  return host ? `${proto}://${host}` : "";
}

async function findUserByEmail(adminClient, email) {
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const users = data?.users || [];
    const match = users.find((user) => String(user.email || "").toLowerCase() === email);
    if (match) return match;
    if (users.length < 1000) return null;
  }
  return null;
}

async function memberEmail(adminClient, userId) {
  const { data, error } = await adminClient.auth.admin.getUserById(userId);
  if (error) return null;
  return data?.user?.email || null;
}

export default async function handler(req, res) {
  const startedAt = Date.now();
  const requestId = req.headers?.["x-vercel-id"] || req.headers?.["x-request-id"] || null;
  const method = String(req.method || "GET").toUpperCase();
  const log = (level, event, details = {}) => {
    const entry = JSON.stringify({
      level,
      event,
      route: "/api/workspace-members",
      requestId,
      method,
      duration_ms: Date.now() - startedAt,
      ...details,
    });
    if (level === "error") console.error(entry);
    else if (level === "warn") console.warn(entry);
    else console.log(entry);
  };
  log("info", "workspace_members_started");

  if (!new Set(["GET", "POST", "PATCH", "DELETE"]).has(method)) {
    res.setHeader?.("Allow", "GET, POST, PATCH, DELETE");
    log("warn", "workspace_members_denied", { reason: "method_not_allowed" });
    return res.status(405).json({ error: "Method not allowed" });
  }

  const body = jsonBody(req);
  if (body == null) return res.status(400).json({ error: "Invalid JSON request body" });
  const workspaceId = String(body.workspaceId || req.query?.workspaceId || "").trim();
  const accessToken = bearerFrom(req);
  if (!workspaceId) return res.status(400).json({ error: "No active restaurant was supplied." });
  if (!accessToken) return res.status(401).json({ error: "Sign in again to manage staff." });

  const url = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim();
  const anonKey = String(process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "").trim();
  const serviceKey = String(
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SECRET_KEY ||
    "",
  ).trim();
  if (!url || !anonKey || !serviceKey) {
    log("error", "workspace_members_failed", { error: "server_not_configured" });
    return res.status(500).json({ error: "Staff management is not configured on the server." });
  }

  const clientOptions = { auth: { persistSession: false, autoRefreshToken: false } };
  const adminClient = createClient(url, serviceKey, clientOptions);
  const userClient = createClient(url, anonKey, {
    ...clientOptions,
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });

  try {
    const { data: authData, error: authError } = await adminClient.auth.getUser(accessToken);
    const requester = authData?.user;
    if (authError || !requester?.id) return res.status(401).json({ error: "Your login expired. Sign in again." });

    const { data: adminMembership, error: membershipError } = await adminClient
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", workspaceId)
      .eq("user_id", requester.id)
      .maybeSingle();
    if (membershipError) throw membershipError;
    if (adminMembership?.role !== "admin") {
      log("warn", "workspace_members_denied", { reason: "admin_required" });
      return res.status(403).json({ error: "Only an Admin can manage staff accounts." });
    }

    if (method === "GET") {
      const { data: rows, error } = await userClient
        .from("workspace_members")
        .select("user_id, role, created_at")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      const members = await Promise.all((rows || []).map(async (row) => ({
        ...row,
        email: await memberEmail(adminClient, row.user_id),
      })));
      log("info", "workspace_members_completed", { action: "list", count: members.length });
      return res.status(200).json({ ok: true, members });
    }

    if (method === "POST") {
      const email = normalizeEmail(body.email);
      const role = normalizeRequestedRole(body.role);
      if (!email) return res.status(400).json({ error: "Enter a valid email address." });
      if (!role) return res.status(400).json({ error: "Choose Admin, Service, or Kitchen." });

      let user = await findUserByEmail(adminClient, email);
      let invited = false;
      if (!user) {
        const baseUrl = appUrl(req);
        const options = baseUrl ? { redirectTo: `${baseUrl}/?set-password=1` } : undefined;
        const { data, error } = await adminClient.auth.admin.inviteUserByEmail(email, options);
        if (error) throw error;
        user = data?.user;
        invited = true;
      }
      if (!user?.id) throw new Error("Supabase did not return the staff account id.");

      const { error: upsertError } = await userClient
        .from("workspace_members")
        .upsert({ workspace_id: workspaceId, user_id: user.id, role }, { onConflict: "workspace_id,user_id" });
      if (upsertError) throw upsertError;
      log("info", "workspace_members_completed", { action: invited ? "invite" : "link", role });
      return res.status(200).json({
        ok: true,
        invited,
        member: { user_id: user.id, email: user.email || email, role },
      });
    }

    const userId = String(body.userId || "").trim();
    if (!userId) return res.status(400).json({ error: "No staff member was supplied." });

    if (method === "PATCH") {
      const role = normalizeRequestedRole(body.role);
      if (!role) return res.status(400).json({ error: "Choose Admin, Service, or Kitchen." });
      const { data, error } = await userClient
        .from("workspace_members")
        .update({ role })
        .eq("workspace_id", workspaceId)
        .eq("user_id", userId)
        .select("user_id, role, created_at")
        .single();
      if (error) throw error;
      log("info", "workspace_members_completed", { action: "change_role", role });
      return res.status(200).json({ ok: true, member: data });
    }

    const { error } = await userClient
      .from("workspace_members")
      .delete()
      .eq("workspace_id", workspaceId)
      .eq("user_id", userId);
    if (error) throw error;
    log("info", "workspace_members_completed", { action: "remove" });
    return res.status(200).json({ ok: true });
  } catch (error) {
    const message = String(error?.message || "Staff management failed.");
    const status = /last admin/i.test(message) ? 409 : 500;
    log("error", "workspace_members_failed", { error: message });
    return res.status(status).json({ error: message });
  }
}
