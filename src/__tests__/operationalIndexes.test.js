import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const sql = fs.readFileSync(
  path.resolve("supabase/migrations/20260713124500_operational_query_indexes.sql"),
  "utf8",
).toLowerCase();

describe("operational database indexes", () => {
  it("supports active and deleted archive timelines separately", () => {
    expect(sql).toContain("service_archive_active_recent_idx");
    expect(sql).toContain("where deleted_at is null");
    expect(sql).toContain("service_archive_trash_recent_idx");
    expect(sql).toContain("where deleted_at is not null");
  });

  it("supports catalogue and staff ordering inside one workspace", () => {
    expect(sql).toContain("public.wines(workspace_id, name)");
    expect(sql).toContain("public.beverages(workspace_id, position)");
    expect(sql).toContain("public.workspace_members(workspace_id, created_at)");
  });

  it("indexes the nullable audit-log foreign key", () => {
    expect(sql).toContain("public.audit_log(actor_id)");
  });
});
