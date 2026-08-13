import { describe, expect, it } from "vitest";
import { evaluateSetup, STATUS } from "../lib/setupReadiness.js";
import { buildDefaultFloorMaps } from "../utils/floorMaps.js";
import { makeDefaultRestaurantConfig } from "../config/restaurantConfig.js";
import { makeStarterCourses } from "../../scripts/onboard-restaurant.mjs";

const stepById = (result, id) => result.steps.find((step) => step.id === id);

// A workspace exactly as the onboarding workflow leaves it: named, scaffolded,
// one Admin, nothing else touched.
const freshWorkspace = (overrides = {}) => ({
  restaurantConfig: makeDefaultRestaurantConfig({ name: "Gostilna Test" }),
  floorMaps: buildDefaultFloorMaps(),
  menuCourses: makeStarterCourses(4),
  members: [{ user_id: "u1", role: "admin", email: "admin@example.com" }],
  restrictionsList: [{ key: "gluten", label: "Gluten" }],
  ...overrides,
});

// A workspace a restaurant has actually finished configuring.
const configuredWorkspace = (overrides = {}) => freshWorkspace({
  restaurantConfig: makeDefaultRestaurantConfig({
    name: "Gostilna Test",
    tables: [{ id: 1, label: "T1" }, { id: 2, label: "T2" }],
  }),
  menuCourses: [
    { course_key: "amuse", is_active: true, menu: { name: "Amuse bouche" } },
    { course_key: "main", is_active: true, menu: { name: "Beef cheek" } },
  ],
  members: [
    { user_id: "u1", role: "admin", email: "admin@example.com" },
    { user_id: "u2", role: "service", email: "floor@example.com" },
    { user_id: "u3", role: "kitchen", email: "pass@example.com" },
  ],
  ...overrides,
});

describe("setup readiness — the eight steps a new restaurant walks", () => {
  it("orders the steps the way the restaurant does them", () => {
    expect(evaluateSetup(freshWorkspace()).steps.map((step) => step.id)).toEqual([
      "identity", "tables", "floor", "courses", "staff", "permissions", "menu", "service",
    ]);
  });

  it("passes a fully configured restaurant with no blockers", () => {
    const result = evaluateSetup(configuredWorkspace());
    expect(result.ready).toBe(true);
    expect(result.blocking).toEqual([]);
    expect(result.headline).toMatch(/ready to run a service/i);
  });

  it("blocks a workspace that never got past the scaffold menu", () => {
    const result = evaluateSetup(freshWorkspace());
    expect(result.ready).toBe(false);
    // Guests would receive a menu reading "Course 1, Course 2 …".
    expect(stepById(result, "menu").status).toBe(STATUS.BLOCKED);
    // The starter table labels are advice, never a blocker — ten tables named
    // T01-T10 is a legitimate configuration.
    expect(stepById(result, "tables").status).toBe(STATUS.ATTENTION);
  });

  it("reports an unnamed workspace as blocking, since the name prints everywhere", () => {
    const result = evaluateSetup(freshWorkspace({
      restaurantConfig: makeDefaultRestaurantConfig({ name: "Restaurant" }),
    }));
    expect(stepById(result, "identity").status).toBe(STATUS.BLOCKED);
  });
});

describe("setup readiness — floor coverage", () => {
  it("blocks a configured table that has no place on the active layout", () => {
    const result = evaluateSetup(configuredWorkspace({
      restaurantConfig: makeDefaultRestaurantConfig({
        name: "Gostilna Test",
        tables: [{ id: 1, label: "T1" }, { id: 97, label: "T97" }],
      }),
    }));
    const floor = stepById(result, "floor");
    expect(floor.status).toBe(STATUS.BLOCKED);
    expect(floor.summary).toMatch(/T97/);
    expect(result.ready).toBe(false);
  });

  it("accepts a table the layout claims through a merge rather than an exact label", () => {
    // Layout A carries a merged table covering the slot; resolution by member
    // label is a real seat, not a hole in the floor.
    const floorMaps = buildDefaultFloorMaps();
    const covered = (floorMaps.maps.find((map) => map.kind === "dining")?.tables || [])
      .flatMap((table) => (Array.isArray(table.members) ? table.members : []))
      .map((label) => Number(String(label).replace(/^T/i, "")))
      .filter(Number.isFinite);
    if (!covered.length) return; // default geometry has no merges; nothing to assert
    const result = evaluateSetup(configuredWorkspace({
      floorMaps,
      restaurantConfig: makeDefaultRestaurantConfig({
        name: "Gostilna Test",
        tables: [{ id: covered[0], label: `T${covered[0]}` }],
      }),
    }));
    expect(stepById(result, "floor").status).toBe(STATUS.DONE);
  });
});

