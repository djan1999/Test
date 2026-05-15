/**
 * kitchenTicketSchema.js — block type definitions for the kitchen ticket
 * template editor (kt_* block types).
 *
 * Kitchen ticket templates live in kitchen_flow profiles under `ticketTemplate`:
 *   { version: 1, rows: TicketRowDef[] }
 *
 * TicketRowDef: { id, left: BlockDef | null, right: null, widthPreset: "100/0", gap }
 *
 * All kt_* blocks are single-column — tickets are a linear vertical stack.
 */

import { makeRowId } from "./menuTemplateSchema.js";

export const KT_BLOCK_META = {
  kt_header: {
    label: "Ticket Header",       group: "structure",
    icon: "▤",  color: "#2a2a28", bg: "#f0f0f0",
    desc: "Table number, guest name, badges, pax count, timing",
    fields: [
      { key: "showName",          label: "Show guest name",              type: "checkbox" },
      { key: "showMenuTypeBadge", label: "Show SHORT / LONG badge",      type: "checkbox" },
      { key: "showLangBadge",     label: "Show language badge (SI / EN)", type: "checkbox" },
      { key: "showBirthday",      label: "Show birthday indicator",      type: "checkbox" },
      { key: "showRooms",         label: "Show room number",             type: "checkbox" },
      { key: "showPax",           label: "Show pax count",               type: "checkbox" },
      { key: "showTime",          label: "Show reservation time",        type: "checkbox" },
      { key: "showArrived",       label: "Show arrived time",            type: "checkbox" },
      { key: "showProgress",      label: "Show course progress (n / N)", type: "checkbox" },
    ],
    defaults: {
      showName: true, showMenuTypeBadge: true, showLangBadge: true,
      showBirthday: true, showRooms: true, showPax: true,
      showTime: true, showArrived: true, showProgress: true,
    },
  },
  kt_notes: {
    label: "Notes Banner",        group: "structure",
    icon: "≡",  color: "#8a6a3a", bg: "#f2ede3",
    desc: "Table notes — only visible when a note exists",
    fields: [],
    defaults: {},
  },
  kt_pace: {
    label: "Pace Strip",          group: "structure",
    icon: "◈",  color: "#3a6a8a", bg: "#eaf1f6",
    desc: "Slow / Fast pace selector row",
    fields: [],
    defaults: {},
  },
  kt_seats: {
    label: "Seat Assignments",    group: "structure",
    icon: "◇",  color: "#4b4b88", bg: "#f0f0f8",
    desc: "Per-seat pairing type and dietary restrictions",
    fields: [
      { key: "showPairing",      label: "Show pairing type",           type: "checkbox" },
      { key: "showRestrictions", label: "Show per-seat restrictions",   type: "checkbox" },
    ],
    defaults: { showPairing: true, showRestrictions: true },
  },
  kt_courses: {
    label: "Course List",         group: "structure",
    icon: "≡",  color: "#3a6a3a", bg: "#eaf4ea",
    desc: "All courses — order set by Course Order tab",
    fields: [
      { key: "showRestrictions", label: "Show restriction modifications", type: "checkbox" },
      { key: "showPairingAlert", label: "Show pairing alerts",            type: "checkbox" },
      { key: "showSeatNotes",    label: "Show seat / extra notes",        type: "checkbox" },
      { key: "showCourseNotes",  label: "Show kitchen course notes",      type: "checkbox" },
    ],
    defaults: {
      showRestrictions: true, showPairingAlert: true,
      showSeatNotes: true,    showCourseNotes: true,
    },
  },
  kt_unassigned: {
    label: "Unassigned Warnings", group: "structure",
    icon: "⚠",  color: "#8a3a3a", bg: "#f6ecec",
    desc: "Warning strip for restrictions not assigned to a specific seat",
    fields: [],
    defaults: {},
  },
  kt_divider: {
    label: "Divider",             group: "layout",
    icon: "—",  color: "#888",    bg: "#f4f4f4",
    desc: "Horizontal separator line",
    fields: [
      { key: "thickness",    label: "Thickness (px)",     type: "number", step: 0.25, min: 0.25 },
      { key: "color",        label: "Color (hex)",          type: "text",   placeholder: "#c4c4c4" },
      { key: "marginTop",    label: "Margin top (px)",      type: "number", step: 1, min: 0 },
      { key: "marginBottom", label: "Margin bottom (px)",   type: "number", step: 1, min: 0 },
    ],
    defaults: { thickness: 1, color: "#c4c4c4", marginTop: 0, marginBottom: 0 },
  },
  kt_text: {
    label: "Text Block",          group: "layout",
    icon: "T",  color: "#333",    bg: "#f2f2f2",
    desc: "Static text printed on every ticket",
    fields: [
      { key: "text",     label: "Content",        type: "textarea", placeholder: "Enter text…" },
      { key: "fontSize", label: "Font size (px)",  type: "number",   step: 1, min: 6 },
      { key: "bold",     label: "Bold",             type: "checkbox" },
      { key: "align",    label: "Alignment",        type: "select",   options: ["left", "center", "right"] },
      { key: "padding",  label: "Padding V (px)",   type: "number",   step: 1, min: 0 },
    ],
    defaults: { text: "", fontSize: 9, bold: false, align: "left", padding: 5 },
  },
};

export const KT_BLOCK_GROUPS = [
  { id: "structure", label: "Structure", desc: "Ticket content sections" },
  { id: "layout",    label: "Layout",    desc: "Separators and free text" },
];

export function makeKtBlock(type) {
  const meta = KT_BLOCK_META[type];
  if (!meta) return { type };
  return { type, ...(meta.defaults || {}) };
}

export function makeKtRow(left = null) {
  return { id: makeRowId("kt"), left, right: null, widthPreset: "100/0", gap: 0 };
}

export function buildDefaultTicketTemplate() {
  return {
    version: 1,
    rows: [
      { id: "kt_hdr_r",   left: makeKtBlock("kt_header"),    right: null, widthPreset: "100/0", gap: 0 },
      { id: "kt_nts_r",   left: makeKtBlock("kt_notes"),     right: null, widthPreset: "100/0", gap: 0 },
      { id: "kt_pac_r",   left: makeKtBlock("kt_pace"),      right: null, widthPreset: "100/0", gap: 0 },
      { id: "kt_sts_r",   left: makeKtBlock("kt_seats"),     right: null, widthPreset: "100/0", gap: 0 },
      { id: "kt_crs_r",   left: makeKtBlock("kt_courses"),   right: null, widthPreset: "100/0", gap: 0 },
    ],
  };
}
