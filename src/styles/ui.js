/**
 * Reusable inline-style factories — keeps surfaces, type scale, and radii consistent app-wide.
 */
import { tokens } from "./tokens.js";

const { font, fontSize, radius, colors, shadow } = tokens;

/** Sticky app bar (service header, admin top bar) */
export function appBarStyle() {
  return {
    borderBottom: `1px solid ${colors.lineSubtle}`,
    padding: "10px 12px",
    display: "flex",
    flexDirection: "column",
    gap: 10,
    background: colors.white,
    position: "sticky",
    top: 0,
    zIndex: 50,
  };
}

/** Small uppercase section label */
export function sectionLabelStyle() {
  return {
    fontFamily: font,
    fontSize: fontSize.sm,
    letterSpacing: 2,
    color: colors.gray600,
    textTransform: "uppercase",
  };
}

/** Ghost / secondary pill */
export function ghostPillStyle() {
  return {
    fontFamily: font,
    fontSize: fontSize.sm,
    letterSpacing: 2,
    padding: "6px 10px",
    border: `1px solid ${colors.line}`,
    borderRadius: radius.pill,
    cursor: "pointer",
    background: colors.white,
    color: colors.text,
  };
}

/** Primary filled pill (dark on white) */
export function primaryPillStyle() {
  return {
    fontFamily: font,
    fontSize: fontSize.sm,
    letterSpacing: 2,
    padding: "6px 12px",
    border: `1px solid ${colors.black}`,
    borderRadius: radius.pill,
    cursor: "pointer",
    background: colors.black,
    color: colors.white,
    fontWeight: 600,
  };
}

/** Wine / data sync control — `state`: null | 'syncing' | 'ok' | 'err' */
export function syncControlStyle(state) {
  const border =
    state === "ok" ? colors.gray350 : state === "err" ? colors.gray400 : colors.gray300;
  const bg =
    state === "ok" ? colors.gray100 : state === "err" ? colors.gray75 : colors.gray50;
  const fg =
    state === "ok" ? colors.gray750 : state === "err" ? colors.gray850 : colors.gray700;
  return {
    fontFamily: font,
    fontSize: fontSize.sm,
    letterSpacing: 2,
    padding: "6px 12px",
    border: `1px solid ${border}`,
    borderRadius: radius.pill,
    cursor: state === "syncing" ? "not-allowed" : "pointer",
    background: bg,
    color: fg,
    fontWeight: 600,
    whiteSpace: "nowrap",
  };
}

/** Live / connected indicator pill */
export function livePillStyle(live) {
  return {
    fontFamily: font,
    fontSize: fontSize.sm,
    letterSpacing: 2,
    padding: "6px 10px",
    border: `1px solid ${live ? colors.gray350 : colors.gray250}`,
    borderRadius: radius.pill,
    background: live ? colors.gray100 : colors.gray75,
    color: live ? colors.gray750 : colors.gray750,
    fontWeight: 600,
    whiteSpace: "nowrap",
  };
}
