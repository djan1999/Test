import { describe, it, expect } from "vitest";
import {
  PROFILE_TARGETS,
  makeProfile,
  createDefaultProfiles,
  sanitizeProfilesPayload,
  migrateV1ToV2,
  migrateLegacySingleLayout,
  duplicateProfile,
  renameProfile,
  setProfileTarget,
  isProfileAssigned,
  canDeleteProfile,
  getAssignedProfile,
  getAssignedGuestProfile,
  getAssignedKitchenProfile,
  deriveCourseKeysFromTemplate,
  deriveKitchenItemsFromTemplate,
} from "../utils/menuLayoutProfiles.js";
import { generateMenuHTML } from "../utils/menuGenerator.js";

const course = (key, position, opts = {}) => ({
  course_key: key,
  position,
  is_active: opts.is_active !== false,
  is_snack: !!opts.is_snack,
  show_on_short: opts.show_on_short || false,
  short_order: opts.short_order ?? null,
  course_category: opts.course_category || "main",
  optional_flag: opts.optional_flag || "",
  menu: { name: opts.name || key, sub: opts.sub || "" },
  ...opts,
});

const sample = [
  course("amuse",        1, { name: "Amuse" }),
  course("linzer_eye",   2, { name: "Linzer Eye",    show_on_short: true,  short_order: 1 }),
  course("trout_belly",  3, { name: "Trout Belly",   show_on_short: true,  short_order: 2 }),
  course("danube_salmon",4, { name: "Danube Salmon", show_on_short: false }),
  course("venison",      5, { name: "Venison",       show_on_short: true,  short_order: 3 }),
  course("dessert",      6, { name: "Dessert" }),
];

// ── createDefaultProfiles ────────────────────────────────────────────────────

describe("createDefaultProfiles", () => {
  it("creates four profiles: Long/Short guest + Long/Short kitchen", () => {
    const { profiles, assignments } = createDefaultProfiles(sample);
    expect(profiles).toHaveLength(4);
    const targets = profiles.map(p => p.target);
    expect(targets.filter(t => t === "guest_menu")).toHaveLength(2);
    expect(targets.filter(t => t === "kitchen_flow")).toHaveLength(2);
    expect(assignments.longMenuProfileId).toBeTruthy();
    expect(assignments.shortMenuProfileId).toBeTruthy();
    expect(assignments.longKitchenProfileId).toBeTruthy();
    expect(assignments.shortKitchenProfileId).toBeTruthy();
  });

  it("guest Long profile.menuTemplate has rows derived from buildDefaultTemplate", () => {
    const { profiles, assignments } = createDefaultProfiles(sample);
    const longGuest = profiles.find(p => p.id === assignments.longMenuProfileId);
    expect(longGuest.menuTemplate.version).toBe(2);
    expect(Array.isArray(longGuest.menuTemplate.rows)).toBe(true);
    // Course rows should appear for every active non-snack course
    const keys = deriveCourseKeysFromTemplate(longGuest.menuTemplate);
    expect(keys).toEqual(["amuse", "linzer_eye", "trout_belly", "danube_salmon", "venison", "dessert"]);
  });

  it("guest Short profile.menuTemplate is filtered by show_on_short and ordered by short_order", () => {
    const { profiles, assignments } = createDefaultProfiles(sample);
    const shortGuest = profiles.find(p => p.id === assignments.shortMenuProfileId);
    const keys = deriveCourseKeysFromTemplate(shortGuest.menuTemplate);
    expect(keys).toEqual(["linzer_eye", "trout_belly", "venison"]);
  });

  it("kitchen profiles are course-only (no title/team/goodbye/drinks)", () => {
    const { profiles, assignments } = createDefaultProfiles(sample);
    const longKitchen = profiles.find(p => p.id === assignments.longKitchenProfileId);
    const types = longKitchen.menuTemplate.rows.flatMap(r => [r.left?.type, r.right?.type]).filter(Boolean);
    expect(types.every(t => t === "course")).toBe(true);
  });

  it("kitchen course rows seed kitchen-overlay defaults", () => {
    const { profiles, assignments } = createDefaultProfiles(sample);
    const longKitchen = profiles.find(p => p.id === assignments.longKitchenProfileId);
    const items = deriveKitchenItemsFromTemplate(longKitchen.menuTemplate);
    const item = items[Object.keys(items)[0]];
    expect(item.showRestrictions).toBe(true);
    expect(item.showPairingAlert).toBe(true);
    expect(item.showSeatNotes).toBe(true);
    expect(item.showCourseNotes).toBe(true);
    expect(item.kitchenDisplayName).toBe("");
  });
});

