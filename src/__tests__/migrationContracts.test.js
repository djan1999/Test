import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const hardening = fs.readFileSync(
  path.join(ROOT, "supabase/migrations/20260710000000_harden_realtime_catalog.sql"),
  "utf8",
);
const publication = fs.readFileSync(
  path.join(ROOT, "supabase/migrations/20260710010000_powersync_publication_and_role_preflight.sql"),
  "utf8",
);
const simplified = fs.readFileSync(
  path.join(ROOT, "supabase/migrations/20260710065543_simplify_workspace_accounts.sql"),
  "utf8",
);
const settingCas = fs.readFileSync(
  path.join(ROOT, "supabase/migrations/20260720190556_service_settings_cas.sql"),
  "utf8",
);
const managedProvisioning = fs.readFileSync(
  path.join(ROOT, "supabase/migrations/20260720203553_managed_restaurant_provisioning.sql"),
  "utf8",
);
const schema = fs.readFileSync(path.join(ROOT, "schema.sql"), "utf8");
const app = fs.readFileSync(path.join(ROOT, "src/App.jsx"), "utf8");
const syncApi = fs.readFileSync(path.join(ROOT, "api/sync-wines.js"), "utf8");
const syncRules = fs.readFileSync(path.join(ROOT, "powersync/sync-rules.yaml"), "utf8");

describe("database migration contracts", () => {
  it("contains the atomic catalog, board CAS, and service-finish functions", () => {
    expect(hardening).toContain("replace_synced_catalog");
    expect(hardening).toContain("save_service_table_if_current");
    expect(hardening).toContain("archive_and_finish_service");
  });

  it("protects shared floor documents with an RLS-aware compare-and-swap function", () => {
    for (const source of [settingCas, schema]) {
      expect(source).toContain("save_service_setting_if_current");
      expect(source).toContain("security invoker");
      expect(source).toContain("setting.updated_at = p_expected_updated_at");
      expect(source).toContain("revoke all on function public.save_service_setting_if_current");
      expect(source).toContain("to authenticated, service_role");
    }
  });

  it("protects reservation/terrace documents with an RLS-aware snapshot CAS", () => {
    for (const source of [settingCas, schema]) {
      expect(source).toContain("save_reservation_if_current");
      expect(source).toContain("reservation.data is not distinct from");
      expect(source).toContain("revoke all on function public.save_reservation_if_current");
      expect(source).toContain("to authenticated, service_role");
    }
  });

  it("creates restaurants atomically through a server-only security-invoker RPC", () => {
    for (const source of [managedProvisioning, schema]) {
      expect(source).toContain("provision_managed_restaurant");
      expect(source).toContain("security invoker");
      expect(source).toContain("from public, anon, authenticated");
      expect(source).toContain("to service_role");
      expect(source).toContain("insert into public.workspaces");
      expect(source).toContain("insert into public.workspace_members");
      expect(source).toContain("insert into public.service_tables");
      expect(source).toContain("restaurant_operations_v1");
    }
  });

  it("reconstructs every table required by the PowerSync streams", () => {
    for (const table of [
      "workspace_members", "service_tables", "reservations", "service_settings",
      "menu_courses", "beverages", "wines", "service_archive",
    ]) {
      expect(publication).toContain(`'${table}'`);
    }
    expect(publication).toContain("create publication powersync");
  });

  it("removes special accounts and grants current members one consistent owner path", () => {
    expect(simplified).toContain("drop table if exists public.platform_admins");
    expect(simplified).toContain("drop function if exists private.is_platform_admin");
    expect(simplified).toContain("drop function if exists private.is_workspace_owner");
    for (const table of ["menu_courses", "wines", "beverages", "service_settings"]) {
      expect(simplified).toContain(`create policy "${table}_member_all"`);
    }
    expect(simplified).not.toContain("role = 'owner'");
    expect(schema).not.toMatch(/platform_admin|is_workspace_owner|staff_operational|owner_write/);
  });

  it("keeps Demo on the ordinary membership path from UI through sync", () => {
    expect(app).not.toMatch(/platform_admins|isPlatformAdmin|workspaceRole|localDbHasWorkspaceData/);
    expect(app).toContain("workspaceId: getWorkspaceId()");
    expect(syncApi).toContain("requestBody.workspaceId");
    expect(syncApi).not.toContain('from("platform_admins")');
    expect(syncRules).toContain("workspace_members WHERE user_id = auth.user_id()");
  });

  it("the end-of-service guard treats a startedAt-less state as date-checked (12.07)", () => {
    const identitylessEnd = fs.readFileSync(
      path.join(ROOT, "supabase/migrations/20260712000000_identityless_end_guard.sql"),
      "utf8",
    );
    // Migration and fresh-install schema must carry the same guard: an
    // identity-less live state (no startedAt) is judged by date alone, so it
    // can never refuse every guarded end forever (the 11.07 incident).
    for (const source of [identitylessEnd, schema]) {
      expect(source).toContain("state->>'startedAt' is null");
      expect(source).toContain("state->>'startedAt' = p_expected_started_at");
      expect(source).toContain("state->>'date' = p_expected_date");
    }
  });
});
