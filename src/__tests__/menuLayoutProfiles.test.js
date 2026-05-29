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
  it("creates a single guest profile with long + short templates", () => {
    const { profiles, assignments } = createDefaultProfiles(sample);
    expect(profiles).toHaveLength(1);
    expect(profiles[0].target).toBe("guest_menu");
    expect(profiles[0].menuTemplate).toBeTruthy();
    expect(profiles[0].shortMenuTemplate).toBeTruthy();
    expect(assignments.longMenuProfileId).toBe(profiles[0].id);
    // Short slot starts empty so the user assigns a distinct profile if wanted.
    expect(assignments.shortMenuProfileId).toBeNull();
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

  it("guest profile's shortMenuTemplate is seeded from show_on_short / short_order", () => {
    const { profiles } = createDefaultProfiles(sample);
    const keys = deriveCourseKeysFromTemplate(profiles[0].shortMenuTemplate);
    expect(keys).toEqual(["linzer_eye", "trout_belly", "venison"]);
  });
});

// ── sanitizeProfilesPayload ──────────────────────────────────────────────────

describe("sanitizeProfilesPayload", () => {
  it("returns empty + null assignments for invalid input", () => {
    const s = sanitizeProfilesPayload(null);
    expect(s.profiles).toEqual([]);
    expect(s.assignments.longMenuProfileId).toBeNull();
    expect(s.assignments.shortMenuProfileId).toBeNull();
  });

  it("defaults missing target to guest_menu (legacy v1 upgrade)", () => {
    const raw = {
      profiles: [{ id: "p1", name: "Old", menuTemplate: { version: 2, rows: [] }, layoutStyles: {} }],
      activeProfileId: "p1",
    };
    const s = sanitizeProfilesPayload(raw);
    expect(s.profiles[0].target).toBe("guest_menu");
    // Long slot defaults to the only matching profile; the short slot stays
    // null rather than collapsing onto the same profile as the long slot.
    expect(s.assignments.longMenuProfileId).toBe("p1");
    expect(s.assignments.shortMenuProfileId).toBeNull();
  });

  it("defaults assignment slots to matching guest profiles when the stored id is missing", () => {
    const raw = {
      profiles: [
        { id: "g1", name: "G1", target: "guest_menu", menuTemplate: { rows: [] }, layoutStyles: {} },
        { id: "g2", name: "G2", target: "guest_menu", menuTemplate: { rows: [] }, layoutStyles: {} },
      ],
      assignments: { longMenuProfileId: "nope" },
    };
    const s = sanitizeProfilesPayload(raw);
    expect(s.assignments.longMenuProfileId).toBe("g1");
    expect(s.assignments.shortMenuProfileId).toBe("g2");
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

describe("getAssignedGuestProfile / getAssignedProfile", () => {
  it("guest helper resolves the long and short slots", () => {
    const { profiles } = createDefaultProfiles(sample);
    const id = profiles[0].id;
    const assignments = { longMenuProfileId: id, shortMenuProfileId: id };
    expect(getAssignedGuestProfile("long",  profiles, assignments).id).toBe(id);
    expect(getAssignedGuestProfile("short", profiles, assignments).id).toBe(id);
  });

  it("returns null when the slot points at a missing profile", () => {
    const { profiles } = createDefaultProfiles(sample);
    expect(getAssignedGuestProfile("long", profiles, { longMenuProfileId: "missing" })).toBeNull();
  });

  it("returns null when the resolved profile is not the requested target", () => {
    const { profiles } = createDefaultProfiles(sample);
    const id = profiles[0].id;
    const assignments = { longMenuProfileId: id };
    expect(getAssignedProfile("long", profiles, assignments, "guest_menu").target).toBe("guest_menu");
    expect(getAssignedProfile("long", profiles, assignments, "kitchen_flow")).toBeNull();
  });
});

// ── Profile management ───────────────────────────────────────────────────────

describe("duplicateProfile", () => {
  it("creates a deep copy with new id and preserves target", () => {
    const original = makeProfile({
      name: "Long 2026", target: "guest_menu",
      menuTemplate: { version: 2, rows: [{ id: "r1", left: { type: "course", courseKey: "venison" }, right: null, gap: 0, widthPreset: "100/0" }] },
      layoutStyles: { foo: 1 },
    });
    const copy = duplicateProfile(original, "Long 2026 (copy)");
    expect(copy.id).not.toBe(original.id);
    expect(copy.name).toBe("Long 2026 (copy)");
    expect(copy.target).toBe("guest_menu");
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

  it("setProfileTarget normalizes any unsupported target to guest_menu", () => {
    const a = makeProfile({ name: "A", target: "guest_menu" });
    const next = setProfileTarget([a], a.id, "kitchen_flow");
    expect(next[0].target).toBe("guest_menu");
  });
});

describe("canDeleteProfile / isProfileAssigned", () => {
  it("blocks deletion when the profile is assigned to any slot", () => {
    const a = makeProfile({ name: "A", target: "guest_menu" });
    const b = makeProfile({ name: "B", target: "guest_menu" });
    const c = makeProfile({ name: "C", target: "guest_menu" });
    const profiles = [a, b, c];
    const assignments = {
      longMenuProfileId:  a.id,
      shortMenuProfileId: b.id,
    };
    expect(isProfileAssigned(a.id, assignments)).toBe(true);
    expect(canDeleteProfile(a.id, profiles, assignments)).toBe(false);
    expect(canDeleteProfile(b.id, profiles, assignments)).toBe(false);
    expect(canDeleteProfile(c.id, profiles, assignments)).toBe(true);
  });

  it("blocks deletion of the last remaining profile", () => {
    const g1 = makeProfile({ name: "G1", target: "guest_menu" });
    expect(canDeleteProfile(g1.id, [g1], {})).toBe(false);
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

describe("aperitif block sharing a course row", () => {
  const aperitifSeat = (aps) => ({ id: 1, pairing: "", aperitifs: aps, glasses: [], cocktails: [], beers: [] });
  const dataCk = (k) => `data-ck="${k}"`;

  it("keeps the course and renders the aperitif in its right column", () => {
    const html = generateMenuHTML({
      seat: aperitifSeat([{ name: "Krug Grande Cuvée", __type: "wine" }]),
      table: { menuType: "long", restrictions: [], bottleWines: [] },
      menuCourses: sample,
      menuTemplate: {
        version: 2,
        rows: [
          { id: "r_amuse", left: { type: "course", courseKey: "amuse" }, right: { type: "aperitif" }, widthPreset: "55/45", gap: 0 },
        ],
      },
      menuTitle: "TEST",
    });
    // Course block must NOT be deleted, and the aperitif must show alongside it.
    expect(html).toContain(dataCk("amuse"));
    expect(html).toContain("Krug Grande Cuvée");
  });

  it("renders the first aperitif in the assigned course row and overflows the rest downward", () => {
    const rows = generateMenuHTML({
      seat: aperitifSeat([
        { name: "Krug", __type: "wine" },
        { name: "Bollinger", __type: "wine" },
      ]),
      table: { menuType: "long", restrictions: [], bottleWines: [] },
      menuCourses: sample,
      menuTemplate: {
        version: 2,
        rows: [
          { id: "r_amuse", left: { type: "course", courseKey: "amuse" }, right: { type: "aperitif" }, widthPreset: "55/45", gap: 0 },
          { id: "r_linzer", left: { type: "course", courseKey: "linzer_eye" }, right: { type: "drinks" }, widthPreset: "55/45", gap: 0 },
        ],
      },
      _rowsOnly: true,
    });
    const amuse = rows.find(r => r.courseKey === "amuse");
    const linzer = rows.find(r => r.courseKey === "linzer_eye");
    expect(amuse?.right?.title).toBe("Krug");
    // Second aperitif overflows into the next pre-Danube course right column.
    expect(linzer?.right?.title).toBe("Bollinger");
  });
});

describe("PROFILE_TARGETS", () => {
  it("exposes the guest_menu target", () => {
    expect(PROFILE_TARGETS).toEqual(["guest_menu"]);
  });
});

// ── Regression: sanitize must preserve every field the editor saves ──────────
//
// The editor mutates four template fields on a profile:
//   menuTemplate         (long guest menu)
//   shortMenuTemplate    (short guest menu)
//   ticketTemplate       (long kitchen ticket)
//   shortTicketTemplate  (short kitchen ticket)
//
// sanitizeProfilesPayload runs inside updateProfiles() (every profile-level
// admin action: rename, create, duplicate, delete, set-target, set-assignment,
// select-active) AND on every load from Supabase. Anything it drops is gone
// the next time the user touches profile management. This regression was
// silently destroying kitchen ticket layouts — including "Spring 2026".
describe("sanitizeProfilesPayload — preserves editor-managed fields", () => {
  const fullProfile = {
    id: "spring_2026",
    name: "Spring 2026",
    target: "guest_menu",
    menuTemplate: { version: 2, rows: [{ id: "r1", left: { type: "course", courseKey: "lamb" }, right: null }] },
    shortMenuTemplate: { version: 2, rows: [{ id: "rs1", left: { type: "course", courseKey: "lamb" }, right: null }] },
    ticketTemplate: { version: 1, rows: [{ id: "kt1", type: "course", courseKey: "lamb" }] },
    shortTicketTemplate: { version: 1, rows: [{ id: "kst1", type: "course", courseKey: "lamb" }] },
    layoutStyles: { padTop: 8 },
  };

  it("keeps menuTemplate", () => {
    const out = sanitizeProfilesPayload({ profiles: [fullProfile], assignments: {}, activeProfileId: fullProfile.id });
    expect(out.profiles[0].menuTemplate).toEqual(fullProfile.menuTemplate);
  });

  it("keeps shortMenuTemplate", () => {
    const out = sanitizeProfilesPayload({ profiles: [fullProfile], assignments: {}, activeProfileId: fullProfile.id });
    expect(out.profiles[0].shortMenuTemplate).toEqual(fullProfile.shortMenuTemplate);
  });

  // The data-loss bug:
  it("keeps ticketTemplate (kitchen ticket layout)", () => {
    const out = sanitizeProfilesPayload({ profiles: [fullProfile], assignments: {}, activeProfileId: fullProfile.id });
    expect(out.profiles[0].ticketTemplate).toEqual(fullProfile.ticketTemplate);
  });

  it("keeps shortTicketTemplate (short kitchen ticket layout)", () => {
    const out = sanitizeProfilesPayload({ profiles: [fullProfile], assignments: {}, activeProfileId: fullProfile.id });
    expect(out.profiles[0].shortTicketTemplate).toEqual(fullProfile.shortTicketTemplate);
  });

  it("keeps layoutStyles", () => {
    const out = sanitizeProfilesPayload({ profiles: [fullProfile], assignments: {}, activeProfileId: fullProfile.id });
    expect(out.profiles[0].layoutStyles).toEqual(fullProfile.layoutStyles);
  });

  it("survives a round-trip without losing any editor-managed field", () => {
    // Simulates: load → rename → save (each step goes through sanitize).
    const renamed = renameProfile([fullProfile], "spring_2026", "Spring 2026 v2");
    const out = sanitizeProfilesPayload({
      profiles: renamed,
      assignments: { longMenuProfileId: "spring_2026" },
      activeProfileId: "spring_2026",
    });
    const p = out.profiles[0];
    expect(p.name).toBe("Spring 2026 v2");
    expect(p.menuTemplate).toEqual(fullProfile.menuTemplate);
    expect(p.shortMenuTemplate).toEqual(fullProfile.shortMenuTemplate);
    expect(p.ticketTemplate).toEqual(fullProfile.ticketTemplate);
    expect(p.shortTicketTemplate).toEqual(fullProfile.shortTicketTemplate);
    expect(p.layoutStyles).toEqual(fullProfile.layoutStyles);
  });

  it("normalizes a profile that lacks ticket fields without erroring", () => {
    // A profile saved before kitchen-ticket layouts existed should still load
    // cleanly: missing fields stay missing (or become null), never throw.
    const legacy = {
      id: "old", name: "Old", target: "guest_menu",
      menuTemplate: { version: 2, rows: [] },
      layoutStyles: {},
    };
    const out = sanitizeProfilesPayload({ profiles: [legacy], assignments: {}, activeProfileId: legacy.id });
    expect(out.profiles[0].ticketTemplate ?? null).toBeNull();
    expect(out.profiles[0].shortTicketTemplate ?? null).toBeNull();
  });
});

// ── Duplicating a profile must clone every editor-managed field too ──────────
//
// `duplicateProfile` is what powers the Admin → "Duplicate" button. If it
// drops a field, the duplicate is born already missing data the original had.
describe("duplicateProfile — copies every editor-managed field", () => {
  const fullProfile = {
    id: "spring_2026",
    name: "Spring 2026",
    target: "guest_menu",
    menuTemplate: { version: 2, rows: [{ id: "r1", left: { type: "course", courseKey: "lamb" }, right: null }] },
    shortMenuTemplate: { version: 2, rows: [{ id: "rs1", left: { type: "course", courseKey: "trout" }, right: null }] },
    ticketTemplate: { version: 1, rows: [{ id: "kt1", type: "course", courseKey: "lamb" }] },
    shortTicketTemplate: { version: 1, rows: [{ id: "kst1", type: "course", courseKey: "trout" }] },
    layoutStyles: { padTop: 8 },
  };

  it("includes ticketTemplate on the clone (deep-copied)", () => {
    const copy = duplicateProfile(fullProfile, "Spring 2026 (copy)");
    expect(copy.ticketTemplate).toBeTruthy();
    expect(copy.ticketTemplate).not.toBe(fullProfile.ticketTemplate);
  });

  it("includes shortTicketTemplate on the clone (deep-copied)", () => {
    const copy = duplicateProfile(fullProfile, "Spring 2026 (copy)");
    expect(copy.shortTicketTemplate).toBeTruthy();
    expect(copy.shortTicketTemplate).not.toBe(fullProfile.shortTicketTemplate);
  });

  it("does not mutate the source profile's ticket templates when the clone is edited", () => {
    const copy = duplicateProfile(fullProfile, "Spring 2026 (copy)");
    // simulate an edit on the clone
    copy.ticketTemplate.rows.push({ id: "new", type: "course", courseKey: "added" });
    expect(fullProfile.ticketTemplate.rows).toHaveLength(1);
  });
});

// ── Single allowed target — the kitchen-flow slot was a ghost ────────────────
//
// MenuLayoutPanel used to expose an unused "Kitchen Profile" assignment row
// and a target dropdown with "guest_menu" + "kitchen_flow". Nothing
// downstream consumed kitchen_flow profiles, sanitize dropped the slot, and
// the Kitchen target was a one-way trap that silently destroyed data on next
// save. After cleanup, only "guest_menu" should be a recognized target.
describe("PROFILE_TARGETS — only guest_menu is wired through", () => {
  it("lists exactly one target", () => {
    expect(PROFILE_TARGETS).toEqual(["guest_menu"]);
  });

  it("sanitize normalizes any unrecognized target back to guest_menu", () => {
    const out = sanitizeProfilesPayload({
      profiles: [{ id: "x", name: "X", target: "kitchen_flow", menuTemplate: { version: 2, rows: [] }, layoutStyles: {} }],
      activeProfileId: "x",
    });
    expect(out.profiles[0].target).toBe("guest_menu");
  });
});

// ── End-to-end persistence shape: anything the editor mutates must round-trip
// through sanitize → upsert → load → sanitize without drift. Drift here was
// the exact mechanism that destroyed "Spring 2026"'s kitchen-ticket layouts.
describe("Editor → Supabase → editor round-trip", () => {
  const editorProfile = {
    id: "p1", name: "Spring", target: "guest_menu",
    menuTemplate:        { version: 2, rows: [{ id: "r1", left: { type: "course", courseKey: "lamb" }, right: null }] },
    shortMenuTemplate:   { version: 2, rows: [{ id: "rs1", left: { type: "course", courseKey: "lamb" }, right: null }] },
    ticketTemplate:      { version: 1, rows: [{ id: "kt1", type: "course", courseKey: "lamb" }] },
    shortTicketTemplate: { version: 1, rows: [{ id: "kst1", type: "course", courseKey: "lamb" }] },
    layoutStyles: { padTop: 8 },
  };

  it("two sanitize passes (= save → reload) is idempotent", () => {
    const once  = sanitizeProfilesPayload({ profiles: [editorProfile], activeProfileId: "p1" });
    const twice = sanitizeProfilesPayload(once);
    expect(twice).toEqual(once);
  });

  it("a no-op admin action (e.g. select-active) does not change any field", () => {
    const after = sanitizeProfilesPayload({
      profiles: [editorProfile],
      activeProfileId: "p1",
      assignments: { longMenuProfileId: "p1" },
    });
    expect(after.profiles[0]).toEqual({
      id: "p1", name: "Spring", target: "guest_menu",
      menuTemplate:        editorProfile.menuTemplate,
      shortMenuTemplate:   editorProfile.shortMenuTemplate,
      ticketTemplate:      editorProfile.ticketTemplate,
      shortTicketTemplate: editorProfile.shortTicketTemplate,
      layoutStyles:        editorProfile.layoutStyles,
    });
  });
});
