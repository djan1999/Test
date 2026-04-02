/**
 * visualLayout.js — utilities for the block-based visual menu layout schema.
 *
 * Schema shape stored in service_settings (id: "visual_layout"):
 * {
 *   leftColumn:  BlockDef[],
 *   rightColumn: BlockDef[],
 * }
 *
 * BlockDef:
 * {
 *   id:        string  — unique within the layout
 *   type:      "course" | "spacer" | "divider" | "heading" | "pairing" | "byGlass" | "quickAccess"
 *   // type-specific optional fields:
 *   courseKey?: string           — for "course" blocks
 *   size?:      "xs"|"sm"|"md"|"lg"  — for "spacer" blocks
 *   text?:      string           — for "heading" / "divider" blocks
 * }
 */

// ── Block type metadata ──────────────────────────────────────────────────────

export const BLOCK_TYPES = {
  course:      { zone: "left",  label: "Course",        color: "#4b4b88", bg: "#f0f0f8", icon: "◈" },
  spacer:      { zone: "left",  label: "Spacer",         color: "#999",    bg: "#f8f8f8", icon: "▫" },
  divider:     { zone: "both",  label: "Divider",        color: "#666",    bg: "#f4f4f4", icon: "—" },
  heading:     { zone: "both",  label: "Heading",        color: "#333",    bg: "#f2f2f2", icon: "T" },
  pairing:     { zone: "right", label: "Pairing",        color: "#c8a06e", bg: "#fdf5ec", icon: "◎" },
  byGlass:     { zone: "right", label: "By the Glass",   color: "#5a9e6e", bg: "#f0f8f2", icon: "◷" },
  quickAccess: { zone: "right", label: "Quick Access",   color: "#7a6e9e", bg: "#f4f0fa", icon: "◇" },
};

export const SPACER_SIZES = {
  xs: { label: "XS — 4pt",  pt: 4  },
  sm: { label: "SM — 8pt",  pt: 8  },
  md: { label: "MD — 14pt", pt: 14 },
  lg: { label: "LG — 24pt", pt: 24 },
};

// ── ID generation ────────────────────────────────────────────────────────────

let _seq = 1;
export function makeBlockId(type = "block") {
  return `${type}_${Date.now()}_${_seq++}`;
}

// ── Default layout from existing course data ─────────────────────────────────

export function buildDefaultLayout(menuCourses = []) {
  const sorted = [...menuCourses].sort((a, b) => (a.position || 0) - (b.position || 0));

  const leftColumn = [];
  sorted.forEach(c => {
    // Preserve any existing section gap as a spacer block
    if (c.section_gap_before) {
      leftColumn.push({ id: makeBlockId("spacer"), type: "spacer", size: "md" });
    }
    leftColumn.push({
      id: makeBlockId("course"),
      type: "course",
      courseKey: c.course_key || "",
    });
  });

  return {
    leftColumn,
    rightColumn: [
      { id: "pairing_main",     type: "pairing",     text: "Wine / Pairing" },
      { id: "byglass_main",     type: "byGlass" },
      { id: "quickaccess_main", type: "quickAccess" },
    ],
  };
}

// ── Apply left-column block order → update menu_courses positions ─────────────

/**
 * Returns a new menuCourses array with position values set from the
 * left-column block order. Courses not referenced in the layout are
 * appended at the end in their original relative order.
 */
export function applyCourseOrderFromLayout(visualLayout, menuCourses) {
  if (!visualLayout?.leftColumn?.length) return menuCourses;

  const courseBlocks = visualLayout.leftColumn.filter(b => b.type === "course");
  const byKey = Object.fromEntries(menuCourses.map(c => [c.course_key, c]));
  const seen  = new Set();
  const ordered = [];

  courseBlocks.forEach(block => {
    const c = byKey[block.courseKey];
    if (c && !seen.has(block.courseKey)) {
      seen.add(block.courseKey);
      ordered.push(c);
    }
  });

  // Append any courses not referenced in the layout
  menuCourses.forEach(c => {
    if (!seen.has(c.course_key)) ordered.push(c);
  });

  return ordered.map((c, i) => ({ ...c, position: i + 1 }));
}

// ── Derive section_gap_before flags from spacer placement ────────────────────

/**
 * For each course immediately after a spacer block in the left column,
 * mark section_gap_before = true; clear it for all others.
 * Returns an updated menuCourses array.
 */
export function applySpacerGapsFromLayout(visualLayout, menuCourses) {
  if (!visualLayout?.leftColumn?.length) return menuCourses;

  const gapKeys = new Set();
  const left = visualLayout.leftColumn;

  for (let i = 1; i < left.length; i++) {
    const prev = left[i - 1];
    const cur  = left[i];
    if (prev.type === "spacer" && cur.type === "course") {
      gapKeys.add(cur.courseKey);
    }
  }

  return menuCourses.map(c => ({
    ...c,
    section_gap_before: gapKeys.has(c.course_key),
  }));
}
