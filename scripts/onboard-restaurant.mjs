#!/usr/bin/env node

import { createClient } from "@supabase/supabase-js";
import { fileURLToPath } from "node:url";
import path from "node:path";

const MAX_TABLES = 60;
const MAX_COURSES = 30;

export function normalizeSlug(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export function makeRestaurantConfig({ name, tableCount = 10, roomOptions = [] }) {
  const rooms = [...new Set(roomOptions.map((room) => String(room || "").trim()).filter(Boolean))];
  return {
    version: 1,
    name,
    subtitle: "SERVICE BOARD",
    tables: Array.from({ length: tableCount }, (_, index) => ({
      id: index + 1,
      label: `T${String(index + 1).padStart(2, "0")}`,
    })),
    features: {
      hotelGuests: rooms.length > 0,
      roomOptions: rooms,
    },
  };
}

export function makeStarterCourses(courseCount = 8) {
  return Array.from({ length: courseCount }, (_, index) => ({
    position: index + 1,
    course_key: `course_${String(index + 1).padStart(2, "0")}`,
    course_category: "main",
    menu: { name: `Course ${index + 1}`, sub: "" },
    menu_si: { name: `Hod ${index + 1}`, sub: "" },
    is_active: true,
  }));
}

export function parseArgs(argv) {
  const options = {
    apply: false,
    kind: "restaurant",
    tableCount: 10,
    courseCount: 8,
    roomOptions: [],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") {
      options.apply = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    const value = argv[index + 1];
    if (!arg.startsWith("--") || value == null || value.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }
    index += 1;
    if (arg === "--name") options.name = String(value).trim();
    else if (arg === "--slug") options.slug = normalizeSlug(value);
    else if (arg === "--admin-email") options.adminEmail = String(value).trim().toLowerCase();
    else if (arg === "--kind") options.kind = String(value).trim().toLowerCase();
    else if (arg === "--tables") options.tableCount = Number(value);
    else if (arg === "--courses") options.courseCount = Number(value);
    else if (arg === "--rooms") options.roomOptions = String(value).split(",").map((room) => room.trim()).filter(Boolean);
    else if (arg === "--app-url") options.appUrl = String(value).trim().replace(/\/$/, "");
    else throw new Error(`Unknown option: ${arg}`);
  }

  if (options.help) return options;
  if (!options.name) throw new Error("--name is required");
  options.slug = options.slug || normalizeSlug(options.name);
  if (!/^[a-z0-9][a-z0-9-]{1,47}$/.test(options.slug)) {
    throw new Error("--slug must contain 2-48 lowercase letters, numbers, or hyphens");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(options.adminEmail || "")) {
    throw new Error("--admin-email must be a valid email address");
  }
  if (!new Set(["restaurant", "sandbox"]).has(options.kind)) {
    throw new Error("--kind must be restaurant or sandbox");
  }
  if (!Number.isInteger(options.tableCount) || options.tableCount < 1 || options.tableCount > MAX_TABLES) {
    throw new Error(`--tables must be an integer between 1 and ${MAX_TABLES}`);
  }
  if (!Number.isInteger(options.courseCount) || options.courseCount < 1 || options.courseCount > MAX_COURSES) {
    throw new Error(`--courses must be an integer between 1 and ${MAX_COURSES}`);
  }
  return options;
}

export function helpText() {
  return `Controlled restaurant onboarding (dry-run by default)

Usage:
  npm run onboard:restaurant -- --name "Restaurant Name" --admin-email owner@example.com [options]

Options:
  --slug restaurant-name   Stable tenant slug (derived from name when omitted)
  --tables 10              Initial T01..T10 table count (1-${MAX_TABLES})
  --courses 8              Neutral editable course scaffold (1-${MAX_COURSES})
  --rooms 101,102,201      Enable hotel guest fields with these room choices
  --kind restaurant        restaurant or sandbox
  --app-url https://...    Password-setup redirect used for a new invitation
  --apply                  Perform the idempotent writes; without this, dry-run
`;
}

async function findUserByEmail(client, email) {
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const users = data?.users || [];
    const match = users.find((user) => String(user.email || "").toLowerCase() === email);
    if (match) return match;
    if (users.length < 1000) return null;
  }
  throw new Error("Auth user lookup exceeded 10,000 accounts; narrow the operator workflow before continuing.");
}

