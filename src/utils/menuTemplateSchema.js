/**
 * menuTemplateSchema.js — block type definitions and default template builder
 * for the template-driven menu layout system (v2).
 *
 * Template shape saved in service_settings (id: "menu_layout_v2"):
 * {
 *   version: 2,
 *   rows: RowDef[],
 * }
 *
 * RowDef:  { id: string, left: BlockDef | null, right: BlockDef | null }
 * BlockDef: { type: string, ...typeSpecificFields }
 */

// ── Block type metadata ───────────────────────────────────────────────────────

export const BLOCK_META = {
  // ── Content blocks — resolve live data per seat ───────────────────────────
  course: {
    label: "Course",        group: "content", color: "#4b4b88", bg: "#f0f0f8", icon: "◈",
    desc: "Dish text for a specific course — respects seat restrictions",
    fields: [{ key: "courseKey", label: "Course", type: "course_select" }],
    defaults: { courseKey: "" },
  },
  pairing: {
    label: "Pairing",       group: "content", color: "#c8a06e", bg: "#fdf5ec", icon: "◎",
    desc: "Drink pairing for this seat's selection (Wine / Non-Alc / OS / Premium). Falls back to by-the-glass from Danube Salmon onwards.",
    fields: [],
    defaults: {},
  },
  pairing_label: {
    label: "Pairing Label", group: "content", color: "#c8a06e", bg: "#fdf5ec", icon: "T",
    desc: "Static section header before the pairing column begins — text editable",
    fields: [{ key: "text", label: "Label text", type: "text", placeholder: "WINE PAIRING" }],
    defaults: { text: "WINE PAIRING" },
  },
  by_the_glass: {
    label: "By the Glass",  group: "content", color: "#5a9e6e", bg: "#f0f8f2", icon: "◷",
    desc: "Consumes the next by-the-glass wine from the seat's glass queue",
    fields: [],
    defaults: {},
  },
  bottle: {
    label: "Bottle Wine",   group: "content", color: "#5a9e6e", bg: "#f0f8f2", icon: "◫",
    desc: "Consumes next table bottle wine from the queue",
    fields: [],
    defaults: {},
  },
  aperitif: {
    label: "Aperitif",      group: "content", color: "#7a6e9e", bg: "#f4f0fa", icon: "◇",
    desc: "Consumes next aperitif from the seat's aperitif queue",
    fields: [],
    defaults: {},
  },

  // ── Layout blocks ─────────────────────────────────────────────────────────
  spacer: {
    label: "Spacer",        group: "layout", color: "#999", bg: "#f8f8f8", icon: "▫",
    desc: "Empty vertical space — height adjustable in points",
    fields: [{ key: "height", label: "Height (pt)", type: "number", min: 0.5, max: 80, step: 0.5 }],
    defaults: { height: 8 },
  },
  divider: {
    label: "Divider",       group: "layout", color: "#888", bg: "#f4f4f4", icon: "—",
    desc: "Full-width horizontal rule",
    fields: [],
    defaults: {},
  },

  // ── Static blocks — same on every menu ───────────────────────────────────
  logo: {
    label: "Logo",          group: "static", color: "#1a1a1a", bg: "#f8f8f8", icon: "▣",
    desc: "Restaurant logo image",
    fields: [
      { key: "size",    label: "Size (mm)",     type: "number", min: 4,   max: 30,  step: 0.5 },
      { key: "offsetX", label: "Offset X (mm)", type: "number", min: -10, max: 10,  step: 0.5 },
      { key: "offsetY", label: "Offset Y (mm)", type: "number", min: -10, max: 10,  step: 0.5 },
    ],
    defaults: { size: 10.5, offsetX: 0, offsetY: 0 },
  },
  title: {
    label: "Title",         group: "static", color: "#1a1a1a", bg: "#f8f8f8", icon: "T",
    desc: "Menu title text — editable",
    fields: [{ key: "text", label: "Title text", type: "text", placeholder: "WINTER MENU" }],
    defaults: { text: "WINTER MENU" },
  },
  team: {
    label: "Team Names",    group: "static", color: "#555", bg: "#f4f4f4", icon: "◆",
    desc: "Team names loaded from settings",
    fields: [],
    defaults: {},
  },
  goodbye: {
    label: "Goodbye Note",  group: "static", color: "#555", bg: "#f4f4f4", icon: "◁",
    desc: "Thank-you / goodbye note — editable",
    fields: [{ key: "text", label: "Note text", type: "textarea", placeholder: "Hvala za vaš obisk." }],
    defaults: { text: "Hvala za vaš obisk." },
  },
  text: {
    label: "Text",          group: "static", color: "#333", bg: "#f2f2f2", icon: "≡",
    desc: "Free text block — fully editable",
    fields: [
      { key: "text", label: "Content", type: "textarea", placeholder: "Enter text..." },
      { key: "bold", label: "Bold",    type: "checkbox" },
    ],
    defaults: { text: "", bold: false },
  },
};

export const BLOCK_GROUPS = [
  { id: "content", label: "Content",  desc: "Resolves live data per seat" },
  { id: "layout",  label: "Layout",   desc: "Spacing and separators" },
  { id: "static",  label: "Static",   desc: "Same on every printed menu" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

let _seq = 1;
export function makeRowId(prefix = "row") {
  return `${prefix}_${Date.now()}_${_seq++}`;
}

export function makeBlock(type) {
  const meta = BLOCK_META[type];
  if (!meta) return { type };
  return { type, ...(meta.defaults || {}) };
}

// ── Default template from existing course data ────────────────────────────────

/**
 * Builds the initial default template from the current menuCourses.
 * Preserves section_gap_before and inserts the pairing label before danube_salmon.
 */
export function buildDefaultTemplate(menuCourses = []) {
  const sorted = [...menuCourses].sort((a, b) => (a.position || 0) - (b.position || 0));
  const rows = [];

  // Header: title left, logo right — matches current header div structure
  rows.push({
    id: "hdr",
    left:  { type: "title", text: "WINTER MENU" },
    right: { type: "logo", size: 10.5, offsetX: 0, offsetY: 0 },
  });
  rows.push({
    id: "hdr_gap",
    left:  { type: "spacer", height: 7 },
    right: null,
  });

  // Aperitif above first course (right side only — blank if none)
  rows.push({
    id: "aperitif_row",
    left:  null,
    right: { type: "aperitif" },
  });

  sorted.forEach((course, idx) => {
    const ck = course.course_key || `course_${idx}`;

    // Section gap spacer
    if (course.section_gap_before && idx > 0) {
      rows.push({
        id: makeRowId("gap"),
        left:  { type: "spacer", height: 14.5 },
        right: null,
      });
    }

    // Pairing section label before danube_salmon
    if (ck === "danube_salmon") {
      rows.push({
        id: "pairing_label_row",
        left:  null,
        right: { type: "pairing_label", text: "WINE PAIRING" },
      });
    }

    rows.push({
      id: `course_${ck}`,
      left:  { type: "course",  courseKey: ck },
      right: { type: "pairing" },
    });
  });

  // Footer
  rows.push({ id: "goodbye_row", left: { type: "goodbye", text: "Hvala za vaš obisk." }, right: null });
  rows.push({ id: "team_row",    left: { type: "team" },                                right: null });

  return { version: 2, rows };
}
