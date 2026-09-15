import { useState } from "react";
import { useIsMobile, BP } from "../../hooks/useIsMobile.js";
import { tokens } from "../../styles/tokens.js";
import { restrCompact, restrLabel } from "../../constants/dietary.js";
import { PAIRINGS, waterStyle, extraPairingForSeat } from "../../constants/pairings.js";
import { kitchenSnapshot, kitchenDelta, mergeKitchenAlert } from "../../utils/kitchenAlerts.js";
import { groupDrinks, qtySuffix } from "../../utils/drinkQuantities.js";
import {
  resolveAperitifFromQuickAccessOption,
  aperitifMatchesQuickAccessOption,
} from "../../utils/quickAccessResolve.js";
import QuickBeverageSearch from "./QuickBeverageSearch.jsx";
import { POUR_MODES, POUR_MODE_LABEL, POUR_MODE_TITLE, seatPourMode, withPourMode, withPairing } from "../../utils/pourMode.js";
import {
  extraOf, linkedPairingFor, extraShareState, extraShareLabel, withExtraShareCycled,
  extraPairingState, withExtraPairingCycled, EXTRA_PAIRING_LABEL,
} from "../../utils/seatExtras.js";
import {
  digestivoVariants, digestivoCurrentState, digestivoNextState,
  cycleSeatDigestivo, digestivoEntryMatchesOption, addSeatDigestivo,
} from "../../utils/digestivo.js";

const FONT = tokens.font;

// ── Display Board ─────────────────────────────────────────────────────────────
const PC = {
  "—":         { color: tokens.text.secondary, bg: tokens.neutral[100], border: tokens.neutral[300] },
  "Wine":      { color: tokens.neutral[700],   bg: tokens.tint.parchment, border: tokens.neutral[300] },
  "Non-Alc":   { color: tokens.neutral[600],   bg: tokens.neutral[100],  border: tokens.neutral[300] },
  "Premium":   { color: tokens.neutral[700],   bg: tokens.neutral[100],  border: tokens.neutral[300] },
  "Our Story": { color: tokens.green.text,     bg: tokens.green.bg,      border: tokens.green.border },
};
// Flat color/bg maps used by Summary, Archive, and other read-only views
const PAIRING_COLOR = { Wine: tokens.neutral[700], "Non-Alc": tokens.neutral[600], Premium: tokens.neutral[700], "Our Story": tokens.green.text };
const PAIRING_BG    = { Wine: tokens.tint.parchment, "Non-Alc": tokens.neutral[100], Premium: tokens.neutral[100], "Our Story": tokens.green.bg };
const PAIRING_OPTS = [["—","—"],["Wine","W"],["Non-Alc","N/A"],["Premium","Prem"],["Our Story","Story"]];
// Quick-mode water shortcuts: still / sparkling × cold / warm.
const WATER_QUICK = ["XC", "XW", "OC", "OW"];

