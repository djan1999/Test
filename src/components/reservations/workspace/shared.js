// Shared vocabulary for the reservation workspace.
//
// Every colour comes from styles/tokens.js — no raw hex below. The design's
// grammar maps onto the token scale directly: ink[0..5] carry the ink
// hierarchy and hairlines, green/red carry state, signal.* carries gold and
// allergen alerts, tint.parchment carries the selected wash.

import { tokens } from "../../../styles/tokens.js";

export const FONT = tokens.font;

/** Uppercase chip — the workspace's primary toggle. */
export function chipStyle(on, opts = {}) {
  return {
    fontSize: opts.fs || 9,
    letterSpacing: "0.10em",
    textTransform: "uppercase",
    whiteSpace: "nowrap",
    fontWeight: on ? 600 : 400,
    padding: opts.pad || "8px 12px",
    border: `1px solid ${on ? tokens.charcoal.default : opts.warn ? tokens.signal.warn : tokens.ink[4]}`,
    background: on ? tokens.tint.parchment : tokens.neutral[0],
    color: on ? tokens.ink[1] : opts.warn ? tokens.signal.warn : tokens.ink[2],
    cursor: "pointer",
    fontFamily: FONT,
    minHeight: opts.touch ? 34 : undefined,
  };
}

export const labelStyle = {
  fontSize: 9,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: tokens.ink[3],
};

export const sectionLabel = {
  fontSize: 9,
  letterSpacing: "0.14em",
  color: tokens.ink[3],
};

export const inputStyle = {
  fontSize: 12,
  border: `1px solid ${tokens.ink[4]}`,
  padding: "8px 10px",
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
  background: tokens.neutral[0],
  color: tokens.ink[1],
  fontFamily: FONT,
  borderRadius: 0,
};

export const darkButton = {
  fontSize: 9,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  fontWeight: 600,
  padding: "8px 12px",
  minHeight: 34,
  border: `1px solid ${tokens.charcoal.default}`,
  background: tokens.charcoal.default,
  color: tokens.neutral[0],
  cursor: "pointer",
  fontFamily: FONT,
};

export const quietButton = {
  fontSize: 8,
  letterSpacing: "0.10em",
  textTransform: "uppercase",
  padding: "8px 10px",
  minHeight: 34,
  border: `1px solid ${tokens.ink[4]}`,
  background: tokens.neutral[0],
  color: tokens.ink[2],
  cursor: "pointer",
  fontFamily: FONT,
};

export const dangerButton = {
  ...quietButton,
  fontWeight: 600,
  border: `1px solid ${tokens.red.border}`,
  background: tokens.red.bg,
  color: tokens.red.text,
};

/**
 * How a status looks. Colour NEVER carries the meaning alone: every status
 * also has a square and a text label, and usually a timestamp beside it.
 */
export const STATUS_UI = {
  pending: { square: { border: tokens.ink[3] }, rule: tokens.ink[4], color: tokens.ink[3] },
  confirmed: { square: { fill: tokens.green.text }, rule: tokens.green.border, color: tokens.green.text },
  arrived: { square: { fill: tokens.signal.active }, rule: tokens.signal.active, color: tokens.signal.active },
  completed: { square: { fill: tokens.ink[3] }, rule: tokens.ink[5], color: tokens.ink[3] },
  cancelled: { square: { border: tokens.ink[4] }, rule: tokens.ink[5], color: tokens.ink[3] },
  no_show: { square: { border: tokens.signal.alert }, rule: tokens.ink[5], color: tokens.red.text },
};

export function squareStyle(square, size = 6) {
  return square.fill
    ? { width: size, height: size, background: square.fill, display: "inline-block", flexShrink: 0 }
    : { width: size - 2, height: size - 2, border: `1px solid ${square.border}`, display: "inline-block", flexShrink: 0 };
}

const DOW = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
export const MONTHS_LONG = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];
export const DOW_SHORT = DOW;

const pad = (n) => String(n).padStart(2, "0");
export const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function shiftISO(iso, days) {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return isoOf(d);
}

export function dayLabel(iso) {
  const d = new Date(`${iso}T12:00:00`);
  return `${DOW[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`;
}

export function shortDay(iso) {
  const d = new Date(`${iso}T12:00:00`);
  return `${d.getDate()} ${MON[d.getMonth()]}`;
}

export function mondayOf(iso) {
  const d = new Date(`${iso}T12:00:00`);
  return shiftISO(iso, -((d.getDay() + 6) % 7));
}

export const todayISO = () => isoOf(new Date());

/** Tables a booking occupies — a combined party holds its whole group. */
export function tablesOfBooking(booking) {
  const group = booking?.operationalData?.tableGroup;
  if (Array.isArray(group) && group.length) return group.map(String);
  return booking?.tableLabel ? [String(booking.tableLabel)] : [];
}

/** "T02", or "T08+T09" for a combined party. */
export function tableLabelOf(booking) {
  const tables = tablesOfBooking(booking);
  if (!tables.length) return "—";
  return tables.length > 1 ? tables.join("+") : tables[0];
}

/** Restrictions normalised for display; course positions are preserved. */
export function restrictionsOf(booking) {
  const list = booking?.operationalData?.restrictions;
  if (Array.isArray(list) && list.length) {
    return list.map((item) => (typeof item === "string" ? { note: item } : item));
  }
  if (Array.isArray(booking?.allergies)) {
    return booking.allergies.map((item) => (typeof item === "string" ? { note: item } : item));
  }
  return [];
}

/** "[GLUTEN] ×2" — square-bracket notation, never colour alone. */
export function restrictionFlags(booking) {
  const counts = new Map();
  restrictionsOf(booking).forEach((item) => {
    const key = String(item.note || item.key || "").trim();
    if (!key) return;
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return [...counts.entries()].map(([key, n]) => `[${key.toUpperCase()}]${n > 1 ? ` ×${n}` : ""}`);
}

export const ACTIVE_STATUSES = new Set(["pending", "confirmed", "arrived"]);
export const isActiveBooking = (booking) => ACTIVE_STATUSES.has(booking.status);

export const coversOf = (list) => list.reduce((total, booking) => total + Number(booking.pax || 0), 0);
