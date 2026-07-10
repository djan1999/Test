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
});
