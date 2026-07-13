import {
  WORKSPACE_ROLES,
  canAccessMode,
  canAdminister,
  normalizeWorkspaceRole,
  visibleEntryModes,
} from "../auth/roles.js";

describe("workspace roles", () => {
  it("migrates the legacy owner/staff names without locking users out", () => {
    expect(normalizeWorkspaceRole("owner")).toBe(WORKSPACE_ROLES.ADMIN);
    expect(normalizeWorkspaceRole("staff")).toBe(WORKSPACE_ROLES.SERVICE);
  });

  it("gives Admin access to every operating surface", () => {
    for (const mode of ["admin", "service", "reservation", "menu", "display", "kitchen_floor"]) {
      expect(canAccessMode("admin", mode)).toBe(true);
    }
    expect(canAdminister("admin")).toBe(true);
  });

  it("keeps Service on FOH, reservations, and menu printing", () => {
    expect(visibleEntryModes("service")).toEqual(["service", "reservation", "menu"]);
    expect(canAccessMode("service", "admin")).toBe(false);
    expect(canAccessMode("service", "display")).toBe(false);
  });

  it("keeps Kitchen on the kitchen board and kitchen floor only", () => {
    expect(visibleEntryModes("kitchen")).toEqual(["display"]);
    expect(canAccessMode("kitchen", "kitchen_floor")).toBe(true);
    expect(canAccessMode("kitchen", "service")).toBe(false);
    expect(canAdminister("kitchen")).toBe(false);
  });

  it("denies unknown and missing roles", () => {
    expect(canAccessMode("mystery", "service")).toBe(false);
    expect(canAccessMode(null, "service")).toBe(false);
  });
});
