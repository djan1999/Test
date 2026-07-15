import { useState } from "react";
import { useIsMobile } from "../../hooks/useIsMobile.js";
import { useModalEscape } from "../../hooks/useModalEscape.js";
import { RESTRICTIONS, restrLabel } from "../../constants/dietary.js";
import { WATER_OPTS, PAIRINGS } from "../../constants/pairings.js";
import { BEV_TYPES } from "../../constants/beverageTypes.js";
import { resolveAperitifFromQuickAccessOption } from "../../utils/quickAccessResolve.js";
import { tokens } from "../../styles/tokens.js";
import { baseInput, circleButton } from "../../styles/mixins.js";
import WaterPicker from "./WaterPicker.jsx";
import SwapPicker from "./SwapPicker.jsx";
import WineSearch from "./WineSearch.jsx";
import BeverageSearch from "./BeverageSearch.jsx";
import MoveTablePicker from "./MoveTablePicker.jsx";

const FONT = tokens.font;
const baseInp = { ...baseInput };
const circBtnSm = { ...circleButton };

// ── Detail View ───────────────────────────────────────────────────────────────
export default function Detail({ table, tables = [], optionalExtras = [], optionalPairings = [], wines = [], cocktails = [], spirits = [], beers = [], menuCourses = [], aperitifOptions = [], mode, onBack, upd, updSeat, setGuests, swapSeats, onApplySeatToAll, onClearBeverages, onClearTable, onMoveTable, reservationOnTable, mapSeatCap = null }) {
  const isMobile = useIsMobile(860);
  const seatCount = table.seats?.length || 0;
  const canApplySeatToAll = typeof onApplySeatToAll === "function" && seatCount > 1;
  const hasAnyBeverageData = (table.seats || []).some(s =>
    (s.aperitifs?.length || 0) > 0 ||
    (s.glasses?.length || 0) > 0 ||
    (s.cocktails?.length || 0) > 0 ||
    (s.spirits?.length || 0) > 0 ||
    (s.beers?.length || 0) > 0 ||
    (s.pairing && s.pairing !== "—")
  );
  const [showMoveTable, setShowMoveTable] = useState(false);
  const [copySourceOpen, setCopySourceOpen] = useState(false);
  // Per-seat drink phase: the phase chip decides whether a search pick lands
  // as an aperitif or with the menu (glasses/cocktails/…). Kept per seat —
  // one shared value made toggling P2 silently flip P1's chips too.
  const [drinkPhaseBySeat, setDrinkPhaseBySeat] = useState({});

  // ── Detail design grammar — micro labels + chip buttons shared below ──
  const microLabel = {
    fontFamily: FONT, fontSize: "8px", letterSpacing: "0.14em",
    textTransform: "uppercase", color: tokens.ink[3], fontWeight: 400,
  };
  const chipBtn = (on) => ({
    fontFamily: FONT, fontSize: 9, letterSpacing: "0.06em",
    padding: isMobile ? "9px 10px" : "5px 10px",
    border: `1px solid ${on ? tokens.charcoal.default : tokens.ink[4]}`,
    borderRadius: 0, cursor: "pointer",
    background: on ? tokens.tint.parchment : tokens.neutral[0],
    color: on ? tokens.ink[0] : tokens.ink[3],
    fontWeight: on ? 600 : 400,
    transition: "all 0.1s", touchAction: "manipulation",
  });
  // Segmented 3-state (OFF / ALCO / N/A). Green is reserved for "ordered" —
  // an active OFF renders muted, not green, so it can't be misread as a
  // confirmed order (the old view showed OFF in the same green as YES).
  const segBtn = (on, kind = "off") => ({
    fontFamily: FONT, fontSize: 8, letterSpacing: "0.06em", flex: 1,
    padding: isMobile ? "9px 6px" : "4px 6px",
    border: `1px solid ${on
      ? (kind === "alco" ? tokens.charcoal.default : kind === "nonalc" ? tokens.ink[3] : tokens.ink[4])
      : tokens.ink[5]}`,
    borderRadius: 0, cursor: "pointer",
    background: on
      ? (kind === "alco" ? tokens.tint.parchment : kind === "nonalc" ? tokens.neutral[100] : tokens.neutral[50])
      : tokens.neutral[0],
    color: on
      ? (kind === "alco" ? tokens.ink[0] : kind === "nonalc" ? tokens.ink[1] : tokens.ink[2])
      : tokens.ink[4],
    fontWeight: on ? 600 : 400,
    transition: "all 0.1s", touchAction: "manipulation",
  });
  useModalEscape(() => setShowMoveTable(false), showMoveTable);
  const canMoveTable = mode === "service" && typeof onMoveTable === "function"
    && (table.active || table.arrivedAt || table.resName || table.resTime);
  return (
    <div style={{ maxWidth: 860, margin: "0 auto", padding: isMobile ? "0 0 28px" : "0 0 40px", overflowX: "hidden" }}>
      {/* [TABLE] header bar */}
      <div style={{
        borderBottom: `1px solid ${tokens.ink[4]}`,
        padding: isMobile ? "10px 12px" : "10px 20px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        background: tokens.neutral[0], marginBottom: 0, gap: 12,
      }}>
        <button onClick={onBack} style={{
          background: "none", border: "none", cursor: "pointer",
          fontFamily: FONT, fontSize: "9px", color: tokens.ink[3],
          letterSpacing: "0.12em", padding: 0, textTransform: "uppercase",
        }}>← TABLES</button>

        {/* Table number */}
        <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
          <span style={{
            fontFamily: FONT, fontSize: isMobile ? "28px" : "36px",
            fontWeight: 700, color: tokens.ink[0], letterSpacing: "-0.02em", lineHeight: 1,
          }}>{table.displayLabel || `T${String(table.id).padStart(2, "0")}`}</span>
          {mode === "service" && (
            <span style={{
              fontFamily: FONT, fontSize: "9px", letterSpacing: "0.10em",
              color: tokens.ink[3], textTransform: "uppercase",
            }}>{table.guests} PAX</span>
          )}
        </div>

        {/* Action buttons */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {mode === "admin" && (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button onClick={() => setGuests(Math.max(1, table.guests - 1))} style={circBtnSm}>−</button>
              <span style={{ fontFamily: FONT, fontSize: 11, color: tokens.text.body, letterSpacing: 1, minWidth: 60, textAlign: "center" }}>
                {table.guests} guests
              </span>
              <button onClick={() => setGuests(Math.min(14, table.guests + 1))} style={circBtnSm}>+</button>
            </div>
          )}
          {/* Copy any seat's choices to the whole table — not just P1's
              (the host often orders last). Tap opens the source picker. */}
          {copySourceOpen && canApplySeatToAll ? (
            <div style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
              <span style={{ fontFamily: FONT, fontSize: 9, letterSpacing: "0.10em", color: tokens.ink[3], textTransform: "uppercase" }}>COPY</span>
              {table.seats.map(s => (
                <button key={s.id} onClick={() => {
                  onApplySeatToAll(table.id, s.id);
                  setCopySourceOpen(false);
                }} style={{
                  fontFamily: FONT, fontSize: 9, fontWeight: 700, letterSpacing: "0.06em",
                  padding: isMobile ? "10px 10px" : "6px 9px",
                  border: `1px solid ${tokens.ink[2]}`, borderRadius: 0, cursor: "pointer",
                  background: tokens.neutral[0], color: tokens.ink[1], touchAction: "manipulation",
                }}>P{s.id}</button>
              ))}
              <button onClick={() => setCopySourceOpen(false)} style={{
                fontFamily: FONT, fontSize: 11, padding: isMobile ? "10px 8px" : "6px 8px",
                border: "none", background: "none", color: tokens.ink[3], cursor: "pointer",
              }}>×</button>
            </div>
          ) : (
            <button
              onClick={() => canApplySeatToAll && setCopySourceOpen(true)}
              disabled={!canApplySeatToAll}
              style={{
                fontFamily: FONT, fontSize: "9px", letterSpacing: "0.10em",
                padding: isMobile ? "10px 10px" : "6px 10px",
                border: `1px solid ${tokens.ink[4]}`, borderRadius: 0,
                cursor: canApplySeatToAll ? "pointer" : "not-allowed",
                background: tokens.neutral[0], color: tokens.ink[2],
                opacity: canApplySeatToAll ? 1 : 0.4,
                textTransform: "uppercase", touchAction: "manipulation",
              }}
            >[Pn→ALL]</button>
          )}
          <button
            onClick={() => onClearBeverages && onClearBeverages(table.id)}
            disabled={!onClearBeverages || !hasAnyBeverageData}
            style={{
              fontFamily: FONT, fontSize: "9px", letterSpacing: "0.10em",
              padding: isMobile ? "10px 10px" : "6px 10px",
              border: `1px solid ${tokens.red.border}`, borderRadius: 0,
              cursor: (onClearBeverages && hasAnyBeverageData) ? "pointer" : "not-allowed",
              background: tokens.neutral[0], color: tokens.red.text,
              opacity: (onClearBeverages && hasAnyBeverageData) ? 1 : 0.4,
              textTransform: "uppercase", touchAction: "manipulation",
            }}
          >CLEAR DRINKS</button>
          {canMoveTable && (
            <button
              onClick={() => setShowMoveTable(true)}
              style={{
                fontFamily: FONT, fontSize: "9px", letterSpacing: "0.10em",
                padding: isMobile ? "10px 10px" : "6px 10px",
                border: `1px solid ${tokens.charcoal.default}`, borderRadius: 0,
                cursor: "pointer",
                background: tokens.neutral[0], color: tokens.ink[0],
                fontWeight: 600,
                textTransform: "uppercase", touchAction: "manipulation",
              }}
            >CHANGE TABLE</button>
          )}
          {mode === "service" && onClearTable && (table.active || table.arrivedAt || table.resName || table.resTime) && (
            <button
              onClick={() => onClearTable(table.id)}
              style={{
                fontFamily: FONT, fontSize: "9px", letterSpacing: "0.10em",
                padding: isMobile ? "10px 10px" : "6px 10px",
                border: `1px solid ${tokens.red.border}`, borderRadius: 0,
                cursor: "pointer",
                background: tokens.red.text, color: tokens.neutral[0],
                textTransform: "uppercase", touchAction: "manipulation",
              }}
            >CLEAR TABLE</button>
          )}
        </div>
      </div>

      {showMoveTable && (
        <MoveTablePicker
          currentTable={table}
          tables={tables}
          reservationOnTable={reservationOnTable}
          onCancel={() => setShowMoveTable(false)}
          onPick={async (toId, mode) => {
            const r = await onMoveTable(table.id, toId, mode);
            if (r?.ok) setShowMoveTable(false);
          }}
        />
      )}

      {/* [GUEST DOSSIER] strip */}
      {(table.resName || table.resTime || table.arrivedAt || table.menuType) && (
        <div style={{
          display: "flex", gap: 0, alignItems: "stretch",
          borderBottom: `1px solid ${tokens.ink[4]}`,
          background: tokens.neutral[0],
          marginBottom: 0,
          flexWrap: "wrap",
        }}>
          {/* Label */}
          <div style={{
            padding: isMobile ? "10px 12px" : "10px 20px",
            borderRight: `1px solid ${tokens.ink[4]}`,
            display: "flex", alignItems: "center",
            flexShrink: 0,
          }}>
            <span style={{
              fontFamily: FONT, fontSize: "8px", letterSpacing: "0.16em",
              textTransform: "uppercase", color: tokens.ink[3], fontWeight: 400,
            }}>[DOSSIER]</span>
          </div>
          {/* Fields */}
          <div style={{
            display: "flex", gap: 0, alignItems: "stretch", flexWrap: "wrap", flex: 1,
          }}>
            {table.resName && (
              <div style={{ padding: isMobile ? "8px 12px" : "8px 16px", borderRight: `1px solid ${tokens.ink[4]}` }}>
                <div style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "0.12em", color: tokens.ink[3], textTransform: "uppercase", marginBottom: 3 }}>NAME</div>
                <div style={{ fontFamily: FONT, fontSize: "13px", fontWeight: 500, color: tokens.ink[0], lineHeight: 1.2 }}>
                  {table.resName}
                  {table.guestType === "hotel" && (() => {
                    const rs = Array.isArray(table.rooms) && table.rooms.length ? table.rooms.filter(Boolean) : (table.room ? [table.room] : []);
                    return rs.length ? <span style={{ fontFamily: FONT, fontSize: "9px", color: tokens.ink[3], marginLeft: 8 }}>· #{rs.join(", ")}</span> : null;
                  })()}
                </div>
              </div>
            )}
            {table.resTime && (
              <div style={{ padding: isMobile ? "8px 12px" : "8px 16px", borderRight: `1px solid ${tokens.ink[4]}` }}>
                <div style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "0.12em", color: tokens.ink[3], textTransform: "uppercase", marginBottom: 3 }}>TIME</div>
                <div style={{ fontFamily: FONT, fontSize: "13px", fontWeight: 500, color: tokens.ink[0], lineHeight: 1.2 }}>{table.resTime}</div>
              </div>
            )}
            {table.menuType && (
              <div style={{ padding: isMobile ? "8px 12px" : "8px 16px", borderRight: `1px solid ${tokens.ink[4]}` }}>
                <div style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "0.12em", color: tokens.ink[3], textTransform: "uppercase", marginBottom: 3 }}>MENU</div>
                <div style={{ fontFamily: FONT, fontSize: "13px", fontWeight: 500, color: tokens.ink[0], lineHeight: 1.2, textTransform: "uppercase" }}>{table.menuType}</div>
              </div>
            )}
            {table.arrivedAt && (
              <div style={{ padding: isMobile ? "8px 12px" : "8px 16px" }}>
                <div style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "0.12em", color: tokens.ink[3], textTransform: "uppercase", marginBottom: 3 }}>ARRIVED</div>
                <div style={{ fontFamily: FONT, fontSize: "13px", fontWeight: 500, color: tokens.green.text, lineHeight: 1.2 }}>{table.arrivedAt}</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* [ALL WATER] strip */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        borderBottom: `1px solid ${tokens.ink[4]}`,
        padding: isMobile ? "8px 12px" : "8px 20px",
        background: tokens.neutral[50],
      }}>
        <span style={{
          fontFamily: FONT, fontSize: "8px", letterSpacing: "0.14em",
          color: tokens.ink[3], textTransform: "uppercase", flexShrink: 0,
        }}>[ALL WATER]</span>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {WATER_OPTS.map(opt => {
            const allMatch = table.seats.every(s => s.water === opt);
            return (
              <button key={opt} onClick={() => table.seats.forEach(s => updSeat(s.id, "water", allMatch && opt !== "—" ? "—" : opt))} style={{
                fontFamily: FONT, fontSize: "9px", letterSpacing: "0.06em",
                padding: isMobile ? "9px 9px" : "5px 9px",
                border: `1px solid ${allMatch ? tokens.charcoal.default : tokens.ink[4]}`,
                borderRadius: 0, cursor: "pointer",
                background: allMatch ? tokens.tint.parchment : tokens.neutral[0],
                color: allMatch ? tokens.ink[0] : tokens.ink[3],
                fontWeight: allMatch ? 600 : 400,
                transition: "all 0.1s", touchAction: "manipulation",
              }}>{opt}</button>
            );
          })}
        </div>
      </div>

      {/* [SEATS] section — one card per guest, matching the app's card grammar */}
      <div style={{ padding: isMobile ? "14px 12px 0" : "16px 20px 0" }}>
        <div style={{ ...microLabel, marginBottom: 10 }}>[SEATS]</div>
      {table.seats.map(seat => {
        const seatRestrictions = (table.restrictions || []).filter(r => r.pos === seat.id);
        const drinkPhase = drinkPhaseBySeat[seat.id] || "aperitif";
        const seatHasDrinks =
          (seat.aperitifs?.length || 0) > 0 || (seat.glasses?.length || 0) > 0 ||
          (seat.cocktails?.length || 0) > 0 || (seat.spirits?.length || 0) > 0 ||
          (seat.beers?.length || 0) > 0 || (seat.pairing && seat.pairing !== "—");
        // "" and "—" both mean no pairing — MenuGenerator/board write "—",
        // this view used to write "" so the "—" chip never lit up.
        const pairingCur = (seat.pairing && seat.pairing !== "—") ? seat.pairing : "—";
        return (
          <div key={seat.id} style={{
            borderTop:    `1px solid ${tokens.ink[4]}`,
            borderRight:  `1px solid ${tokens.ink[4]}`,
            borderBottom: `1px solid ${tokens.ink[4]}`,
            borderLeft:   `3px solid ${seatRestrictions.length ? tokens.red.border : seatHasDrinks ? tokens.charcoal.default : tokens.ink[4]}`,
            borderRadius: 0, marginBottom: 10,
            background: tokens.neutral[0],
          }}>
            {/* ── Header: P · Water · Pairing · Restrictions · Swap ── */}
            <div style={{
              display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
              padding: isMobile ? "10px 12px" : "10px 14px",
            }}>
              {/* P position label */}
              <div style={{
                width: 28, height: 28, borderRadius: 0,
                border: `1px solid ${seatRestrictions.length ? tokens.red.border : tokens.ink[4]}`,
                background: seatRestrictions.length ? tokens.red.bg : tokens.neutral[0],
                display: "flex", alignItems: "center", justifyContent: "center",
                fontFamily: FONT, fontSize: "9px", fontWeight: 700,
                color: seatRestrictions.length ? tokens.red.text : tokens.ink[1],
                letterSpacing: "0.06em", flexShrink: 0,
              }}>P{seat.id}</div>

              {/* Water */}
              <div style={{ width: 62, flexShrink: 0 }}>
                <WaterPicker value={seat.water} onChange={v => updSeat(seat.id, "water", v)} />
              </div>

              <div style={{ width: 1, height: 20, background: tokens.ink[5], flexShrink: 0 }} />

              {/* Pairing chips */}
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap", flex: 1, minWidth: 160 }}>
                {PAIRINGS.map(p => {
                  const on = pairingCur === p;
                  return (
                    <button key={p} onClick={() => updSeat(seat.id, "pairing", p === "—" ? "" : (on ? "" : p))}
                      style={chipBtn(on)}>{p}</button>
                  );
                })}
                {seatRestrictions.map((r, i) => (
                  <span key={i} style={{
                    fontFamily: FONT, fontSize: 9, letterSpacing: "0.04em",
                    padding: "5px 8px", borderRadius: 0, alignSelf: "center",
                    background: tokens.red.bg, border: `1px solid ${tokens.red.border}`,
                    color: tokens.red.text, whiteSpace: "nowrap",
                  }}>⚠ {restrLabel(r.note)}</span>
                ))}
              </div>

              {/* Swap */}
              {table.seats.length > 1 && (
                <div style={{ marginLeft: "auto", flexShrink: 0 }}>
                  <SwapPicker seatId={seat.id} totalSeats={table.seats.length} onSwap={t => swapSeats(seat.id, t)} />
                </div>
              )}
            </div>

            {/* ── Drinks — one entry point. The phase chip decides whether a
                search pick lands as an aperitif or with the menu. ── */}
            <div style={{
              background: tokens.neutral[50],
              borderTop: `1px solid ${tokens.ink[5]}`,
              padding: isMobile ? "10px 12px" : "10px 14px",
            }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                  <div style={microLabel}>[DRINKS]</div>
                  <div style={{ display: "flex", gap: 4 }}>
                    {[["aperitif", "APERITIF"], ["menu", "WITH MENU"]].map(([ph, label]) => (
                      <button key={ph}
                        onClick={() => setDrinkPhaseBySeat(prev => ({ ...prev, [seat.id]: ph }))}
                        style={{ ...chipBtn(drinkPhase === ph), fontSize: 8, letterSpacing: "0.10em", textTransform: "uppercase" }}
                      >{label}</button>
                    ))}
                  </div>
                </div>
                {/* Quick-add buttons — aperitif presets, always land as aperitif */}
                {aperitifOptions.length > 0 && (
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 8 }}>
                    {aperitifOptions.map(ap => {
                      const found = resolveAperitifFromQuickAccessOption(ap, { wines, cocktails, spirits, beers });
                      return (
                        <button key={ap.label} onClick={() => {
                          const item = found || { name: ap.searchKey || ap.label, notes: "", __cocktail: true };
                          updSeat(seat.id, "aperitifs", [...(seat.aperitifs || []), item]);
                        }} style={{
                          fontFamily: FONT, fontSize: 9, letterSpacing: "0.04em", padding: isMobile ? "10px 9px" : "4px 9px",
                          border: `1px solid ${tokens.ink[4]}`, borderRadius: 0, cursor: "pointer",
                          background: tokens.neutral[0], color: tokens.ink[2], transition: "all 0.1s",
                          touchAction: "manipulation",
                        }}>{ap.label}</button>
                      );
                    })}
                  </div>
                )}
                <BeverageSearch
                  wines={wines} cocktails={cocktails} spirits={spirits} beers={beers}
                  onAdd={({ type, item }) => {
                    if (drinkPhase === "aperitif") {
                      updSeat(seat.id, "aperitifs", [...(seat.aperitifs || []), item]);
                      return;
                    }
                    if (type === "wine" || type === "bottle") updSeat(seat.id, "glasses", [...(seat.glasses || []), item]);
                    if (type === "cocktail") updSeat(seat.id, "cocktails", [...(seat.cocktails || []), item]);
                    if (type === "spirit")   updSeat(seat.id, "spirits",   [...(seat.spirits   || []), item]);
                    if (type === "beer")     updSeat(seat.id, "beers",     [...(seat.beers     || []), item]);
                  }}
                />
                {/* All drink chips — the badge tells aperitif from with-menu */}
                {(() => {
                  const allBevs = [
                    ...(seat.aperitifs || []).map((x, i) => ({ key: `ap${i}`, type: "aperitif", label: x?.name || x?.producer || "?", sub: (x?.producer && x?.name) ? x.producer : (x?.notes || ""), onRemove: () => updSeat(seat.id, "aperitifs", (seat.aperitifs||[]).filter((_,idx)=>idx!==i)) })),
                    ...(seat.glasses   || []).map((x, i) => ({ key: `g${i}`,  type: x?.byGlass === false ? "bottle" : "wine", label: x?.name, sub: x?.producer, onRemove: () => updSeat(seat.id, "glasses",   (seat.glasses||[]).filter((_,idx)=>idx!==i)) })),
                    ...(seat.cocktails || []).map((x, i) => ({ key: `c${i}`,  type: "cocktail", label: x?.name, sub: x?.notes,    onRemove: () => updSeat(seat.id, "cocktails", (seat.cocktails||[]).filter((_,idx)=>idx!==i)) })),
                    ...(seat.spirits   || []).map((x, i) => ({ key: `s${i}`,  type: "spirit",   label: x?.name, sub: x?.notes,    onRemove: () => updSeat(seat.id, "spirits",   (seat.spirits||[]).filter((_,idx)=>idx!==i)) })),
                    ...(seat.beers     || []).map((x, i) => ({ key: `b${i}`,  type: "beer",     label: x?.name, sub: x?.notes,    onRemove: () => updSeat(seat.id, "beers",     (seat.beers||[]).filter((_,idx)=>idx!==i)) })),
                  ];
                  if (allBevs.length === 0) return null;
                  return (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                      {allBevs.map(bev => {
                        const ts = BEV_TYPES[bev.type];
                        return (
                          <div key={bev.key} style={{
                            display: "inline-flex", alignItems: "center", gap: 5,
                            padding: "4px 8px 4px 10px", borderRadius: 0,
                            background: ts.bg, border: `1px solid ${ts.border}`,
                          }}>
                            <span style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 0.5, color: ts.color, opacity: 0.7, textTransform: "uppercase", flexShrink: 0 }}>{ts.label}</span>
                            <span style={{ fontFamily: FONT, fontSize: 11, color: ts.color, fontWeight: 500, whiteSpace: "nowrap" }}>
                              {bev.label}{bev.sub ? ` · ${bev.sub}` : ""}
                            </span>
                            <button onClick={bev.onRemove} style={{ background: "none", border: "none", color: ts.color, cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0, opacity: 0.7, width: 28, height: 28, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0, touchAction: "manipulation" }}>×</button>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>

            {/* ── Extras + standalone pairings footer ── */}
            {(optionalExtras.length > 0 || optionalPairings.some(opt => !opt.extraKey)) && (
              <div style={{
                borderTop: `1px solid ${tokens.ink[5]}`,
                padding: isMobile ? "10px 12px" : "10px 14px",
                display: "flex", gap: isMobile ? 12 : 18, flexWrap: "wrap", alignItems: "flex-start",
              }}>
                {/* Optional extras (derived from optional_flag) */}
                {optionalExtras.map(dish => {
                  const extra = seat.extras?.[dish.key] || seat.extras?.[dish.id] || { ordered: false, pairing: dish.pairings[0] };
                  const linkedPairing = optionalPairings.find(op => op.extraKey === dish.key || op.extraKey === dish.id);
                  const lpCur = linkedPairing ? (seat.optionalPairings?.[linkedPairing.key] || {}) : null;
                  const lpMode = lpCur?.mode || null;
                  const lpActive = lpCur?.ordered ?? false;
                  const alcoOn = lpActive && lpMode === "alco";
                  const naOn = lpActive && lpMode === "nonalc";
                  const updLp = (patch) => linkedPairing && updSeat(seat.id, "optionalPairings", {
                    ...(seat.optionalPairings || {}), [linkedPairing.key]: { ...(lpCur || {}), ...patch },
                  });
                  return (
                    <div key={dish.key} style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 96 }}>
                      <div style={microLabel}>{dish.name}</div>
                      <button onClick={() => {
                        updSeat(seat.id, "extras", {
                          ...seat.extras, [dish.key]: { ...extra, ordered: !extra.ordered }
                        });
                      }} style={{
                        fontFamily: FONT, fontSize: 9, letterSpacing: "0.08em", padding: isMobile ? "10px 8px" : "5px 8px",
                        border: `1px solid ${extra.ordered ? tokens.green.border : tokens.ink[4]}`, borderRadius: 0, cursor: "pointer",
                        background: extra.ordered ? tokens.green.bg : tokens.neutral[0],
                        color: extra.ordered ? tokens.green.text : tokens.ink[3],
                        fontWeight: extra.ordered ? 600 : 400,
                        transition: "all 0.1s", touchAction: "manipulation",
                      }}>{extra.ordered ? "YES" : "NO"}</button>
                      {linkedPairing ? (
                        <div style={{ display: "flex", gap: 3, opacity: extra.ordered ? 1 : 0.35, pointerEvents: extra.ordered ? "auto" : "none" }}>
                          <button onClick={() => updLp({ ordered: false, mode: null })} style={segBtn(!lpActive, "off")}>OFF</button>
                          {linkedPairing.hasAlco && (
                            <button onClick={() => updLp({ ordered: true, mode: "alco" })} style={segBtn(alcoOn, "alco")}>ALCO</button>
                          )}
                          {linkedPairing.hasNonAlco && (
                            <button onClick={() => updLp({ ordered: true, mode: "nonalc" })} style={segBtn(naOn, "nonalc")}>N/A</button>
                          )}
                        </div>
                      ) : (
                        <select value={extra.pairing || dish.pairings[0]} disabled={!extra.ordered}
                          onChange={e => updSeat(seat.id, "extras", { ...seat.extras, [dish.key]: { ...extra, pairing: e.target.value } })}
                          style={{
                            fontFamily: FONT, fontSize: 10, padding: "4px 5px",
                            border: `1px solid ${tokens.ink[5]}`, borderRadius: 0,
                            background: tokens.neutral[0], color: tokens.ink[1], outline: "none",
                            opacity: extra.ordered ? 1 : 0.35, width: "100%",
                          }}>
                          {dish.pairings.map(p => <option key={p}>{p}</option>)}
                        </select>
                      )}
                    </div>
                  );
                })}
                {/* Standalone optional pairings (no linked extra dish) */}
                {optionalPairings.filter(opt => !opt.extraKey).map(opt => {
                  const cur = seat.optionalPairings?.[opt.key] || { ordered: opt.defaultOn !== false };
                  const active = !!cur.ordered;
                  const mode = cur.mode || null;
                  const seatPairing = String(seat.pairing || "").trim();
                  const seatIsNonAlc = seatPairing === "Non-Alc";
                  const seatSet = seatPairing && seatPairing !== "—";
                  const alcoOn = active && (mode === "alco" || (mode === null && seatSet && !seatIsNonAlc));
                  const naOn = active && (mode === "nonalc" || (mode === null && seatIsNonAlc));
                  const updOpt = (patch) => updSeat(seat.id, "optionalPairings", {
                    ...(seat.optionalPairings || {}),
                    [opt.key]: { ...cur, ...patch },
                  });
                  return (
                    <div key={opt.key} style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 96 }}>
                      <div style={microLabel}>{opt.label}</div>
                      <div style={{ display: "flex", gap: 3 }}>
                        <button onClick={() => updOpt({ ordered: false })} style={segBtn(!active, "off")}>OFF</button>
                        {opt.hasAlco && (
                          <button onClick={() => updOpt({ ordered: true, mode: "alco" })} style={segBtn(alcoOn, "alco")}>ALCO</button>
                        )}
                        {opt.hasNonAlco && (
                          <button onClick={() => updOpt({ ordered: true, mode: "nonalc" })} style={segBtn(naOn, "nonalc")}>N/A</button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      </div>

      {/* [TABLE INFO] section */}
      <div style={{
        borderTop: `1px solid ${tokens.ink[4]}`,
        padding: isMobile ? "14px 12px" : "16px 20px",
        background: tokens.neutral[50],
      }}>
        <div style={{ ...microLabel, marginBottom: 14 }}>[TABLE INFO]</div>

      {/* Table-wide fields */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 20 }}>
        <div>
          <div style={{ ...microLabel, marginBottom: 6 }}>[BOTTLES]</div>
          {(table.bottleWines || []).map((w, i) => (
            <div key={i} style={{ marginBottom: 6 }}>
              <WineSearch
                wineObj={w} wines={wines} byGlass={false} placeholder="search bottle…"
                onChange={val => {
                  const next = (table.bottleWines || []).map((b, idx) => idx === i ? val : b).filter(Boolean);
                  upd("bottleWines", next);
                }}
              />
            </div>
          ))}
          <WineSearch
            wineObj={null} wines={wines} byGlass={false} placeholder="add bottle…"
            onChange={w => { if (w) upd("bottleWines", [...(table.bottleWines || []), w]); }}
          />
        </div>
        <div>
          <div style={{ ...microLabel, marginBottom: 6 }}>[RESTRICTIONS]</div>
          {table.restrictions?.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {table.restrictions.map((r, i) => (
                <div key={i} style={{
                  display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap",
                  padding: "6px 10px", background: r.pos ? tokens.neutral[0] : tokens.red.bg,
                  border: `1px solid ${r.pos ? tokens.ink[5] : tokens.red.border}`, borderRadius: 0,
                }}>
                  <span style={{ fontFamily: FONT, fontSize: 11, color: tokens.red.text, fontWeight: 500, flex: 1, minWidth: 80 }}>
                    {restrLabel(r.note)}
                  </span>
                  <div style={{ display: "flex", gap: 3 }}>
                    {/* Seat positions cap at the assigned table's seat count in
                        the ACTIVE floor map (T9 offers 3 under Layout B, 2
                        under A); a squeezed-in extra guest still gets a chip. */}
                    {Array.from({ length: mapSeatCap != null ? Math.max(mapSeatCap, Number(table.guests) || 0) : (Number(table.guests) || 0) }, (_, idx) => {
                      const p = idx + 1; const sel = r.pos === p;
                      return (
                        <button key={p} onClick={() => upd("restrictions", table.restrictions.map((x, ii) =>
                          ii === i ? { ...x, pos: p } : x
                        ))} style={{
                          fontFamily: FONT, fontSize: 9, padding: isMobile ? "9px 8px" : "3px 6px",
                          border: `1px solid ${sel ? tokens.red.border : tokens.neutral[200]}`,
                          borderRadius: 0, cursor: "pointer", touchAction: "manipulation",
                          background: sel ? tokens.red.bg : tokens.neutral[0],
                          color: sel ? tokens.red.text : tokens.text.disabled, fontWeight: sel ? 700 : 400,
                        }}>P{p}</button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontFamily: FONT, fontSize: 11, color: tokens.ink[4] }}>none</div>
          )}
        </div>
        <div>
          <div style={{ ...microLabel, marginBottom: 6 }}>[BIRTHDAY CAKE]</div>
          {/* Editable — the old view only displayed the flag, so a birthday
              learned mid-service couldn't be recorded from this screen. */}
          <button onClick={() => upd("birthday", !table.birthday)} style={{
            fontFamily: FONT, fontSize: 9, letterSpacing: "0.08em", padding: isMobile ? "10px 14px" : "6px 14px",
            border: `1px solid ${table.birthday ? tokens.green.border : tokens.ink[4]}`, borderRadius: 0,
            cursor: "pointer", background: table.birthday ? tokens.green.bg : tokens.neutral[0],
            color: table.birthday ? tokens.green.text : tokens.ink[3],
            fontWeight: table.birthday ? 600 : 400,
            transition: "all 0.1s", touchAction: "manipulation",
          }}>{table.birthday ? "YES" : "NO"}</button>
        </div>
        <div>
          <div style={{ ...microLabel, marginBottom: 6 }}>[NOTES]</div>
          <textarea value={table.notes} onChange={e => upd("notes", e.target.value)}
            placeholder="VIP, pace, special requests…"
            style={{ ...baseInp, minHeight: 68, resize: "vertical", lineHeight: 1.5 }} />
        </div>
      </div>
      </div>

      {/* Sticky back button */}
      <div style={{
        position: "sticky", bottom: 0, left: 0, right: 0,
        padding: "10px 0 16px", marginTop: 0,
        background: `linear-gradient(to bottom, transparent, ${tokens.ink.bg} 30%)`,
      }}>
        <button onClick={onBack} style={{
          width: "100%", fontFamily: FONT, fontSize: "9px", letterSpacing: "0.12em",
          textTransform: "uppercase",
          padding: "13px", border: `1px solid ${tokens.ink[4]}`, borderRadius: 0,
          cursor: "pointer", background: tokens.neutral[0], color: tokens.ink[3],
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
        }}>← ALL TABLES</button>
      </div>
    </div>
  );
}
