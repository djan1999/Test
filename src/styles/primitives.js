// ─────────────────────────────────────────────────────────────
// Milka Service Board — Shared Editorial Primitives
// Style objects only. Spread into inline styles.
// No React. No components. No logic.
//
// Visual grammar: technical editorial, STOW/rawlab-inspired.
// Warm off-white canvas · hairline rules · strong mono type
// Bracket/spec notation · muted green for live · muted clay for danger
// ─────────────────────────────────────────────────────────────

import { tokens } from "./tokens.js";

const { ink, typeScale, space, rule, font, green, red, charcoal, neutral } = tokens;

// ── Canvas / surfaces ─────────────────────────────────────────
export const surfaceCanvas = {
  background: ink.bg,         // #f8f7f5 warm off-white
  minHeight: "100vh",
};

export const surfaceCard = {
  background: neutral[0],     // pure white card on canvas
  borderTop:    `${rule.hairline} solid ${ink[4]}`,
  borderBottom: `${rule.hairline} solid ${ink[4]}`,
};

// ── Section labels — [BRACKET] notation ──────────────────────
// Usage: <span style={sectionLabel}>SERVICE READOUT</span>
// Renders as: [SERVICE READOUT] via pseudo, or wrap manually.
export const sectionLabel = {
  fontFamily:    font,
  fontSize:      "9px",
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  fontWeight:    400,
  color:         ink[3],      // #8a8a8a — muted but readable
  display:       "block",
  lineHeight:    1,
};

// Inline bracket wrapper — call as: `[${label}]`
// No separate component needed; just wrap text in brackets.

// ── Rule / divider ────────────────────────────────────────────
export const hairlineRule = {
  borderBottom: `${rule.hairline} solid ${ink[4]}`,  // #c4c4c4
};

export const hairlineRuleTop = {
  borderTop: `${rule.hairline} solid ${ink[4]}`,
};

// ── Action buttons ────────────────────────────────────────────
export const actionBtn = {
  fontFamily:    font,
  fontSize:      "9px",
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  fontWeight:    400,
  padding:       `${space[2]} ${space[3]}`,    // 8px 12px
  border:        `${rule.hairline} solid ${ink[3]}`,
  borderRadius:  0,
  cursor:        "pointer",
  background:    neutral[0],
  color:         ink[1],                       // #1a1a1a
  touchAction:   "manipulation",
  whiteSpace:    "nowrap",
  flexShrink:    0,
};

export const actionBtnStrong = {
  ...actionBtn,
  border:     `${rule.hairline} solid ${ink[0]}`,
  color:      ink[0],
  fontWeight: 500,
};

export const actionBtnActive = {
  ...actionBtn,
  border:     `${rule.hairline} solid ${charcoal.default}`,
  background: tokens.tint.parchment,
  color:      ink[0],
  fontWeight: 500,
};

export const actionBtnMobile = {
  ...actionBtn,
  fontSize:   "10px",
  padding:    `${space[3]} 14px`,              // 12px 14px
  minHeight:  44,
};

export const dangerBtn = {
  ...actionBtn,
  border:     `${rule.hairline} solid ${red.border}`,
  background: red.bg,
  color:      red.text,
};

// ── Status chips ──────────────────────────────────────────────
export const liveChip = {
  fontFamily:    font,
  fontSize:      "9px",
  letterSpacing: "0.12em",
  fontWeight:    500,
  padding:       `${space[2]} ${space[3]}`,
  border:        `${rule.hairline} solid ${green.border}`,
  borderRadius:  0,
  background:    green.bg,
  color:         green.text,
  whiteSpace:    "nowrap",
};

export const offlineChip = {
  ...liveChip,
  border:     `${rule.hairline} solid ${ink[4]}`,
  background: neutral[50],
  color:      ink[3],
};

// ── Typography ────────────────────────────────────────────────
// Table number — the dominant anchor on a ticket/card
export const tableNum = {
  fontFamily:    font,
  fontSize:      "28px",
  fontWeight:    800,
  letterSpacing: "-0.02em",
  color:         ink[0],
  lineHeight:    1,
};

export const tableNumLarge = {
  ...tableNum,
  fontSize: "40px",
};

export const tableNumSmall = {
  ...tableNum,
  fontSize: "18px",
};

// Guest name — clear, readable, not overpowering
export const guestName = {
  fontFamily: font,
  ...typeScale.value,                // 14px, no transform, weight 400
  color:      ink[0],
  lineHeight: 1.2,
};

// Meta label — small uppercase metadata (PAX, TIME, STATUS…)
export const metaLabel = {
  fontFamily: font,
  ...typeScale.label,                // 10px, uppercase, tracking 0.12em
  color:      ink[3],
};

// Meta value — the answer to a metaLabel
export const metaValue = {
  fontFamily: font,
  fontSize:   "11px",
  fontWeight: 600,
  letterSpacing: "0.04em",
  color:      ink[1],
};

// Status text — SEATED / RESERVED / ACTIVE
export const statusActive = {
  fontFamily:    font,
  fontSize:      "8px",
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  fontWeight:    500,
  color:         green.text,
};

export const statusReserved = {
  ...statusActive,
  color: ink[3],
};

export const statusMuted = {
  ...statusActive,
  color: ink[4],
};

// Restriction badge — red clay pill
export const restrictionBadge = {
  fontFamily:  font,
  fontSize:    "8px",
  fontWeight:  600,
  letterSpacing: "0.08em",
  padding:     "2px 6px",
  border:      `${rule.hairline} solid ${red.border}`,
  borderRadius: 0,
  background:  red.bg,
  color:       red.text,
  display:     "inline-block",
  lineHeight:  1.4,
};

// Seat position label — P1, P2…
export const seatPos = {
  fontFamily:  font,
  fontSize:    "9px",
  fontWeight:  700,
  letterSpacing: "0.06em",
  color:       ink[0],
  lineHeight:  1,
};

// Pairing chip — active pairing state
export const pairingActive = {
  fontFamily:  font,
  fontSize:    "9px",
  fontWeight:  500,
  letterSpacing: "0.06em",
  padding:     "3px 7px",
  border:      `${rule.hairline} solid ${green.border}`,
  borderRadius: 0,
  background:  green.bg,
  color:       green.text,
};

export const pairingInactive = {
  ...pairingActive,
  border:     `${rule.hairline} solid ${ink[4]}`,
  background: neutral[0],
  color:      ink[3],
};

// Water control chip
export const waterActive = {
  fontFamily:  font,
  fontSize:    "9px",
  fontWeight:  600,
  letterSpacing: "0.06em",
  padding:     "5px 8px",
  border:      `${rule.hairline} solid ${charcoal.default}`,
  borderRadius: 0,
  background:  tokens.tint.parchment,
  color:       ink[0],
  cursor:      "pointer",
  touchAction: "manipulation",
};

export const waterInactive = {
  ...waterActive,
  border:     `${rule.hairline} solid ${ink[4]}`,
  background: neutral[0],
  color:      ink[3],
  fontWeight: 400,
};

// ── Layout helpers ────────────────────────────────────────────
export const flexRow = {
  display:    "flex",
  alignItems: "center",
};

export const flexRowBetween = {
  display:         "flex",
  alignItems:      "center",
  justifyContent:  "space-between",
};