// ── sanitizeProfilesPayload ──────────────────────────────────────────────────

describe("sanitizeProfilesPayload", () => {
  it("returns empty + null assignments for invalid input", () => {
    const s = sanitizeProfilesPayload(null);
    expect(s.profiles).toEqual([]);
    expect(s.assignments.longMenuProfileId).toBeNull();
    expect(s.assignments.longKitchenProfileId).toBeNull();
  });

  it("defaults missing target to guest_menu (legacy v1 upgrade)", () => {
    const raw = {
      profiles: [{ id: "p1", name: "Old", menuTemplate: { version: 2, rows: [] }, layoutStyles: {} }],
      activeProfileId: "p1",
    };
    const s = sanitizeProfilesPayload(raw);
    expect(s.profiles[0].target).toBe("guest_menu");
    // Guest assignments default to the only matching profile; kitchen stays null
    expect(s.assignments.longMenuProfileId).toBe("p1");
    expect(s.assignments.shortMenuProfileId).toBe("p1");
    expect(s.assignments.longKitchenProfileId).toBeNull();
    expect(s.assignments.shortKitchenProfileId).toBeNull();
  });

  it("repoints assignment slots that target the wrong category", () => {
    const raw = {
      profiles: [
        { id: "g1", name: "G", target: "guest_menu",   menuTemplate: { rows: [] }, layoutStyles: {} },
        { id: "k1", name: "K", target: "kitchen_flow", menuTemplate: { rows: [] }, layoutStyles: {} },
      ],
      // longKitchenProfileId points at a guest profile — must be repointed
      assignments: { longKitchenProfileId: "g1", shortKitchenProfileId: "k1" },
    };
    const s = sanitizeProfilesPayload(raw);
    expect(s.assignments.longKitchenProfileId).toBe("k1");
    expect(s.assignments.shortKitchenProfileId).toBe("k1");
  });

  it("honors activeProfileId when valid; falls back to first profile otherwise", () => {
    const raw = {
      profiles: [
        { id: "p1", name: "A", target: "guest_menu" },
        { id: "p2", name: "B", target: "guest_menu" },
      ],
      activeProfileId: "p2",
    };
    expect(sanitizeProfilesPayload(raw).activeProfileId).toBe("p2");
    expect(sanitizeProfilesPayload({ ...raw, activeProfileId: "missing" }).activeProfileId).toBe("p1");
  });
});

describe("migrateV1ToV2", () => {
  it("upgrades v1 payload by adding target=guest_menu to every profile", () => {
    const v1 = {
      profiles: [
        { id: "p1", name: "Long", layoutStyles: { foo: 1 }, menuTemplate: { version: 2, rows: [] } },
        { id: "p2", name: "Short", layoutStyles: {}, menuTemplate: { version: 2, rows: [] } },
      ],
      activeId: "p2",
    };
    const v2 = migrateV1ToV2(v1);
    expect(v2.profiles.every(p => p.target === "guest_menu")).toBe(true);
    expect(v2.activeProfileId).toBe("p2");
    // Round-trip through sanitize keeps menuTemplate + layoutStyles intact
    const s = sanitizeProfilesPayload(v2);
    expect(s.profiles[0].layoutStyles).toEqual({ foo: 1 });
    expect(s.profiles[0].menuTemplate.rows).toEqual([]);
  });
});

