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
 * RowDef: {
 *   id: string,
 *   left: BlockDef | null,
 *   right: BlockDef | null,
 *   widthPreset?: string,   // "left/right" column widths, e.g. "55/45"
 *   gap?: number,           // extra vertical gap above this row in pt
 * }
 * BlockDef: { type: string, ...typeSpecificFields }
 */

// ── Column width presets ───────────────────────────────────────────────────────

export const WIDTH_PRESETS = ["100/0", "70/30", "55/45", "50/50", "30/70", "0/100"];

/**
 * Parse a "left/right" preset string into fractional values for CSS grid.
 * Returns { leftFr, rightFr } — suitable for minmax(0,Xfr) grid columns.
 */
export function parseWidthPreset(preset) {
  const parts = String(preset || "55/45").split("/");
  const l = Math.max(0, parseInt(parts[0], 10) || 55);
  const r = Math.max(0, parseInt(parts[1], 10) || 45);
  return { leftFr: l, rightFr: r };
}

// ── Block type metadata ───────────────────────────────────────────────────────

export const BLOCK_META = {
  // ── Content blocks — resolve live data per seat ───────────────────────────
  course: {
    label: "Course",        group: "content", color: "#4b4b88", bg: "#f0f0f8", icon: "◈",
    desc: "Dish text for a specific course — respects seat restrictions",
    fields: [
      { key: "courseKey",   label: "Course",              type: "course_select" },
      { key: "showPairing", label: "Show pairing column", type: "checkbox" },
    ],
    defaults: { courseKey: "", showPairing: true },
  },
  pairing: {
    label: "Pairing",       group: "content", color: "#c8a06e", bg: "#fdf5ec", icon: "◎",
    desc: "Drink pairing for this seat's selection (Wine / Non-Alc / OS / Premium). Falls back to by-the-glass from Danube Salmon onwards.",
    fields: [
      { key: "showByGlass", label: "Show by-the-glass fallback", type: "checkbox" },
      { key: "showBottle",  label: "Show bottle wine fallback",  type: "checkbox" },
    ],
    defaults: { showByGlass: true, showBottle: true },
  },
  pairing_label: {
    label: "Pairing Label", group: "content", color: "#c8a06e", bg: "#fdf5ec", icon: "T",
    desc: "Auto-resolves label from pairing type (Wine/Non-Alc/etc). Text field overrides only. Section spacing is preserved even when seat has no pairing.",
    fields: [
      { key: "text",      label: "Label override",    type: "text",   placeholder: "Leave empty for auto" },
      { key: "align",     label: "Alignment",          type: "select", options: ["left", "center", "right"] },
      { key: "reserveWhenNoPairing", label: "Keep reserved row when no pairing", type: "checkbox" },
      { key: "reserveHeightPt",      label: "Reserved row height (pt)",          type: "number", step: 0.5, min: 0 },
      { key: "spacing",   label: "Spacing below (pt)", type: "number", step: 0.5 },
    ],
    defaults: { text: "", align: "right", reserveWhenNoPairing: null, reserveHeightPt: null, spacing: 6 },
  },
  forced_pairing: {
    label: "Forced Pairing", group: "content", color: "#c86e6e", bg: "#fff2f2", icon: "⚑",
    desc: "Forces a specific drink pairing for this course row. Use course force_pairing fields, or override the text here.",
    fields: [
      { key: "useCourseForceFields", label: "Use course forced pairing fields first", type: "checkbox" },
      { key: "title",  label: "Title (EN)", type: "text", placeholder: "KITCHEN MARTINI" },
      { key: "sub",    label: "Sub (EN)",   type: "text", placeholder: "" },
      { key: "title_si", label: "Title (SI)", type: "text", placeholder: "" },
      { key: "sub_si",   label: "Sub (SI)",   type: "text", placeholder: "" },
    ],
    defaults: { useCourseForceFields: true, title: "", sub: "", title_si: "", sub_si: "" },
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
  // Note: spacer blocks have been replaced by gap rows (empty rows with row.gap set).
  // Any saved spacer blocks in old templates are still handled gracefully by the
  // generator (converted to pendingGap), but cannot be created from the editor.
  divider: {
    label: "Divider",       group: "layout", color: "#888", bg: "#f4f4f4", icon: "—",
    desc: "Full-width horizontal rule",
    fields: [
      { key: "thickness",    label: "Thickness (pt)",     type: "number", step: 0.25 },
      { key: "color",        label: "Color (hex)",         type: "text",   placeholder: "#cccccc" },
      { key: "marginTop",    label: "Margin top (pt)",     type: "number", step: 0.5 },
      { key: "marginBottom", label: "Margin bottom (pt)",  type: "number", step: 0.5 },
    ],
    defaults: { thickness: 0.5, color: "#cccccc", marginTop: 3, marginBottom: 3 },
  },

  // ── Static blocks — same on every menu ───────────────────────────────────
  logo: {
    label: "Logo",          group: "static", color: "#1a1a1a", bg: "#f8f8f8", icon: "▣",
    desc: "Restaurant logo image",
    fields: [
      { key: "size",    label: "Size (mm)",     type: "number", step: 0.5 },
      { key: "offsetX", label: "Offset X (mm)", type: "number", step: 0.5 },
      { key: "offsetY", label: "Offset Y (mm)", type: "number", step: 0.5 },
      { key: "align",   label: "Alignment",     type: "select", options: ["left", "center", "right"] },
    ],
    defaults: { size: 10.5, offsetX: 0, offsetY: 0, align: "right" },
  },
  title: {
    label: "Title",         group: "static", color: "#1a1a1a", bg: "#f8f8f8", icon: "T",
    desc: "Menu title text — editable",
    fields: [
      { key: "text",      label: "Title (EN)",       type: "text",     placeholder: "WINTER MENU" },
      { key: "text_si",   label: "Title (SI)",        type: "text",     placeholder: "ZIMSKI MENI" },
      { key: "fontSize",  label: "Font size (pt)",    type: "number",   step: 0.5 },
      { key: "tracking",  label: "Tracking (em)",     type: "number",   step: 0.005 },
      { key: "uppercase", label: "Uppercase",          type: "checkbox" },
      { key: "align",     label: "Alignment",          type: "select",   options: ["left", "center", "right"] },
    ],
    defaults: { text: "", text_si: "", fontSize: 13.9, tracking: 0.035, uppercase: true, align: "left" },
  },
  team: {
    label: "Team Names",    group: "static", color: "#555", bg: "#f4f4f4", icon: "◆",
    desc: "Team names — override below or leave empty to use global service settings",
    fields: [
      { key: "names",   label: "Team names",          type: "textarea", placeholder: "Leave empty for global team names" },
      { key: "align",   label: "Alignment",            type: "select",   options: ["left", "center", "right"] },
      { key: "spacing", label: "Label spacing (pt)",   type: "number",   step: 0.5 },
    ],
    defaults: { names: "", align: "left", spacing: 1.4 },
  },
  goodbye: {
    label: "Goodbye Note",  group: "static", color: "#555", bg: "#f4f4f4", icon: "◁",
    desc: "Thank-you / goodbye note — editable",
    fields: [
      { key: "text",     label: "Note (EN)",       type: "textarea", placeholder: "Thank you for your visit." },
      { key: "text_si",  label: "Note (SI)",        type: "textarea", placeholder: "Hvala za vaš obisk." },
      { key: "fontSize", label: "Font size (pt)",   type: "number",   step: 0.25 },
      { key: "align",    label: "Alignment",        type: "select",   options: ["left", "center", "right"] },
    ],
    defaults: { text: "", text_si: "", fontSize: 6.55, align: "left" },
  },
  text: {
    label: "Text",          group: "static", color: "#333", bg: "#f2f2f2", icon: "≡",
    desc: "Free text block — fully editable",
    fields: [
      { key: "text",       label: "Content",        type: "textarea", placeholder: "Enter text..." },
      { key: "bold",       label: "Bold",            type: "checkbox" },
      { key: "fontSize",   label: "Font size (pt)",  type: "number",   step: 0.25 },
      { key: "lineHeight", label: "Line height",      type: "number",   step: 0.05 },
      { key: "align",      label: "Alignment",        type: "select",   options: ["left", "center", "right"] },
    ],
    defaults: { text: "", bold: false, fontSize: null, lineHeight: null, align: "left" },
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

/** Create a new block with all default fields for its type. */
export function makeBlock(type) {
  const meta = BLOCK_META[type];
  if (!meta) return { type };
  return { type, ...(meta.defaults || {}) };
}

/** Create a new RowDef with optional cells, width preset and gap. */
export function makeRow(left = null, right = null, widthPreset = "55/45", gap = 0) {
  return { id: makeRowId("row"), left, right, widthPreset, gap };
}

// ── Default template from existing course data ────────────────────────────────

/**
 * Builds the initial default template from the current menuCourses.
 * Used for first-time setup and as an auto-migration fallback in generateMenuHTML.
 *
 * Inserts the pairing label before danube_salmon.
 */
export function buildDefaultTemplate(menuCourses = []) {
  const sorted = [...menuCourses].sort((a, b) => (a.position || 0) - (b.position || 0));
  const rows = [];
  const norm = (v) => String(v || "").trim().toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

  // Header: title left, logo right
  // Note: .menu-header-row CSS already has margin-bottom:headerSpacing mm,
  // so no separate gap spacer is needed here.
  rows.push({
    id: "hdr",
    left:  makeBlock("title"),
    right: makeBlock("logo"),
    widthPreset: "55/45",
    gap: 0,
  });

  // Aperitif row above the first course
  rows.push({
    id: "aperitif_row",
    left:  null,
    right: makeBlock("aperitif"),
    widthPreset: "55/45",
    gap: 0,
  });

  sorted.forEach((course, idx) => {
    const ck = course.course_key || `course_${idx}`;
    const nck = norm(ck);

    // Pairing section label before danube_salmon
    if (ck === "danube_salmon") {
      rows.push({
        id: "pairing_label_row",
        left:  null,
        right: makeBlock("pairing_label"),
        widthPreset: "55/45",
        gap: 0,
      });
    }

    rows.push({
      id: `course_${ck}`,
      left:  { type: "course", courseKey: ck },
      right: (nck === "crayfish" || nck === "chicken_gizzard") ? makeBlock("forced_pairing") : makeBlock("pairing"),
      widthPreset: "55/45",
      gap: 0,
    });
  });

  // Footer
  rows.push({ id: "goodbye_row", left: makeBlock("goodbye"), right: null, widthPreset: "100/0", gap: 0 });
  rows.push({ id: "team_row",    left: makeBlock("team"),    right: null, widthPreset: "100/0", gap: 0 });

  return { version: 2, rows };
}
