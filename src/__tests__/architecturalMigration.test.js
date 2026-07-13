import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const sql = fs.readFileSync(
  path.resolve("supabase/migrations/20260713112749_architectural_rebuild_foundations.sql"),
  "utf8",
).toLowerCase();

describe("architectural rebuild database contract", () => {
  it("migrates legacy accounts into exactly the three supported roles", () => {
    expect(sql).toContain("set role = 'admin' where role = 'owner'");
    expect(sql).toContain("set role = 'service' where role = 'staff'");
    expect(sql).toContain("role in ('admin', 'service', 'kitchen')");
  });

  it("protects the last Admin with a serialized database trigger", () => {
    expect(sql).toContain("protect_last_workspace_admin");
    expect(sql).toContain("for update");
    expect(sql).toContain("cannot remove or demote the last admin");
  });

  it("allows configurable tables and clears the existing rows rather than T1-T10", () => {
    expect(sql).toContain("table_id between 1 and 999");
    expect(sql).toContain("update public.service_tables");
    expect(sql).not.toContain("generate_series(1, 10)");
  });

  it("records human admin changes without flooding the log with server maintenance", () => {
    expect(sql).toContain("create table if not exists public.audit_log");
    expect(sql).toContain("if auth.uid() is null");
    expect(sql).toContain("audit_log_admin_read");
  });

  it("uses explicit authenticated grants for the Data API", () => {
    expect(sql).toContain("revoke all on table public.workspaces");
    expect(sql).toContain("grant select on table public.workspaces");
  });

  it("pins security-definer functions to an empty search path", () => {
    expect(sql).not.toContain("set search_path = public");
    expect(sql).not.toContain("set search_path = pg_catalog, public");
    expect(sql.match(/set search_path = ''/g)?.length).toBeGreaterThanOrEqual(4);
  });
});