describe("migrateLegacySingleLayout", () => {
  it("wraps a single legacy template + styles into one guest profile", () => {
    const legacyLayout = { headerSpacing: 4 };
    const legacyTemplate = { version: 2, rows: [{ id: "x", left: null, right: null, gap: 0, widthPreset: "55/45" }] };
    const v2 = migrateLegacySingleLayout(legacyLayout, legacyTemplate);
    const s = sanitizeProfilesPayload(v2);
    expect(s.profiles).toHaveLength(1);
    expect(s.profiles[0].target).toBe("guest_menu");
    expect(s.profiles[0].layoutStyles).toEqual(legacyLayout);
    expect(s.profiles[0].menuTemplate.rows).toHaveLength(1);
  });
});

// ── Assignment helpers ───────────────────────────────────────────────────────

describe("getAssignedGuestProfile / getAssignedKitchenProfile", () => {
  it("guest helper picks long/short guest profile only", () => {
    const { profiles, assignments } = createDefaultProfiles(sample);
    const longGuest  = getAssignedGuestProfile("long",  profiles, assignments);
    const shortGuest = getAssignedGuestProfile("short", profiles, assignments);
    expect(longGuest.target).toBe("guest_menu");
    expect(shortGuest.target).toBe("guest_menu");
    expect(longGuest.id).not.toBe(shortGuest.id);
  });

  it("kitchen helper picks long/short kitchen profile only", () => {
    const { profiles, assignments } = createDefaultProfiles(sample);
    const longKitchen  = getAssignedKitchenProfile("long",  profiles, assignments);
    const shortKitchen = getAssignedKitchenProfile("short", profiles, assignments);
    expect(longKitchen.target).toBe("kitchen_flow");
    expect(shortKitchen.target).toBe("kitchen_flow");
  });

  it("returns null if assignment points at a wrong-target profile", () => {
    const { profiles, assignments } = createDefaultProfiles(sample);
    const wrong = { ...assignments, longKitchenProfileId: assignments.longMenuProfileId };
    expect(getAssignedKitchenProfile("long", profiles, wrong)).toBeNull();
  });

  it("explicit target argument also works on getAssignedProfile", () => {
    const { profiles, assignments } = createDefaultProfiles(sample);
    expect(getAssignedProfile("long",  profiles, assignments, "guest_menu").target).toBe("guest_menu");
    expect(getAssignedProfile("short", profiles, assignments, "kitchen_flow").target).toBe("kitchen_flow");
  });
});

// ── Profile management ───────────────────────────────────────────────────────

describe("duplicateProfile", () => {
  it("creates a deep copy with new id and preserves target", () => {
    const original = makeProfile({
      name: "Long 2026", target: "kitchen_flow",
      menuTemplate: { version: 2, rows: [{ id: "r1", left: { type: "course", courseKey: "venison" }, right: null, gap: 0, widthPreset: "100/0" }] },
      layoutStyles: { foo: 1 },
    });
    const copy = duplicateProfile(original, "Long 2026 (copy)");
    expect(copy.id).not.toBe(original.id);
    expect(copy.name).toBe("Long 2026 (copy)");
    expect(copy.target).toBe("kitchen_flow");
    expect(copy.menuTemplate.rows[0].left.courseKey).toBe("venison");
    // Mutating copy must not affect original
    copy.menuTemplate.rows.push({});
    expect(original.menuTemplate.rows).toHaveLength(1);
  });

  it("untagged legacy profiles duplicate as guest_menu", () => {
    const legacy = { id: "old", name: "Old", menuTemplate: null, layoutStyles: {} };
    expect(duplicateProfile(legacy).target).toBe("guest_menu");
  });
});