// Extracted as a stable module-level component to prevent React from unmounting/remounting
// cards on every DisplayBoard re-render (which caused the visual overlap animation glitch).
// onlySeatId: render just that seat's row (the floor's chair-tap quick
// access) — the seat LOGIC still sees the whole party, so share cycles and
// the Send delta stay correct.
export function DisplayBoardCard({ t, quickMode, upd, updSeat, onCardClick, onOpenDetail, onSeat, onUnseat, onAssignTerrace, optionalExtras = [], optionalPairings = [], aperitifOptions, digestivoOptions = [], wines = [], cocktails = [], spirits = [], beers = [], onlySeatId = null }) {
    const isSeated = t.active;
    // Terrace-flow decoration (derived in App, never persisted on the row):
    // 'terrace' = party outside on t._visit.terraceLabel.
    const visit = t._visit || null;
    // The badge survives seating: courses often start while the party is
    // still outside, and the runner needs the terrace table number ON the
    // board card, not from memory.
    const onTerrace = visit?.visit === "terrace";
    const allRestr = (t.restrictions || []).filter(r => r.note);
    const [assigningIdx, setAssigningIdx] = useState(null);
    const [justSent, setJustSent] = useState(false);
    const seats = t.seats || [];

    // Service → kitchen "Send" only carries what's new since this table LAST
    // SENT (kitchenSent advances at send time, not on a kitchen confirmation —
    // the confirm flow isn't part of service reality, so waiting on it made
    // every Send re-transmit the whole night's pairings and orders).
    // hasKitchenUpdate drives the button.
    const kitchenCurrent = kitchenSnapshot(seats, optionalExtras, optionalPairings, t.restrictions || [], t.kitchenCourseNotes || {});
    const hasKitchenUpdate = kitchenDelta(kitchenCurrent, t.kitchenSent || {}).length > 0;

    const unassigned = allRestr.map((r, i) => ({ ...r, _i: i })).filter(r => !r.pos);

    const assignTo = (seatId) => {
      if (assigningIdx === null || !upd) return;
      upd(t.id, "restrictions", allRestr.map((r, i) => i === assigningIdx ? { ...r, pos: seatId } : r));
      setAssigningIdx(null);
    };

    const allWaterMatch = opt => seats.length > 0 && seats.every(s => s.water === opt);

    const wBtn = (opt, active, onClick) => (
      <button key={opt} onClick={onClick} style={{
        fontFamily: FONT, fontSize: "9px", letterSpacing: "0.08em", padding: "6px 8px",
        border: `1px solid ${active ? tokens.charcoal.default : tokens.ink[4]}`,
        borderRadius: 0, cursor: "pointer", lineHeight: 1,
        background: active ? tokens.tint.parchment : tokens.neutral[0],
        color: active ? tokens.ink[0] : tokens.ink[4],
        transition: "all 0.1s", touchAction: "manipulation",
        fontWeight: active ? 600 : 400,
      }}>{opt}</button>
    );

    const accentColor = isSeated ? tokens.green.text : tokens.neutral[400];

    return (
      <div style={{
        background: tokens.neutral[0],
        borderTop:    `1px solid ${tokens.ink[4]}`,
        borderBottom: `1px solid ${tokens.ink[4]}`,
        borderLeft:   `3px solid ${isSeated ? tokens.green.border : tokens.ink[4]}`,
        borderRight:  `1px solid ${tokens.ink[4]}`,
        borderRadius: 0,
        overflow: "hidden",
        transition: "border-color 0.12s",
      }}>
        {/* Header */}
        <div
          onClick={() => onCardClick && onCardClick(t.id)}
          style={{
            padding: "10px 12px 9px",
            borderBottom: `1px solid ${tokens.ink[4]}`,
            display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8,
            cursor: onCardClick ? "pointer" : "default",
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0, flexWrap: "wrap" }}>
            {/* Table number — dominant anchor */}
            <span style={{
              fontFamily: FONT, fontSize: "22px", fontWeight: 700,
              color: tokens.ink[0], letterSpacing: "-0.02em", lineHeight: 1,
            }}>
              {t.displayGroupLabel || t.displayLabel || `T${String(t.id).padStart(2, "0")}`}
            </span>
            {t.resName && (
              <span style={{
                fontFamily: FONT, fontSize: "13px", fontWeight: 500,
                color: tokens.ink[0], lineHeight: 1.2, overflow: "hidden",
                textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 140,
              }}>
                {t.resName}
              </span>
            )}
            {t.arrivedAt
              ? <span style={{ fontFamily: FONT, fontSize: "9px", letterSpacing: "0.08em", color: tokens.green.text, fontWeight: 500 }}>arr. {t.arrivedAt}</span>
              : t.resTime
                ? <span style={{ fontFamily: FONT, fontSize: "9px", letterSpacing: "0.08em", color: tokens.ink[3] }}>{t.resTime}</span>
                : null
            }
          </div>
          <div style={{ display: "flex", gap: 4, alignItems: "center", flexShrink: 0, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <span style={{
              fontFamily: FONT, fontSize: "8px", letterSpacing: "0.12em",
              padding: "2px 7px", borderRadius: 0,
              background: isSeated ? tokens.green.bg : tokens.neutral[50],
              border: `1px solid ${isSeated ? tokens.green.border : tokens.ink[4]}`,
              color: isSeated ? tokens.green.text : tokens.ink[3], fontWeight: 500,
              textTransform: "uppercase",
            }}>{isSeated ? "SEATED" : "RESERVED"}</span>
            {onTerrace && (
              <span style={{
                fontFamily: FONT, fontSize: "8px", letterSpacing: "0.08em",
                padding: "2px 6px", borderRadius: 0,
                border: `1px solid ${tokens.ink[4]}`, color: tokens.ink[2],
                background: tokens.ink[5], fontWeight: 600, textTransform: "uppercase",
              }}>ON TERRACE{visit.terraceLabel ? ` · ${visit.terraceLabel}` : ""}</span>
            )}
            {/* Any party WITHOUT a terrace leg can open the terrace mini-map —
                seating the board table first (to start courses) must not lock
                the party out of a terrace table. */}
            {!visit && onAssignTerrace && (
              <button
                onClick={e => { e.stopPropagation(); onAssignTerrace(t.id); }}
                title="Seat this party on the terrace for opening snacks"
                style={{
                  fontFamily: FONT, fontSize: "8px", letterSpacing: "0.1em",
                  padding: "3px 8px", border: `1px solid ${tokens.ink[4]}`,
                  background: tokens.neutral[0], color: tokens.ink[2],
                  borderRadius: 0, cursor: "pointer", textTransform: "uppercase",
                  touchAction: "manipulation",
                }}
              >TERRACE →</button>
            )}
            {t.menuType && (
              <span style={{
                fontFamily: FONT, fontSize: "8px", letterSpacing: "0.08em",
                padding: "2px 6px", borderRadius: 0,
                border: `1px solid ${tokens.ink[4]}`, color: tokens.ink[3],
                textTransform: "uppercase",
              }}>{t.menuType}</span>
            )}
            {t.lang === "si" && (
              <span style={{
                fontFamily: FONT, fontSize: "8px", letterSpacing: "0.08em",
                padding: "2px 6px", borderRadius: 0,
                border: `1px solid ${tokens.ink[4]}`, color: tokens.ink[3],
                background: tokens.neutral[50], fontWeight: 600,
              }}>SI</span>
            )}
            {t.pace && (() => {
              const pc = { Slow: { color: tokens.ink[2], bg: tokens.tint.parchment, border: tokens.ink[4] }, Fast: { color: tokens.red.text, bg: tokens.red.bg, border: tokens.red.border } }[t.pace] || {};
              return <span style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "0.08em", padding: "2px 6px", borderRadius: 0, border: `1px solid ${pc.border}`, background: pc.bg, color: pc.color, fontWeight: 600, textTransform: "uppercase" }}>{t.pace}</span>;
            })()}
            {t.guestType === "hotel" && (() => {
              const rs = Array.isArray(t.rooms) && t.rooms.length ? t.rooms.filter(Boolean) : (t.room ? [t.room] : []);
              return rs.length ? <span style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "0.06em", padding: "2px 6px", borderRadius: 0, border: `1px solid ${tokens.ink[4]}`, color: tokens.ink[2], background: tokens.tint.parchment, fontWeight: 500 }}>#{rs.join(", ")}</span> : null;
            })()}
            {t.birthday && <span style={{ fontSize: 11 }}>🎂</span>}
          </div>
        </div>

        {/* Notes */}
        {t.notes && (
          <div style={{ padding: "6px 12px", borderBottom: `1px solid ${tokens.ink[4]}`, background: tokens.neutral[50] }}>
            <span style={{ fontFamily: FONT, fontSize: "10px", letterSpacing: "0.02em", color: tokens.ink[3], fontStyle: "italic" }}>{t.notes}</span>
          </div>
        )}

        {/* Unassigned restrictions */}
        {unassigned.length > 0 && (
          <div style={{ padding: "5px 14px", borderBottom: `1px solid ${tokens.neutral[100]}`, background: tokens.red.bg, display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 1, color: tokens.red.text, textTransform: "uppercase", flexShrink: 0 }}>⚠</span>
            {unassigned.map(r => (
              <span key={r._i} onClick={() => setAssigningIdx(assigningIdx === r._i ? null : r._i)} style={{
                fontFamily: FONT, fontSize: 8,
                color: assigningIdx === r._i ? tokens.text.primary : tokens.red.text,
                background: assigningIdx === r._i ? tokens.red.text : tokens.red.bg,
                border: `1px solid ${tokens.red.border}`, borderRadius: 0, padding: "1px 6px",
                fontWeight: 500, cursor: "pointer", userSelect: "none",
              }}>{restrCompact(r.note)} {assigningIdx === r._i ? "→ seat" : "→"}</span>
            ))}
          </div>
        )}

        {assigningIdx !== null && (
          <div style={{ padding: "7px 14px", borderBottom: `1px solid ${tokens.neutral[100]}`, background: tokens.red.bg, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 1, color: tokens.red.text, flexShrink: 0 }}>Assign to:</span>
            {seats.map(s => (
              <button key={s.id} onClick={() => assignTo(s.id)} style={{
                fontFamily: FONT, fontSize: 10, fontWeight: 700, padding: "4px 10px",
                border: `1px solid ${tokens.red.border}`, borderRadius: 0, cursor: "pointer",
                background: tokens.neutral[0], color: tokens.red.text,
              }}>P{s.id}</button>
            ))}
            <button onClick={() => setAssigningIdx(null)} style={{
              fontFamily: FONT, fontSize: 9, padding: "3px 8px", marginLeft: 4,
              border: `1px solid ${tokens.neutral[200]}`, borderRadius: 0, cursor: "pointer",
              background: tokens.neutral[0], color: tokens.text.disabled,
            }}>cancel</button>
          </div>
        )}

        {/* Quick mode — ALL water row */}
        {quickMode && seats.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", borderBottom: `1px solid ${tokens.ink[4]}`, background: tokens.neutral[50] }}>
            <span style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "0.14em", color: tokens.ink[4], textTransform: "uppercase", minWidth: 56 }}>[ALL]</span>
            <div style={{ display: "flex", gap: 4 }}>
              {WATER_QUICK.map(opt => {
                const active = allWaterMatch(opt);
                return wBtn(opt, active, () => seats.forEach(s => updSeat && updSeat(t.id, s.id, "water", active ? "—" : opt)));
              })}
            </div>
          </div>
        )}

        {/* Seat rows — in quick mode, show controls for reserved tables as well (pre-seat prep) */}
        {seats.length > 0 && (isSeated || quickMode) ? (
          <div style={{ display: "flex", flexDirection: "column", gap: quickMode ? 4 : 0, padding: quickMode ? "6px 8px" : "4px 0" }}>
            {seats.filter(s => onlySeatId == null || s.id === onlySeatId).map(s => {
              const ws      = waterStyle(s.water);
              const pc      = PC[s.pairing];
              const restr   = allRestr.filter(r => r.pos === s.id);
              const extras  = optionalExtras.filter(d => (s.extras?.[d.key] || s.extras?.[d.id])?.ordered);
              const hasPairing = !!(s.pairing && s.pairing !== "—");
              const pourMode = seatPourMode(s);
              const hasContent = (s.water && s.water !== "—") || hasPairing || !!pourMode || restr.length > 0
                || extras.length > 0 || (s.aperitifs || []).length > 0 || (s.digestivos || []).length > 0;

              if (quickMode) {
                // Pairing and BTG/BTB move together, so both gestures write
                // through one helper. The seats updater is the right shape for
                // a two-field write; a caller that only ever passed updSeat
                // (one field at a time) still works, because the two fields
                // land as two writes against the same functional update.
                const writeSeat = (transform) => {
                  if (upd) {
                    upd(t.id, "seats", prev => (prev || []).map(seat =>
                      seat.id === s.id ? transform(seat) : seat));
                    return;
                  }
                  if (!updSeat) return;
                  const next = transform(s);
                  if ((next.pairing ?? "") !== (s.pairing ?? "")) updSeat(t.id, s.id, "pairing", next.pairing);
                  if ((next.pourMode ?? null) !== (s.pourMode ?? null)) updSeat(t.id, s.id, "pourMode", next.pourMode);
                };
                // Choosing a real pairing clears BTG/BTB on the same chair —
                // a paired guest's wine comes from the pairing, so keeping a
                // pour mode beside it would tell the kitchen two different
                // stories about one seat. withPairing owns that rule.
                const cyclePairing = () => {
                  const cur = s.pairing || "—";
                  const idx = PAIRINGS.indexOf(cur);
                  const nx = PAIRINGS[(idx + 1) % PAIRINGS.length];
                  writeSeat(seat => withPairing(seat, nx));
                };
                // …and the mirror gesture: tapping BTG or BTB drops the
                // pairing. Same button twice turns it back off.
                const togglePour = (mode) => writeSeat(seat => withPourMode(seat, mode));
                const curPour = seatPourMode(s);
                const curPairing = s.pairing || "—";
                const pcStyle = PC[curPairing] || PC["—"];

                const qSectionLabel = (txt) => (
                  <div style={{
                    fontFamily: FONT, fontSize: "8px", letterSpacing: "0.14em",
                    color: tokens.ink[3], textTransform: "uppercase", fontWeight: 400, marginBottom: 5,
                  }}>[{txt}]</div>
                );
                const sectionBlock = (label, content) => (
                  <div style={{ padding: "6px 12px" }}>
                    {qSectionLabel(label)}
                    <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center" }}>{content}</div>
                  </div>
                );

                return (
                  <div key={s.id} style={{
                    border: `1px solid ${restr.length ? tokens.red.border : tokens.ink[4]}`,
                    borderLeft: `2px solid ${restr.length ? tokens.red.border : tokens.ink[4]}`,
                    borderRadius: 0, overflow: "hidden",
                    background: restr.length ? tokens.red.bg : tokens.neutral[0],
                  }}>
                    {/* Seat label + gender + restrictions + reorder arrows */}
                    {(() => {
                      const seatIdx = seats.findIndex(x => x.id === s.id);
                      const doSwap = (targetIdx) => {
                        if (!upd || targetIdx < 0 || targetIdx >= seats.length) return;
                        const aId = seats[seatIdx].id;
                        const bId = seats[targetIdx].id;
                        upd(t.id, "seats", prev => {
                          const ns = [...prev];
                          const aData = { ...ns[seatIdx] };
                          const bData = { ...ns[targetIdx] };
                          ns[seatIdx] = { ...bData, id: aId };
                          ns[targetIdx] = { ...aData, id: bId };
                          return ns;
                        });
                        upd(t.id, "restrictions", prev => (prev || []).map(r =>
                          r.pos === aId ? { ...r, pos: bId } : r.pos === bId ? { ...r, pos: aId } : r
                        ));
                      };
                      const arrowBtn = (label, disabled, onClick) => (
                        <button onClick={onClick} disabled={disabled} style={{
                          fontFamily: FONT, fontSize: "9px", fontWeight: 700, padding: "1px 5px",
                          border: `1px solid ${disabled ? tokens.ink[5] : tokens.ink[4]}`,
                          borderRadius: 0, cursor: disabled ? "default" : "pointer", lineHeight: 1,
                          background: tokens.neutral[0],
                          color: disabled ? tokens.ink[5] : tokens.ink[3],
                          touchAction: "manipulation",
                        }}>{label}</button>
                      );
                      return (
                        <div style={{
                          display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap",
                          padding: "6px 12px",
                          background: restr.length ? tokens.red.bg : tokens.neutral[50],
                          borderBottom: `1px solid ${tokens.ink[4]}`,
                        }}>
                          <span style={{
                            fontFamily: FONT, fontSize: "9px", fontWeight: 700,
                            letterSpacing: "0.10em", color: restr.length ? tokens.red.text : tokens.ink[1],
                          }}>P{s.id}</span>
                          {[
                            { g: "Mr", style: tokens.gender.male },
                            { g: "Mrs", style: tokens.gender.female },
                          ].map(({ g, style }) => (
                            <button key={g} onClick={() => updSeat && updSeat(t.id, s.id, "gender", s.gender === g ? null : g)} style={{
                              fontFamily: FONT, fontSize: "9px", fontWeight: 700, letterSpacing: "0.06em",
                              padding: "3px 9px",
                              border: `1px solid ${s.gender === g ? style.border : tokens.ink[4]}`,
                              borderRadius: 0, cursor: "pointer", lineHeight: 1,
                              background: s.gender === g ? style.bg : tokens.neutral[0],
                              color: s.gender === g ? style.text : tokens.ink[3],
                              touchAction: "manipulation",
                            }}>{g}</button>
                          ))}
                          {restr.map((r, i) => (
                            <span key={i} style={{
                              fontFamily: FONT, fontSize: "8px", letterSpacing: "0.06em",
                              color: tokens.red.text, fontWeight: 500,
                              border: `1px solid ${tokens.red.border}`,
                              background: tokens.red.bg, padding: "1px 5px",
                            }}>
                              {restrLabel(r.note)}
                            </span>
                          ))}
                          <div style={{ marginLeft: "auto", display: "flex", gap: 2 }}>
                            {arrowBtn("▲", seatIdx === 0, () => doSwap(seatIdx - 1))}
                            {arrowBtn("▼", seatIdx === seats.length - 1, () => doSwap(seatIdx + 1))}
                          </div>
                        </div>
                      );
                    })()}

                    {/* WATER + PAIRING — side by side */}
                    <div style={{ display: "flex", gap: 12, padding: "8px 12px 4px", alignItems: "flex-start" }}>
                      <div>
                        {qSectionLabel("Water")}
                        <div style={{ display: "flex", gap: 4 }}>
                          {WATER_QUICK.map(opt => {
                            const active = s.water === opt;
                            return wBtn(opt, active, () => updSeat && updSeat(t.id, s.id, "water", active ? "—" : opt));
                          })}
                        </div>
                      </div>
                      <div style={{ flex: 1 }}>
                        {qSectionLabel("Pairing")}
                        <div style={{ display: "flex", gap: 2, alignItems: "stretch" }}>
                          <button onClick={cyclePairing} style={{
                            fontFamily: FONT, fontSize: "10px", letterSpacing: "0.06em",
                            padding: "6px 10px", flex: 1,
                            border: `1px solid ${curPairing === "—" ? tokens.ink[4] : pcStyle.border}`,
                            borderRadius: 0, cursor: "pointer", lineHeight: 1, whiteSpace: "nowrap",
                            background: curPairing === "—" ? tokens.neutral[0] : pcStyle.bg,
                            color: curPairing === "—" ? tokens.ink[4] : pcStyle.color,
                            display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 600,
                            touchAction: "manipulation",
                          }}>
                            <span>{curPairing === "—" ? "None" : curPairing}</span>
                            <span style={{ fontSize: "8px", opacity: 0.55, fontWeight: 400 }}>→</span>
                          </button>
                          {(() => {
                            const otherSeats = seats.filter(x => x.id !== s.id);
                            if (otherSeats.length === 0) return null;
                            const curShared = s.pairingSharedWith;
                            const cycleShare = () => {
                              if (!upd) return;
                              const curIdx = otherSeats.findIndex(x => x.id === curShared);
                              const nextIdx = (curIdx + 1) % (otherSeats.length + 1);
                              const nextTarget = nextIdx < otherSeats.length ? otherSeats[nextIdx].id : null;
                              upd(t.id, "seats", prev => prev.map(seat => {
                                if (seat.id === s.id) return { ...seat, pairingSharedWith: nextTarget };
                                if (seat.id === curShared && curShared !== null) return { ...seat, pairingSharedWith: null };
                                if (seat.id === nextTarget && nextTarget !== null) return { ...seat, pairingSharedWith: s.id, pairing: s.pairing };
                                return seat;
                              }));
                            };
                            const shareActive = curShared !== null;
                            return (
                              <button onClick={cycleShare} style={{
                                fontFamily: FONT, fontSize: "10px", fontWeight: 700, padding: "6px 8px",
                                border: `1px solid ${shareActive ? tokens.neutral[500] : tokens.ink[4]}`,
                                borderRadius: 0, cursor: "pointer", lineHeight: 1,
                                background: shareActive ? tokens.tint.parchment : tokens.neutral[0],
                                color: shareActive ? tokens.neutral[700] : tokens.ink[3],
                                touchAction: "manipulation", whiteSpace: "nowrap",
                              }}>
                                {shareActive ? `½P${curShared}` : "½"}
                              </button>
                            );
                          })()}
                          {/* BTG / BTB — the drink story for a guest who is
                              NOT on a pairing, and the only way the kitchen
                              ever hears "by the glass" or "by the bottle".
                              Disabled while a pairing holds: the pairing IS
                              the answer to this question, so offering both
                              would invite a contradiction rather than a
                              choice. Clearing the pairing re-enables them. */}
                          {POUR_MODES.map(mode => {
                            const active = curPour === mode;
                            const blocked = curPairing !== "—";
                            return (
                              <button
                                key={mode}
                                onClick={() => !blocked && togglePour(mode)}
                                disabled={blocked}
                                title={blocked
                                  ? `${POUR_MODE_TITLE[mode]} — unavailable, this seat is on the ${curPairing} pairing`
                                  : POUR_MODE_TITLE[mode]}
                                aria-pressed={active}
                                style={{
                                  fontFamily: FONT, fontSize: "10px", fontWeight: 700, letterSpacing: "0.06em",
                                  padding: "6px 8px",
                                  border: `1px solid ${active ? tokens.charcoal.default : blocked ? tokens.ink[5] : tokens.ink[4]}`,
                                  borderRadius: 0, cursor: blocked ? "not-allowed" : "pointer", lineHeight: 1,
                                  background: active ? tokens.tint.parchment : tokens.neutral[0],
                                  color: active ? tokens.ink[0] : blocked ? tokens.ink[5] : tokens.ink[3],
                                  opacity: blocked ? 0.5 : 1,
                                  touchAction: "manipulation", whiteSpace: "nowrap",
                                }}>{POUR_MODE_LABEL[mode]}</button>
                            );
                          })}
                        </div>
                      </div>
                    </div>

                    {/* EXTRAS — toggleable; linked extras cycle through alco/non-alc */}
                    {(() => {
                      const visible = (optionalExtras || []).slice(0, 4);
                      if (visible.length === 0) return null;
                      // The cycles themselves live in utils/seatExtras.js, so
                      // the floor map's dock scrolls the same states in the
                      // same order — one extra, one behaviour, two surfaces.
                      return sectionBlock("Extras", visible.map(dish => {
                        const extra = extraOf(s, dish);
                        const dishOn = !!extra.ordered;
                        const linked = linkedPairingFor(dish, optionalPairings);
                        const otherSeats = seats.filter(x => x.id !== s.id);
                        const curSharedWith = extra.sharedWith ?? null;
                        const shareState = extraShareState(s, dish);
                        const cycleExtraShare = () => upd && upd(t.id, "seats",
                          prev => withExtraShareCycled(prev, s.id, dish));

                        if (linked) {
                          const cur = extraPairingState(s, dish, linked);
                          const subLabel = EXTRA_PAIRING_LABEL[cur];
                          const styleMap = {
                            off:    { border: tokens.neutral[200], bg: tokens.neutral[0],     color: tokens.text.disabled },
                            on:     { border: tokens.neutral[500], bg: tokens.tint.parchment, color: tokens.neutral[700] },
                            alco:   { border: tokens.green.border, bg: tokens.green.bg,       color: tokens.green.text },
                            nonalc: { border: tokens.green.border, bg: tokens.green.bg,       color: tokens.green.text },
                          }[cur];
                          return (
                            <div key={dish.key || dish.id} style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
                              <button onClick={() => upd && upd(t.id, "seats",
                                prev => withExtraPairingCycled(prev, s.id, dish, linked))} style={{
                                fontFamily: FONT, fontSize: 10, letterSpacing: 0.5, padding: "7px 12px",
                                border: `1px solid ${styleMap.border}`, borderRadius: 0, cursor: "pointer",
                                background: styleMap.bg, color: styleMap.color, lineHeight: 1,
                                display: "inline-flex", alignItems: "center", gap: 6, textTransform: "uppercase",
                              }}>
                                <span style={{ fontWeight: cur === "off" ? 400 : 700 }}>{String(dish.name).slice(0, 8)}</span>
                                <span style={{ fontSize: 9, opacity: 0.7, textTransform: "lowercase" }}>{subLabel}</span>
                              </button>
                              {dishOn && otherSeats.length > 0 && (
                                <button onClick={cycleExtraShare} style={{
                                  fontFamily: FONT, fontSize: 9, fontWeight: 700, padding: "7px 7px",
                                  border: `1px solid ${curSharedWith !== null ? tokens.neutral[500] : tokens.ink[4]}`,
                                  borderRadius: 0, cursor: "pointer", lineHeight: 1,
                                  background: curSharedWith !== null ? tokens.tint.parchment : tokens.neutral[0],
                                  color: curSharedWith !== null ? tokens.neutral[700] : tokens.ink[3],
                                  touchAction: "manipulation", whiteSpace: "nowrap",
                                }}>{curSharedWith !== null ? `½P${curSharedWith}` : "½"}</button>
                              )}
                            </div>
                          );
                        }

                        // Plain extra — cycles off → on → ½P{seat} per other seat → off
                        return (
                          <button key={dish.key || dish.id} onClick={cycleExtraShare} style={{
                            fontFamily: FONT, fontSize: 10, letterSpacing: 0.5, padding: "7px 12px",
                            border: `1px solid ${dishOn ? (curSharedWith !== null ? tokens.charcoal.default : tokens.neutral[500]) : tokens.neutral[200]}`,
                            borderRadius: 0, cursor: "pointer", lineHeight: 1,
                            background: dishOn ? tokens.tint.parchment : tokens.neutral[0],
                            color: dishOn ? tokens.ink[0] : tokens.text.disabled,
                            display: "inline-flex", alignItems: "center", gap: 6, textTransform: "uppercase",
                            touchAction: "manipulation",
                          }}>
                            <span style={{ fontWeight: dishOn ? 700 : 400 }}>{String(dish.name || dish.key || "").slice(0, 8)}</span>
                            <span style={{ fontSize: 9, opacity: 0.7, textTransform: "lowercase" }}>{extraShareLabel(shareState)}</span>
                          </button>
                        );
                      }));
                    })()}

                    {/* APERITIF — quick picks plus the complete live beverage catalog */}
                    {sectionBlock("Aperitif", [
                      ...(aperitifOptions || []).map(opt => {
                        const label = opt.label ?? opt;
                        const apMatch = (x) => aperitifMatchesQuickAccessOption(x, opt, { wines, cocktails, spirits, beers });
                        const active = (s.aperitifs || []).some(apMatch);
                        return (
                          <button key={label} onClick={() => {
                            if (!updSeat) return;
                            if (active) {
                              updSeat(t.id, s.id, "aperitifs", (s.aperitifs || []).filter(x => !apMatch(x)));
                            } else {
                              const found = resolveAperitifFromQuickAccessOption(opt, { wines, cocktails, spirits, beers });
                              const item = found || { name: label, notes: "", __cocktail: true };
                              updSeat(t.id, s.id, "aperitifs", [...(s.aperitifs || []), item]);
                            }
                          }} style={{
                            fontFamily: FONT, fontSize: 10, letterSpacing: 0.5, padding: "7px 12px",
                            border: `1px solid ${active ? tokens.charcoal.default : tokens.neutral[200]}`,
                            borderRadius: 0, cursor: "pointer", lineHeight: 1,
                            background: active ? tokens.tint.parchment : tokens.neutral[0],
                            color: active ? tokens.neutral[700] : tokens.text.disabled,
                            fontWeight: active ? 700 : 500,
                          }}>{label}</button>
                        );
                      }),
                      <QuickBeverageSearch
                        key="all-beverage-search"
                        wines={wines}
                        cocktails={cocktails}
                        spirits={spirits}
                        beers={beers}
                        onAdd={(item) => updSeat && updSeat(t.id, s.id, "aperitifs", [...(s.aperitifs || []), item])}
                      />,
                    ])}

                    {/* DIGESTIVO — the same gesture as the aperitif above, at
                        the other end of the menu. A pick here puts the
                        DIGESTIVO service line on the kitchen ticket, above the
                        course admin flagged. It needs no Send and raises no
                        popup: nobody has to start a plate for a coffee, so it
                        simply appears on the ticket the pass is already
                        reading. Configured in Admin → Quick Access →
                        DIGESTIVO; a restaurant that runs none sees no section
                        at all. */}
                    {(digestivoOptions || []).length > 0 && sectionBlock("Digestivo", [
                      ...(digestivoOptions || []).map(opt => {
                        const label = opt.label ?? opt;
                        const catalogs = { wines, cocktails, spirits, beers };
                        // A configured button SCROLLS its subcategories, the
                        // same gesture as the pairing button one block up:
                        // off → Espresso → Cappuccino → off. With none
                        // configured the cycle is the plain off → on → off it
                        // has always been.
                        const variants = digestivoVariants(opt);
                        const cur = digestivoCurrentState(s, opt, catalogs);
                        const next = digestivoNextState(s, opt, catalogs);
                        const active = cur !== "off";
                        const subLabel = cur === "off"
                          ? (variants.length ? variants[0] : "off")
                          : cur === "on" ? "on" : cur;
                        return (
                          <button
                            key={opt.id ?? label}
                            title={variants.length
                              ? `${label} — ${cur === "off" ? "off" : cur === "on" ? "on" : cur}; tap for ${next === "off" ? "off" : next}`
                              : label}
                            onClick={() => {
                              if (!updSeat) return;
                              const found = resolveAperitifFromQuickAccessOption(opt, catalogs);
                              const item = found || { name: label, notes: "", __cocktail: true };
                              updSeat(t.id, s.id, "digestivos", cycleSeatDigestivo(s, opt, item, catalogs));
                            }} style={{
                              fontFamily: FONT, fontSize: 10, letterSpacing: 0.5, padding: "7px 12px",
                              border: `1px solid ${active ? tokens.charcoal.default : tokens.neutral[200]}`,
                              borderRadius: 0, cursor: "pointer", lineHeight: 1,
                              background: active ? tokens.tint.parchment : tokens.neutral[0],
                              color: active ? tokens.neutral[700] : tokens.text.disabled,
                              display: "inline-flex", alignItems: "center", gap: 6,
                              touchAction: "manipulation",
                            }}>
                            <span style={{ fontWeight: active ? 700 : 500 }}>{label}</span>
                            {/* The subcategory reads under the name the way an
                                extra's mode does, with the pairing button's →
                                to say there is more behind the tap. */}
                            {variants.length > 0 && (
                              <>
                                <span style={{ fontSize: 9, opacity: active ? 0.75 : 0.55 }}>{subLabel}</span>
                                <span style={{ fontSize: 8, opacity: 0.55 }}>→</span>
                              </>
                            )}
                          </button>
                        );
                      }),
                      // The configured buttons are what the house pours every
                      // night; the rest of the catalogue is one tap behind
                      // this, so a guest asking for the bottle nobody put on a
                      // button does not need an admin trip mid-service.
                      <QuickBeverageSearch
                        key="all-beverage-digestivo-search"
                        wines={wines}
                        cocktails={cocktails}
                        spirits={spirits}
                        beers={beers}
                        ariaLabel="Search all beverages for a digestivo"
                        placeholder="find any beverage for digestivo…"
                        onAdd={(item) => updSeat && updSeat(t.id, s.id, "digestivos", addSeatDigestivo(s, item))}
                      />,
                    ])}

                    <div style={{ height: 6 }} />
                  </div>
                );
              }

              // Normal display mode
              return (
                <div key={s.id} style={{
                  display: "flex", gap: 5, alignItems: "center", flexWrap: "wrap",
                  padding: "5px 12px", borderBottom: `1px solid ${tokens.ink[5]}`,
                  background: restr.length ? tokens.red.bg : "transparent",
                }}>
                  <span style={{
                    fontFamily: FONT, fontSize: "9px", fontWeight: 700,
                    minWidth: 22, color: restr.length ? tokens.red.text : tokens.ink[2],
                    letterSpacing: "0.06em",
                  }}>P{s.id}</span>
                  {s.gender && (() => {
                    const gs = s.gender === "Mr" ? tokens.gender.male : tokens.gender.female;
                    return (
                      <span style={{
                        fontFamily: FONT, fontSize: "8px", fontWeight: 700, letterSpacing: "0.06em",
                        padding: "1px 5px", borderRadius: 0,
                        border: `1px solid ${gs.border}`, background: gs.bg, color: gs.text,
                      }}>{s.gender}</span>
                    );
                  })()}
                  {!hasContent && <span style={{ fontFamily: FONT, fontSize: "9px", color: tokens.ink[5] }}>—</span>}
                  {s.water && s.water !== "—" && (
                    <span style={{
                      fontFamily: FONT, fontSize: "9px", padding: "2px 6px", borderRadius: 0,
                      background: tokens.neutral[50], color: tokens.ink[1],
                      border: `1px solid ${tokens.ink[4]}`,
                    }}>{s.water}</span>
                  )}
                  {hasPairing && pc && (
                    <span style={{
                      fontFamily: FONT, fontSize: "9px", padding: "2px 6px", borderRadius: 0,
                      background: pc.bg, border: `1px solid ${pc.border}`,
                      color: pc.color, fontWeight: 500,
                    }}>{s.pairing}{s.pairingSharedWith ? ` ½P${s.pairingSharedWith}` : ""}</span>
                  )}
                  {/* Where the pairing chip would be, for a seat that has
                      none — the chair reads as "drinking by the glass",
                      never as silence. */}
                  {pourMode && (
                    <span title={POUR_MODE_TITLE[pourMode]} style={{
                      fontFamily: FONT, fontSize: "9px", padding: "2px 6px", borderRadius: 0,
                      background: tokens.tint.parchment, border: `1px solid ${tokens.neutral[500]}`,
                      color: tokens.neutral[700], fontWeight: 700, letterSpacing: "0.06em",
                    }}>{POUR_MODE_LABEL[pourMode]}</span>
                  )}
                  {extras.map(d => {
                    const p = extraPairingForSeat(s, d, optionalPairings);
                    const exSharedWith = (s.extras?.[d.key] || s.extras?.[d.id])?.sharedWith ?? null;
                    return (
                      <span key={d.key} style={{
                        fontFamily: FONT, fontSize: "9px", padding: "2px 6px", borderRadius: 0,
                        border: `1px solid ${tokens.green.border}`, color: tokens.green.text, background: tokens.green.bg,
                      }}>
                        {d.name}{p ? ` · ${p}` : ""}{exSharedWith !== null ? ` ½P${exSharedWith}` : ""}
                      </span>
                    );
                  })}
                  {/* Two of the same aperitif is one chip reading ×2, the same
                      count the sheet's counter writes. */}
                  {groupDrinks(s.aperitifs).map(({ key, item: ap, qty }) => {
                    const matchOpt = aperitifOptions?.find(opt => aperitifMatchesQuickAccessOption(ap, opt, { wines, cocktails, spirits, beers }));
                    const label = `${matchOpt?.label || ap.name}${qtySuffix(qty)}`;
                    return (
                      <span key={key} style={{
                        fontFamily: FONT, fontSize: "9px", padding: "2px 6px", borderRadius: 0,
                        border: `1px solid ${tokens.ink[4]}`, color: tokens.ink[2], background: tokens.tint.parchment,
                      }}>{label}</span>
                    );
                  })}
                  {/* Digestivos read like the aperitif chips but carry the
                      marker, because the pass and the floor both need to see
                      at a glance which chairs the service is still owed. */}
                  {groupDrinks(s.digestivos).map(({ key, item: dg, qty }) => {
                    // The stored name already carries the subcategory
                    // ("Coffee (Espresso)"), so it is what the chip shows —
                    // falling back to the button label would throw the
                    // guest's actual choice away.
                    const matchOpt = digestivoOptions?.find(opt => digestivoEntryMatchesOption(dg, opt, { wines, cocktails, spirits, beers }));
                    const label = `${dg.name || matchOpt?.label || ""}${qtySuffix(qty)}`;
                    return (
                      <span key={key} title="Digestivo" style={{
                        fontFamily: FONT, fontSize: "9px", padding: "2px 6px", borderRadius: 0,
                        border: `1px solid ${tokens.neutral[500]}`, color: tokens.neutral[700], background: tokens.neutral[50],
                      }}>D · {label}</span>
                    );
                  })}
                  {restr.map((r, i) => (
                    <span key={i} style={{
                      fontFamily: FONT, fontSize: "8px", padding: "1px 5px", borderRadius: 0,
                      border: `1px solid ${tokens.red.border}`, color: tokens.red.text,
                      background: tokens.red.bg, fontWeight: 500,
                    }}>⚠ {restrCompact(r.note)}</span>
                  ))}
                </div>
              );
            })}
          </div>
        ) : !isSeated ? (
          <div style={{ padding: "9px 12px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <span style={{ fontFamily: FONT, fontSize: "9px", letterSpacing: "0.06em", color: tokens.ink[3] }}>{t.guests} pax</span>
              {allRestr.map((r, i) => (
                <span key={i} style={{
                  fontFamily: FONT, fontSize: "8px", padding: "1px 5px", borderRadius: 0,
                  border: `1px solid ${tokens.red.border}`, color: tokens.red.text,
                  background: tokens.red.bg, fontWeight: 500,
                }}>⚠ {restrCompact(r.note)}</span>
              ))}
            </div>
            {onSeat && (
              <button onClick={() => onSeat(t.id)} style={{
                fontFamily: FONT, fontSize: "9px", letterSpacing: "0.10em", padding: "5px 12px",
                border: `1px solid ${tokens.green.border}`, borderRadius: 0, cursor: "pointer",
                background: tokens.green.bg, color: tokens.green.text,
                fontWeight: 500, textTransform: "uppercase", touchAction: "manipulation",
              }}>SEAT</button>
            )}
          </div>
        ) : null}
        {/* Footer must not hide behind seats.length: a seated table with NO
            seat rows (guest count never set) is exactly the state that needs
            the Unseat/Details escape hatch — gating on seats locked table
            2-3 out of Unseat mid-service (15.07). */}
        {(isSeated || quickMode) && (
          <div style={{ padding: "6px 14px", borderTop: `1px solid ${tokens.neutral[100]}`, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            {onOpenDetail && (
              <button onClick={() => onOpenDetail(t.id)} style={{
                fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "4px 12px",
                border: `1px solid ${tokens.ink[4]}`, borderRadius: 0, cursor: "pointer",
                background: tokens.neutral[0], color: tokens.ink[2], textTransform: "uppercase",
              }}>Details</button>
            )}
            {quickMode && upd && isSeated ? (() => {
              const idle = !justSent && !hasKitchenUpdate; // kitchen already has everything
              return (
              <button
                disabled={justSent || idle}
                title={idle ? "Kitchen is up to date — nothing new to send" : undefined}
                onClick={() => {
                  // Only the new/changed items since this table's LAST SEND —
                  // and advance the baseline immediately, so the next Send can
                  // never repeat what the kitchen was already shown. (It used
                  // to advance only when the kitchen confirmed the alert; with
                  // the confirm flow unused, every Send re-sent everything.)
                  const deltaSeats = kitchenDelta(kitchenCurrent, t.kitchenSent || {});
                  if (deltaSeats.length === 0) return;
                  // merge, never overwrite: an unconfirmed SET banner in the
                  // slot must survive this Send (and vice versa)
                  upd(t.id, "kitchenAlert", mergeKitchenAlert(t.kitchenAlert, {
                    timestamp: new Date().toISOString(),
                    tableName: t.resName || null,
                    seats: deltaSeats,
                    confirmed: false,
                    snapshot: kitchenCurrent,
                  }));
                  upd(t.id, "kitchenSent", kitchenCurrent);
                  // a Send to an archived ticket proves it's still live —
                  // bring it back next to its alert (Archive mis-taps)
                  if (t.kitchenArchived) upd(t.id, "kitchenArchived", false);
                  setJustSent(true);
                  setTimeout(() => setJustSent(false), 2000);
                }}
                style={{
                  fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "5px 16px",
                  border: `1px solid ${justSent ? tokens.green.border : idle ? tokens.ink[4] : tokens.charcoal.default}`, borderRadius: 0,
                  cursor: (justSent || idle) ? "default" : "pointer",
                  background: justSent ? tokens.green.bg : idle ? tokens.neutral[0] : tokens.surface.card,
                  color: justSent ? tokens.green.text : idle ? tokens.ink[3] : tokens.text.primary,
                  fontWeight: 700, textTransform: "uppercase",
                  transition: "all 0.15s ease",
                }}>{justSent ? "✓ Sent" : idle ? "✓ Up to date" : "Send"}</button>
              );
            })() : null}
            </div>
            {quickMode && !isSeated && onSeat ? (
              <button onClick={() => onSeat(t.id)} style={{
                fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "5px 14px",
                border: `1px solid ${tokens.green.border}`, borderRadius: 0, cursor: "pointer",
                background: tokens.green.bg, color: tokens.green.text, fontWeight: 600, textTransform: "uppercase",
              }}>Seat</button>
            ) : onUnseat && isSeated ? (
              <button onClick={() => onUnseat(t.id)} style={{
                fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "4px 12px",
                border: `1px solid ${tokens.neutral[300]}`, borderRadius: 0, cursor: "pointer",
                background: tokens.neutral[0], color: tokens.text.muted, textTransform: "uppercase",
              }}>Unseat</button>
            ) : null}
          </div>
        )}
      </div>
    );
}

export function DisplayBoard({ tables, sittingTimes = [], optionalExtras = [], optionalPairings = [], upd, quickTableId = null, updSeat, onCardClick, onOpenDetail, onSeat, onUnseat, onAssignTerrace, aperitifOptions = [], digestivoOptions = [], wines = [], cocktails = [], spirits = [], beers = [] }) {
  const isMobile = useIsMobile(BP.md);

  // Tables that belong to a combined booking are grouped solely by their
  // EXPLICIT tableGroup (set by the reservation form + reconcile). We used to
  // ALSO auto-merge any two tables sharing resName+resTime, but that legacy
  // fallback mis-fired after a move/swap — two tables transiently sharing a
  // name+time got stacked into a phantom "T3-10". Explicit groups now cover
  // every real combined booking, so the heuristic is gone.
  const isPrimary = t => !t.tableGroup?.length || t.id === Math.min(...t.tableGroup);
  const visible = tables.filter(t => t.active || t.resTime || t.resName).filter(isPrimary);
  // Include all times that appear on visible tables, not just the predefined
  // sittingTimes — otherwise lunch (or any non-standard) times show nothing.
  const extraTimes = [...new Set(
    visible.map(t => t.resTime).filter(t => t && !sittingTimes.includes(t))
  )].sort();
  const allTimes = [...sittingTimes, ...extraTimes];
  const rowsData = allTimes.map(time => ({
    time,
    tables: visible
      .filter(t => t.resTime === time)
      .sort((a, b) => {
        if (a.active !== b.active) return a.active ? -1 : 1;
        return (a.arrivedAt || a.resTime || "99").localeCompare(b.arrivedAt || b.resTime || "99");
      }),
  }));
  const hasAny = rowsData.some(r => r.tables.length > 0);

  return (
    <div style={{ overflowY: "auto", overflowX: "hidden", padding: isMobile ? "0 12px 40px" : "0 24px 48px" }}>
      {!hasAny && (
        <div style={{ fontFamily: FONT, fontSize: "9px", color: tokens.ink[4], textAlign: "center", marginTop: 80, letterSpacing: "0.16em", textTransform: "uppercase" }}>
          no reservations
        </div>
      )}
      {rowsData.map(({ time, tables: rowTables }) => {
        if (rowTables.length === 0) return null;
        const seatedCount = rowTables.filter(t => t.active).length;
        return (
          <div key={time} style={{ marginBottom: 28 }}>
            {/* Time section header — hairline rule + bracket label */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10, paddingTop: 20 }}>
              <span style={{
                fontFamily: FONT, fontSize: "9px", letterSpacing: "0.14em",
                color: tokens.ink[2], textTransform: "uppercase", fontWeight: 500, flexShrink: 0,
              }}>[{time}]</span>
              <div style={{ flex: 1, height: 1, background: tokens.ink[4] }} />
              <span style={{
                fontFamily: FONT, fontSize: "8px", letterSpacing: "0.10em",
                color: tokens.ink[3], textTransform: "uppercase", flexShrink: 0,
              }}>
                {seatedCount}/{rowTables.length} seated · {rowTables.reduce((a, t) => a + (t.guests || 0), 0)} pax
              </span>
            </div>
            <div style={{
              display: "grid",
              gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill, minmax(340px, 1fr))",
              gap: isMobile ? 8 : 12,
              alignItems: "start",
            }}>
              {rowTables.map(t => (
                <DisplayBoardCard
                  key={t.id}
                  t={t}
                  quickMode={quickTableId === t.id}
                  upd={upd}
                  updSeat={updSeat}
                  onCardClick={onCardClick}
                  onOpenDetail={onOpenDetail}
                  onSeat={onSeat}
                  onUnseat={onUnseat}
                  onAssignTerrace={onAssignTerrace}
                  optionalExtras={optionalExtras}
                  optionalPairings={optionalPairings}
                  aperitifOptions={aperitifOptions}
                  digestivoOptions={digestivoOptions}
                  wines={wines}
                  cocktails={cocktails}
                  spirits={spirits}
                  beers={beers}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