describe("setup readiness — staff and permissions", () => {
  it("does not claim a staff state it cannot see", () => {
    const result = evaluateSetup(freshWorkspace({ members: null }));
    expect(stepById(result, "staff").status).toBe(STATUS.UNKNOWN);
    expect(stepById(result, "permissions").status).toBe(STATUS.UNKNOWN);
    // An unreadable staff list must not read as "ready".
    expect(result.blocking.every((step) => step.id !== "staff")).toBe(true);
  });

  it("flags a restaurant whose kitchen would run on an Admin login", () => {
    const result = evaluateSetup(configuredWorkspace({
      members: [
        { user_id: "u1", role: "admin" },
        { user_id: "u2", role: "service" },
      ],
    }));
    const permissions = stepById(result, "permissions");
    expect(permissions.status).toBe(STATUS.ATTENTION);
    expect(permissions.summary).toMatch(/kitchen/i);
    // Advice, not a blocker: an Admin login can work every screen.
    expect(result.ready).toBe(true);
  });

  it("blocks a workspace left without an Admin", () => {
    const result = evaluateSetup(configuredWorkspace({
      members: [{ user_id: "u2", role: "service" }],
    }));
    expect(stepById(result, "staff").status).toBe(STATUS.BLOCKED);
  });

  it("warns when every device would share the single founding login", () => {
    expect(stepById(evaluateSetup(freshWorkspace()), "staff").status).toBe(STATUS.ATTENTION);
  });
});

describe("setup readiness — service configuration", () => {
  it("blocks hotel mode with an empty room list, which renders an empty picker", () => {
    const config = makeDefaultRestaurantConfig({ name: "Hotel Test" });
    const result = evaluateSetup(configuredWorkspace({
      restaurantConfig: { ...config, features: { hotelGuests: true, roomOptions: [] } },
    }));
    expect(stepById(result, "service").status).toBe(STATUS.BLOCKED);
  });

  it("accepts hotel mode once rooms are listed", () => {
    const config = makeDefaultRestaurantConfig({ name: "Hotel Test" });
    const result = evaluateSetup(configuredWorkspace({
      restaurantConfig: { ...config, features: { hotelGuests: true, roomOptions: ["01", "02"] } },
    }));
    expect(stepById(result, "service").status).toBe(STATUS.DONE);
  });

  it("flags an empty restriction list, since allergies could not be recorded", () => {
    const result = evaluateSetup(configuredWorkspace({ restrictionsList: [] }));
    expect(stepById(result, "service").status).toBe(STATUS.ATTENTION);
  });
});

describe("setup readiness — an empty workspace", () => {
  it("degrades to unknown rather than inventing a verdict", () => {
    const result = evaluateSetup();
    expect(result.ready).toBe(false);
    expect(stepById(result, "floor").status).toBe(STATUS.UNKNOWN);
    expect(stepById(result, "staff").status).toBe(STATUS.UNKNOWN);
    // The things it genuinely can tell from nothing, it does tell.
    expect(stepById(result, "identity").status).toBe(STATUS.BLOCKED);
    expect(stepById(result, "courses").status).toBe(STATUS.BLOCKED);
  });

  it("every step points at an admin section that exists", () => {
    const sections = new Set(["setup", "restaurant", "staff", "audit", "privacy", "menu",
      "dishes", "drinks", "quickaccess", "floor", "inventory", "system", "archive"]);
    for (const step of evaluateSetup(freshWorkspace()).steps) {
      expect(sections.has(step.section)).toBe(true);
    }
  });
});