describe("renameProfile / setProfileTarget", () => {
  it("renameProfile updates the named profile only", () => {
    const a = makeProfile({ name: "A", target: "guest_menu" });
    const b = makeProfile({ name: "B", target: "guest_menu" });
    const next = renameProfile([a, b], a.id, "Renamed");
    expect(next[0].name).toBe("Renamed");
    expect(next[1].name).toBe("B");
  });

  it("setProfileTarget switches a profile's target", () => {
    const a = makeProfile({ name: "A", target: "guest_menu" });
    const next = setProfileTarget([a], a.id, "kitchen_flow");
    expect(next[0].target).toBe("kitchen_flow");
  });
});

describe("canDeleteProfile / isProfileAssigned", () => {
  it("blocks deletion when the profile is assigned to any slot", () => {
    const a = makeProfile({ name: "A", target: "guest_menu" });
    const b = makeProfile({ name: "B", target: "guest_menu" });
    const c = makeProfile({ name: "C", target: "guest_menu" });
    const k = makeProfile({ name: "K", target: "kitchen_flow" });
    const profiles = [a, b, c, k];
    const assignments = {
      longMenuProfileId:    a.id,
      shortMenuProfileId:   b.id,
      longKitchenProfileId: k.id,
      shortKitchenProfileId:k.id,
    };
    expect(isProfileAssigned(a.id, assignments)).toBe(true);
    expect(canDeleteProfile(a.id, profiles, assignments)).toBe(false);
    expect(canDeleteProfile(k.id, profiles, assignments)).toBe(false);
    expect(canDeleteProfile(c.id, profiles, assignments)).toBe(true);
  });

  it("blocks deletion that would leave a target with zero profiles", () => {
    const g1 = makeProfile({ name: "G1", target: "guest_menu" });
    const g2 = makeProfile({ name: "G2", target: "guest_menu" });
    const k1 = makeProfile({ name: "K1", target: "kitchen_flow" });
    // k1 is the only kitchen profile — even if unassigned, deletion would
    // leave the kitchen target empty
    expect(canDeleteProfile(k1.id, [g1, g2, k1], {})).toBe(false);
  });
});

// ── deriveCourseKeysFromTemplate ─────────────────────────────────────────────

describe("deriveCourseKeysFromTemplate", () => {
  const tmpl = (rows) => ({ version: 2, rows });

  it("walks rows in order and collects course block courseKeys", () => {
    const t = tmpl([
      { id: "1", left: { type: "title", text: "Hi" }, right: { type: "logo" } },
      { id: "2", left: { type: "course", courseKey: "amuse" }, right: { type: "drinks" } },
      { id: "3", left: { type: "course", courseKey: "venison" }, right: null },
      { id: "4", left: { type: "team" }, right: null },
    ]);
    expect(deriveCourseKeysFromTemplate(t)).toEqual(["amuse", "venison"]);
  });

  it("considers both left and right blocks", () => {
    const t = tmpl([
      { id: "1", left: { type: "drinks" }, right: { type: "course", courseKey: "trout_belly" } },
    ]);
    expect(deriveCourseKeysFromTemplate(t)).toEqual(["trout_belly"]);
  });

  it("ignores divider / spacer / text / pairing_label / aperitif / by_the_glass", () => {
    const t = tmpl([
      { id: "1", left: { type: "divider" }, right: null },
      { id: "2", left: { type: "spacer" }, right: { type: "text", text: "x" } },
      { id: "3", left: { type: "pairing_label" }, right: { type: "aperitif" } },
      { id: "4", left: { type: "by_the_glass" }, right: null },
      { id: "5", left: { type: "course", courseKey: "linzer_eye" }, right: null },
    ]);
    expect(deriveCourseKeysFromTemplate(t)).toEqual(["linzer_eye"]);
  });

  it("dedupes repeated course keys", () => {
    const t = tmpl([
      { id: "1", left: { type: "course", courseKey: "venison" }, right: null },
      { id: "2", left: { type: "course", courseKey: "venison" }, right: null },
      { id: "3", left: { type: "course", courseKey: "amuse" }, right: null },
    ]);
    expect(deriveCourseKeysFromTemplate(t)).toEqual(["venison", "amuse"]);
  });

  it("skips course blocks with no courseKey", () => {
    const t = tmpl([
      { id: "1", left: { type: "course", courseKey: "" }, right: null },
      { id: "2", left: { type: "course" }, right: null },
      { id: "3", left: { type: "course", courseKey: "amuse" }, right: null },
    ]);
    expect(deriveCourseKeysFromTemplate(t)).toEqual(["amuse"]);
  });
});