export async function onboardRestaurant(options, { env = process.env, logger = console } = {}) {
  const url = String(env.SUPABASE_URL || env.VITE_SUPABASE_URL || "").trim().replace(/\/$/, "");
  const serviceKey = String(
    env.SUPABASE_SERVICE_KEY || env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || "",
  ).trim();
  if (!url || !serviceKey) {
    throw new Error("Set SUPABASE_URL and a server-only SUPABASE_SERVICE_KEY before onboarding.");
  }

  const client = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: existingWorkspace, error: workspaceReadError } = await client
    .from("workspaces")
    .select("id, name, slug, kind")
    .eq("slug", options.slug)
    .maybeSingle();
  if (workspaceReadError) throw workspaceReadError;
  if (existingWorkspace && existingWorkspace.kind !== options.kind) {
    throw new Error(`Slug ${options.slug} already belongs to a ${existingWorkspace.kind} workspace.`);
  }
  if (existingWorkspace && existingWorkspace.name !== options.name) {
    throw new Error(
      `Slug ${options.slug} already belongs to "${existingWorkspace.name}"; use that exact name or choose a new slug.`,
    );
  }

  let user = await findUserByEmail(client, options.adminEmail);
  const { count: existingCourseCount, error: courseCountError } = await client
    .from("menu_courses")
    .select("position", { count: "exact", head: true })
    .eq("workspace_id", existingWorkspace?.id || "00000000-0000-0000-0000-000000000000");
  if (courseCountError) throw courseCountError;
  const plan = {
    mode: options.apply ? "apply" : "dry-run",
    workspace: existingWorkspace ? "reuse" : "create",
    adminAccount: user ? "link-existing" : "invite",
    slug: options.slug,
    name: options.name,
    kind: options.kind,
    tableCount: options.tableCount,
    menuCourses: Number(existingCourseCount || 0) > 0 ? "preserve-existing" : `seed-${options.courseCount}`,
    hotelGuests: options.roomOptions.length > 0,
    catalogueSync: "disabled",
  };
  logger.log(JSON.stringify(plan, null, 2));
  if (!options.apply) return { ok: true, dryRun: true, plan };

  let workspace = existingWorkspace;
  if (!workspace) {
    const { data, error } = await client
      .from("workspaces")
      .insert({ name: options.name, slug: options.slug, kind: options.kind })
      .select("id, name, slug, kind")
      .single();
    if (error) throw error;
    workspace = data;
  }

  let invited = false;
  if (!user) {
    const redirectTo = options.appUrl || String(env.APP_URL || "").trim().replace(/\/$/, "");
    const inviteOptions = redirectTo ? { redirectTo: `${redirectTo}/?set-password=1` } : undefined;
    const { data, error } = await client.auth.admin.inviteUserByEmail(options.adminEmail, inviteOptions);
    if (error) throw error;
    user = data?.user;
    invited = true;
  }
  if (!user?.id) throw new Error("Supabase did not return the initial Admin user id.");

  const { error: membershipError } = await client
    .from("workspace_members")
    .upsert(
      { workspace_id: workspace.id, user_id: user.id, role: "admin" },
      { onConflict: "workspace_id,user_id" },
    );
  if (membershipError) throw membershipError;

  const restaurantConfig = makeRestaurantConfig(options);
  const { error: settingsError } = await client
    .from("service_settings")
    .upsert([
      {
        workspace_id: workspace.id,
        id: "restaurant_config_v1",
        state: restaurantConfig,
        updated_at: new Date().toISOString(),
      },
      {
        workspace_id: workspace.id,
        id: "wine_sync_config",
        state: {
          provider: null,
          winesEnabled: false,
          beveragesEnabled: false,
          wineCountries: [],
          beveragePages: [],
        },
        updated_at: new Date().toISOString(),
      },
    ], { onConflict: "workspace_id,id", ignoreDuplicates: true });
  if (settingsError) throw settingsError;

  const { count: currentCourseCount, error: currentCourseCountError } = await client
    .from("menu_courses")
    .select("position", { count: "exact", head: true })
    .eq("workspace_id", workspace.id);
  if (currentCourseCountError) throw currentCourseCountError;
  if (Number(currentCourseCount || 0) === 0) {
    const now = new Date().toISOString();
    const { error: courseSeedError } = await client
      .from("menu_courses")
      .upsert(
        makeStarterCourses(options.courseCount).map((course) => ({
          ...course,
          workspace_id: workspace.id,
          updated_at: now,
        })),
        { onConflict: "workspace_id,position", ignoreDuplicates: true },
      );
    if (courseSeedError) throw courseSeedError;
  }

  const { data: verifiedMembership, error: verifyError } = await client
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspace.id)
    .eq("user_id", user.id)
    .single();
  if (verifyError || verifiedMembership?.role !== "admin") {
    throw verifyError || new Error("Initial Admin membership verification failed.");
  }

  return {
    ok: true,
    dryRun: false,
    invited,
    workspace: { id: workspace.id, slug: workspace.slug, name: workspace.name, kind: workspace.kind },
    adminEmail: options.adminEmail,
    catalogueSync: "disabled",
  };
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log(helpText());
      return;
    }
    const result = await onboardRestaurant(options);
    if (!result.dryRun) console.log(JSON.stringify(result, null, 2));
    else console.log("Dry-run only. Re-run with --apply after reviewing this plan.");
  } catch (error) {
    console.error(`Onboarding failed: ${error?.message || error}`);
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) await main();
