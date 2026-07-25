// The Supabase edge function decides whether an action needs staff access from
// a list. It used to be a list of actions that DID need it, which is safe only
// while everybody remembers to add to it — and somebody did not: `recordVisits`
// shipped outside the list and was callable by anyone, meaning a stranger could
// write visit history into guest records.
//
// It is now a list of actions a GUEST may take, and everything else needs
// staff. This test reads the source and fails if that ever inverts, or if a new
// action quietly joins the public list.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(
  join(process.cwd(), "supabase/functions/reservations-lab/index.ts"),
  "utf8",
);

// Exactly the eight things /book and a manage link do, and nothing else.
const EXPECTED_PUBLIC = [
  "publicConfig", "availability", "validate", "submit",
  "waitlist", "manage", "cancel", "change",
];

function listedIn(name) {
  const match = new RegExp(`const ${name} = new Set\\(\\[([^\\]]*)\\]`, "s").exec(source);
  if (!match) return null;
  return [...match[1].matchAll(/"([a-zA-Z]+)"/g)].map((entry) => entry[1]);
}

describe("edge function access gate", () => {
  it("denies by default — the list is of public actions, not staff ones", () => {
    expect(source).toContain("if (!publicActions.has(action)) {");
    expect(source).not.toContain("if (staffActions.has(action)) {");
  });

  it("lets exactly the guest actions through unauthenticated", () => {
    expect(listedIn("publicActions")?.sort()).toEqual([...EXPECTED_PUBLIC].sort());
  });

  it("keeps every other action behind staff access", () => {
    const publicActions = new Set(listedIn("publicActions"));
    const all = new Set([...source.matchAll(/action === "([a-zA-Z]+)"/g)].map((entry) => entry[1]));
    const guarded = [...all].filter((action) => !publicActions.has(action));

    // The ones that would be worst to leave open, named so a future reader
    // sees why the list matters.
    ["staffState", "recordVisits", "seedLab", "deleteBooking", "saveAdminSettings"]
      .forEach((action) => expect(guarded, `${action} must need staff access`).toContain(action));
    expect(guarded.length).toBeGreaterThan(EXPECTED_PUBLIC.length);
  });

  it("keeps settings and seeding to an Admin", () => {
    const adminActions = listedIn("adminActions") || [];
    ["saveConfig", "saveAdminSettings", "seedLab"].forEach((action) => {
      expect(adminActions, `${action} must be admin-only`).toContain(action);
    });
  });

  it("refuses to seed anything that is not the LAB workspace", () => {
    expect(source).toContain('workspace.slug !== "milka-reservations-lab"');
    expect(source).toContain("RESERVATIONS_LAB_SEED_ENABLED");
  });
});