describe("deriveKitchenItemsFromTemplate", () => {
  it("returns per-courseKey overlay options with correct defaults", () => {
    const t = { version: 2, rows: [
      { id: "1", left: { type: "course", courseKey: "amuse" }, right: null },
      { id: "2", left: { type: "course", courseKey: "venison",
        kitchenDisplayName: "VEN", showRestrictions: false }, right: null },
    ]};
    const items = deriveKitchenItemsFromTemplate(t);
    expect(items.amuse).toEqual({
      kitchenDisplayName: "",
      showRestrictions: true,
      showPairingAlert: true,
      showSeatNotes: true,
      showCourseNotes: true,
    });
    expect(items.venison.kitchenDisplayName).toBe("VEN");
    expect(items.venison.showRestrictions).toBe(false);
    expect(items.venison.showPairingAlert).toBe(true);
  });
});

// ── Integration: print path uses assigned profile.menuTemplate ──────────────

describe("generateMenuHTML with assigned profile (row-based path)", () => {
  const baseSeat = { id: 1, pairing: "", aperitifs: [], glasses: [], cocktails: [], beers: [] };
  const dataCk = (k) => `data-ck="${k}"`;

  it("Long Menu renders the long guest profile's template", () => {
    const { profiles, assignments } = createDefaultProfiles(sample);
    const longGuest = profiles.find(p => p.id === assignments.longMenuProfileId);
    const html = generateMenuHTML({
      seat: baseSeat,
      table: { menuType: "long", restrictions: [], bottleWines: [] },
      menuCourses: sample,
      menuTemplate: longGuest.menuTemplate,
      layoutStyles: longGuest.layoutStyles,
      menuTitle: "TEST",
    });
    // All long courses should be present
    ["amuse", "linzer_eye", "trout_belly", "danube_salmon", "venison", "dessert"].forEach(k => {
      expect(html).toContain(dataCk(k));
    });
  });

  it("Short Menu renders the short guest profile's template — no show_on_short filtering", () => {
    // Build a custom Short profile that deliberately INCLUDES danube_salmon
    // (show_on_short=false) and EXCLUDES linzer_eye (show_on_short=true).
    const { profiles, assignments } = createDefaultProfiles(sample);
    const shortGuest = profiles.find(p => p.id === assignments.shortMenuProfileId);
    const customShort = {
      ...shortGuest,
      menuTemplate: {
        version: 2,
        rows: [
          { id: "r_amuse", left: { type: "course", courseKey: "amuse" }, right: null, widthPreset: "100/0", gap: 0 },
          { id: "r_salmon", left: { type: "course", courseKey: "danube_salmon" }, right: null, widthPreset: "100/0", gap: 0 },
          { id: "r_venison", left: { type: "course", courseKey: "venison" }, right: null, widthPreset: "100/0", gap: 0 },
        ],
      },
    };
    const html = generateMenuHTML({
      seat: baseSeat,
      table: { menuType: "long", restrictions: [], bottleWines: [] }, // long path so isShort=false
      menuCourses: sample,
      menuTemplate: customShort.menuTemplate,
      menuTitle: "TEST",
    });
    expect(html).toContain(dataCk("amuse"));
    expect(html).toContain(dataCk("danube_salmon"));
    expect(html).toContain(dataCk("venison"));
    expect(html).not.toContain(dataCk("linzer_eye"));
    expect(html).not.toContain(dataCk("trout_belly"));
  });
});

describe("PROFILE_TARGETS", () => {
  it("exposes both targets", () => {
    expect(PROFILE_TARGETS).toEqual(expect.arrayContaining(["guest_menu", "kitchen_flow"]));
  });
});
