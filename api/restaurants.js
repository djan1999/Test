/**
 * Platform-operator restaurant provisioning.
 *
 * This route is intentionally separate from the live restaurant app. The
 * browser proves who is signed in with a short-lived access token, while the
 * Supabase secret key and cross-restaurant provisioning remain server-only.
 */
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import {
  normalizeManagedRestaurantPayload,
  parsePlatformOperatorIds,
} from "../shared/managedOnboarding.js";

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

function serverConfig() {
  return {
    url: String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim(),
    secretKey: String(
      process.env.SUPABASE_SECRET_KEY
      || process.env.SUPABASE_SERVICE_KEY
      || process.env.SUPABASE_SERVICE_ROLE_KEY
      || "",
    ).trim(),
    operatorIds: parsePlatformOperatorIds(process.env.PLATFORM_ADMIN_USER_IDS),
    selfServiceEnabled: process.env.SELF_SERVICE_ONBOARDING_ENABLED === "true",
  };
}

function makeServerClient(url, secretKey) {
  return createClient(url, secretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

export function createRestaurantsHandler({
  createServerClient = makeServerClient,
  makeWorkspaceId = randomUUID,
  readServerConfig = serverConfig,
} = {}) {
  return async function restaurantsHandler(req, res) {
    const startedAt = Date.now();
    const requestId = req.headers?.["x-vercel-id"] || req.headers?.["x-request-id"] || null;
    const method = String(req.method || "GET").toUpperCase();
    const log = (level, event, details = {}) => {
      const entry = JSON.stringify({
        level,
        event,
        route: "/api/restaurants",
        requestId,
        method,
        duration_ms: Date.now() - startedAt,
        ...details,
      });
      if (level === "error") console.error(entry);
      else if (level === "warn") console.warn(entry);
      else console.log(entry);
    };

    if (!new Set(["GET", "POST"]).has(method)) {
      res.setHeader?.("Allow", "GET, POST");
      return res.status(405).json({ error: "Method not allowed" });
    }

    const accessToken = bearerFrom(req);
    if (!accessToken) return res.status(401).json({ error: "Sign in to use restaurant onboarding." });

    const config = readServerConfig();
    if (!config.url || !config.secretKey) {
      log("warn", "restaurant_onboarding_disabled");
      return res.status(503).json({ error: "Managed restaurant onboarding is not enabled." });
    }

    // Separate clients keep user-token verification from ever changing the
    // Authorization state of the server-role database client.
    const authClient = createServerClient(config.url, config.secretKey);
    const adminClient = createServerClient(config.url, config.secretKey);

    try {
      const { data: authData, error: authError } = await authClient.auth.getUser(accessToken);
      const requester = authData?.user;
      if (authError || !requester?.id) {
        return res.status(401).json({ error: "Your login expired. Sign in again." });
      }
      const requesterId = String(requester.id).toLowerCase();
      const requesterEmail = String(requester.email || "").trim().toLowerCase();
      const isPlatformOperator = config.operatorIds?.has(requesterId) === true;
      if (!isPlatformOperator && !config.selfServiceEnabled) {
        log("warn", "restaurant_onboarding_denied", { reason: "operator_required" });
        return res.status(403).json({ error: "This account cannot create restaurants." });
      }

      if (method === "GET") {
        let data = [];
        if (isPlatformOperator) {
          const result = await adminClient
            .from("workspaces")
            .select("id, name, slug, kind, created_at")
            .order("created_at", { ascending: false });
          if (result.error) throw result.error;
          data = result.data || [];
        } else {
          const membershipResult = await adminClient
            .from("workspace_members")
            .select("workspace_id")
            .eq("user_id", requesterId);
          if (membershipResult.error) throw membershipResult.error;
          const workspaceIds = [...new Set(
            (membershipResult.data || []).map((row) => row.workspace_id).filter(Boolean),
          )];
          if (workspaceIds.length) {
            const workspaceResult = await adminClient
              .from("workspaces")
              .select("id, name, slug, kind, created_at")
              .in("id", workspaceIds)
              .order("created_at", { ascending: false });
            if (workspaceResult.error) throw workspaceResult.error;
            data = workspaceResult.data || [];
          }
        }
        return res.status(200).json({
          ok: true,
          operator: { id: requester.id, email: requester.email || null },
          creator: { id: requester.id, email: requester.email || null },
          canManageOtherRestaurants: isPlatformOperator,
          restaurants: data,
        });
      }

      const body = jsonBody(req);
      if (body == null) return res.status(400).json({ error: "Invalid JSON request body." });
      const normalized = normalizeManagedRestaurantPayload({
        ...body,
        adminEmail: body.adminEmail || requesterEmail,
      });
      if (!normalized.ok) {
        return res.status(400).json({ error: "Check the highlighted setup fields.", fields: normalized.errors });
      }
      const input = normalized.value;
      const isSelfService = Boolean(requesterEmail) && input.adminEmail === requesterEmail;
      if (!isSelfService && !isPlatformOperator) {
        log("warn", "restaurant_onboarding_denied", { reason: "different_admin_requires_operator" });
        return res.status(403).json({ error: "You can create a restaurant only for your own account." });
      }

      const { data: existingWorkspace, error: existingError } = await adminClient
        .from("workspaces")
        .select("id, name, slug")
        .eq("slug", input.slug)
        .maybeSingle();
      if (existingError) throw existingError;
      if (existingWorkspace) {
        return res.status(409).json({ error: `The restaurant key “${input.slug}” is already in use.` });
      }

      let adminUser = isSelfService ? requester : await findUserByEmail(adminClient, input.adminEmail);
      let invited = false;
      if (!adminUser) {
        const baseUrl = appUrl(req);
        const options = baseUrl ? { redirectTo: `${baseUrl}/?set-password=1` } : undefined;
        const { data, error } = await adminClient.auth.admin.inviteUserByEmail(input.adminEmail, options);
        if (error) throw error;
        adminUser = data?.user;
        invited = true;
      }
      if (!adminUser?.id) throw new Error("Supabase did not return the restaurant Admin account id.");

      const workspaceId = makeWorkspaceId();
      const { data: provisioned, error: provisionError } = await adminClient.rpc(
        "provision_managed_restaurant",
        {
          p_workspace_id: workspaceId,
          p_name: input.name,
          p_slug: input.slug,
          p_admin_user_id: adminUser.id,
          p_operator_user_id: requester.id,
          p_operator_email: requester.email || null,
          p_keep_operator_admin: isSelfService ? true : input.keepOperatorAdmin,
          p_restaurant_config: {
            version: 1,
            name: input.name,
            subtitle: input.subtitle,
            tables: input.tables,
          },
          p_operations_config: {
            version: 1,
            timezone: input.timezone,
          },
        },
      );
      if (provisionError) throw provisionError;

      log("info", "restaurant_onboarding_completed", {
        workspaceId,
        slug: input.slug,
        invited,
        tableCount: input.tables.length,
      });
      return res.status(201).json({
        ok: true,
        invited,
        mode: isSelfService ? "self-service" : "managed",
        restaurant: provisioned || {
          id: workspaceId,
          name: input.name,
          slug: input.slug,
          adminUserId: adminUser.id,
        },
      });
    } catch (error) {
      const message = String(error?.message || "Restaurant onboarding failed.");
      const status = String(error?.code || "") === "23505" ? 409 : 500;
      log("error", "restaurant_onboarding_failed", { error: message, code: error?.code || null });
      return res.status(status).json({ error: message });
    }
  };
}

export default createRestaurantsHandler();
