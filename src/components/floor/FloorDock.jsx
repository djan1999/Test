import { tokens } from "../../styles/tokens.js";
import { getVisibleCoursesForTable, getCourseProgressState } from "../../utils/courseProgress.js";
import { kitchenSnapshot, kitchenDelta, mergeKitchenAlert } from "../../utils/kitchenAlerts.js";
import { restrictionCode } from "./FloorMap.jsx";

const FONT = tokens.font;

// FloorDock — the FOH floor's quick-access panel. Sits in the gutter beside
// the map (below it on mobile) and follows the LAST TAPPED table on either
// floor (dining + terrace): course NOW/NEXT, the full course list, seats with
// waters/pairings/restrictions, extras input (cheese, beetroot…) with its own
// delta Send, and the SET actions. The map tap itself keeps its meaning —
// dining tables still toggle SET, terrace tables still open their sheet — the
// dock only mirrors and extends what the tap touched.
//
// Data discipline (the floor must never disagree with the board/kitchen):
// courses derive through getVisibleCoursesForTable/getCourseProgressState with
// the same {profiles, assignments} the board uses; the caller resolves the
// board table through its merge-primary helpers; extras Send goes through the
// exact snapshot/delta/mergeKitchenAlert path the board card uses.

const lbl = {
  fontFamily: FONT, fontSize: 8, letterSpacing: "0.16em",
  textTransform: "uppercase", color: tokens.ink[3],
};

const actionBtn = (primary, disabled) => ({
  fontFamily: FONT, fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase",
  padding: "10px 12px", borderRadius: 0, touchAction: "manipulation",
  border: `1px solid ${disabled ? tokens.ink[4] : primary ? tokens.ink[0] : tokens.ink[4]}`,
  background: disabled ? tokens.neutral[0] : primary ? tokens.ink[0] : tokens.neutral[0],
  color: disabled ? tokens.ink[4] : primary ? tokens.neutral[0] : tokens.ink[2],
  fontWeight: primary && !disabled ? 600 : 400,
  cursor: disabled ? "default" : "pointer",
});

const square = (state) => ({
  width: 8, height: 8, flexShrink: 0, boxSizing: "border-box",
  background: state === "done" ? tokens.signal.done
    : state === "now" ? tokens.signal.active : tokens.neutral[0],
  border: state === "todo" ? `1px solid ${tokens.ink[4]}` : "none",
});

export default function FloorDock({
  label = null,             // tapped map label; null → placeholder
  mapKind = "dining",       // 'dining' | 'terrace'
  boardTable = null,        // resolved to the merge-primary board table
  restrictions = null,      // caller-resolved restriction list (terrace falls
                            // back to the reservation blob); null → bt's own
  strip = null,             // this map/label's floor status ('SET' | null)
  menuCourses = [],
  profiles = [],
  assignments = {},
  optionalExtras = [],
  optionalPairings = [],
  onToggleStrip,            // () => flip this label's SET strip
  onAnnounce,               // () => SET → KITCHEN for this board table (may be undefined)
  onOpenDetail,             // (boardId) => raise the board's table sheet
  upd,                      // (boardId, field, value|updater) — extras + alert writes
  isMobile = false,
}) {
  const bt = boardTable;
  const live = !!bt?.active || (mapKind === "terrace" && !!bt);

  const box = (children) => (
    <div style={{ width: isMobile ? "100%" : 300, flexShrink: 0 }}>
      <div style={{ ...lbl, marginBottom: 6 }}>[TABLE DOCK]</div>
      <div style={{ background: tokens.neutral[0], border: `1px solid ${tokens.ink[4]}` }}>
        {children}
      </div>
    </div>
  );

  if (!label) {
    return box(
      <div style={{ fontFamily: FONT, fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: tokens.ink[3], padding: "18px 14px" }}>
        TAP A TABLE — ITS COURSES, SEATS AND EXTRAS SHOW HERE
      </div>,
    );
  }

  // ── derivations — same functions, same inputs as the board/kitchen ────────
  const visible = live ? getVisibleCoursesForTable(bt, menuCourses, { profiles, assignments }) : [];
  const progress = getCourseProgressState(bt || {}, visible);
  const { current, nextFire, allComplete, firedCount, total } = progress;
  const announced = nextFire != null && bt?.courseReady?.key === nextFire.key;

  const seats = [...(bt?.seats || [])].sort((a, b) => Number(a.id) - Number(b.id));
  const restr = restrictions ?? (bt?.restrictions || []);
  const restrOf = (seatId) =>
    restr.filter((r) => Number(r.pos) === Number(seatId) && r.note);

  const kitchenCurrent = live ? kitchenSnapshot(bt.seats || [], optionalExtras, optionalPairings) : {};
  const deltaSeats = live ? kitchenDelta(kitchenCurrent, bt.kitchenSent || {}) : [];
  const upToDate = deltaSeats.length === 0;
  const extrasVisible = (optionalExtras || []).slice(0, 4);

  const sendOrder = () => {
    if (!upd || !bt || upToDate) return;
    // merge, never overwrite: an unconfirmed SET banner must survive this Send
    upd(bt.id, "kitchenAlert", mergeKitchenAlert(bt.kitchenAlert, {
      timestamp: new Date().toISOString(),
      tableName: bt.resName || null,
      seats: deltaSeats,
      confirmed: false,
      snapshot: kitchenCurrent,
    }));
    upd(bt.id, "kitchenSent", kitchenCurrent);
    if (bt.kitchenArchived) upd(bt.id, "kitchenArchived", false);
  };

  // Toggle one seat's extra on/off. Mirrors the board card's off-transition:
  // turning OFF also releases a share partner pointing at this seat. Pairing
  // mode and share linking stay on the board card — the dock is the quick
  // "P2 wants cheese" gesture, not the full editor.
  const toggleExtra = (dish, seat) => {
    if (!upd || !bt) return;
    const cur = seat.extras?.[dish.key] || seat.extras?.[dish.id]
      || { ordered: false, pairing: dish.pairings?.[0] || "—" };
    const next = !cur.ordered;
    upd(bt.id, "seats", (prev) => (prev || []).map((s) => {
      if (s.id === seat.id) {
        return { ...s, extras: { ...s.extras, [dish.key]: { ...cur, ordered: next, sharedWith: next ? cur.sharedWith ?? null : null } } };
      }
      const pex = s.extras?.[dish.key];
      if (!next && pex?.sharedWith === seat.id) {
        return { ...s, extras: { ...s.extras, [dish.key]: { ...pex, ordered: false, sharedWith: null } } };
      }
      return s;
    }));
  };

  const status = strip === "SET" ? "SET"
    : announced ? "ANNOUNCED"
    : bt?.active ? "SEATED"
    : mapKind === "terrace" && bt ? "TERRACE"
    : bt?.resName || bt?.resTime ? "RESERVED" : "FREE";
  const statusTone = status === "SET" || status === "SEATED" ? tokens.green.strong
    : status === "ANNOUNCED" ? tokens.signal.warn : tokens.ink[3];

  const row = { display: "flex", alignItems: "baseline", gap: 8, padding: "3px 0" };
  const courseTime = (c) => (c?.firedAt ? String(c.firedAt) : "");

  return box(
    <>
      {/* header */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "12px 14px", borderBottom: `1px solid ${tokens.ink[4]}` }}>
        <span style={{ fontFamily: FONT, fontSize: 16, fontWeight: 700, letterSpacing: "0.08em", color: tokens.ink[0] }}>{label}</span>
        <span style={{
          fontFamily: FONT, fontSize: 8, fontWeight: 700, letterSpacing: "0.12em",
          textTransform: "uppercase", color: statusTone,
          border: `1px solid ${status === "SET" || status === "SEATED" ? tokens.green.border : status === "ANNOUNCED" ? tokens.signal.warn : tokens.ink[4]}`,
          padding: "3px 8px",
        }}>{status}</span>
        <span style={{ flex: 1 }} />
        {bt?.guests ? (
          <span style={{ fontFamily: FONT, fontSize: 9, letterSpacing: "0.10em", textTransform: "uppercase", color: tokens.ink[3] }}>×{bt.guests}</span>
        ) : null}
      </div>

      {!live ? (
        <div>
          <div style={{ fontFamily: FONT, fontSize: 9, letterSpacing: "0.10em", textTransform: "uppercase", color: tokens.ink[3], padding: "14px" }}>
            {mapKind === "terrace" ? "NO PARTY ON THIS TABLE" : "NOT SEATED — THE BOARD SEATS TABLES"}
          </div>
          {/* the hands-call strip works on empty tables too (table dressed /
              ready), and a leftover terrace strip must stay un-settable */}
          {onToggleStrip && (mapKind === "dining" || strip === "SET") && (
            <div style={{ padding: "0 14px 12px" }}>
              <button onClick={() => onToggleStrip()} style={{ ...actionBtn(false, false), display: "block", width: "100%", textAlign: "center", fontWeight: 700 }}>
                {strip === "SET" ? "UNSET" : "SET"}
              </button>
            </div>
          )}
        </div>
      ) : (
        <>
          {/* course readout */}
          <div style={{ padding: "12px 14px", borderBottom: `1px solid ${tokens.ink[5]}` }}>
            <div style={{ ...lbl, marginBottom: 8 }}>
              [COURSE{total ? ` · C${firedCount}/${total}` : ""}]
            </div>
            {total > 0 && (
              <div style={{ display: "flex", gap: 3, marginBottom: 10, flexWrap: "wrap" }}>
                {visible.map((c) => (
                  <span key={c.key} style={square(c.firedAt ? (current && c.key === current.key ? "now" : "done") : "todo")} />
                ))}
              </div>
            )}
            <div style={row}>
              <span style={{ ...lbl, letterSpacing: "0.12em", color: tokens.signal.active, fontWeight: 600, minWidth: 32 }}>NOW</span>
              {current ? (
                <>
                  <span style={{ fontFamily: FONT, fontSize: 12, fontWeight: 500, color: tokens.ink[0], textTransform: "uppercase" }}>
                    C{String(current.index).padStart(2, "0")} / {current.name}
                  </span>
                  <span style={{ flex: 1 }} />
                  <span style={{ fontFamily: FONT, fontSize: 8, letterSpacing: "0.08em", color: tokens.ink[3] }}>{courseTime(current)}</span>
                </>
              ) : (
                <span style={{ fontFamily: FONT, fontSize: 10, color: tokens.ink[3], textTransform: "uppercase" }}>nothing fired yet</span>
              )}
            </div>
            <div style={row}>
              <span style={{ ...lbl, letterSpacing: "0.12em", minWidth: 32 }}>NEXT</span>
              {allComplete ? (
                <span style={{ fontFamily: FONT, fontSize: 10, color: tokens.ink[3], textTransform: "uppercase" }}>menu complete</span>
              ) : nextFire ? (
                <>
                  <span style={{ fontFamily: FONT, fontSize: 12, color: tokens.ink[1], textTransform: "uppercase" }}>
                    C{String(nextFire.index).padStart(2, "0")} / {nextFire.name}
                  </span>
                  <span style={{ flex: 1 }} />
                  {announced ? (
                    <span style={{ fontFamily: FONT, fontSize: 8, fontWeight: 700, letterSpacing: "0.08em", color: tokens.signal.warn }}>ANNOUNCED ✓</span>
                  ) : strip === "SET" ? (
                    <span style={{ fontFamily: FONT, fontSize: 8, fontWeight: 700, letterSpacing: "0.08em", color: tokens.green.text }}>SET ✓</span>
                  ) : null}
                </>
              ) : (
                <span style={{ fontFamily: FONT, fontSize: 10, color: tokens.ink[3] }}>—</span>
              )}
            </div>
          </div>

          {/* full course list */}
          {visible.length > 0 && (
            <div style={{ padding: "10px 14px", borderBottom: `1px solid ${tokens.ink[5]}`, maxHeight: 168, overflowY: "auto" }}>
              {visible.map((c) => {
                const isNow = current && c.key === current.key;
                const isNext = nextFire && c.key === nextFire.key;
                return (
                  <div key={c.key} style={{ display: "flex", gap: 8, alignItems: "center", padding: "2px 0" }}>
                    <span style={{ ...square(c.firedAt ? (isNow ? "now" : "done") : "todo"), width: 6, height: 6 }} />
                    <span style={{ fontFamily: FONT, fontSize: 9, color: isNow ? tokens.ink[0] : tokens.ink[3], fontWeight: isNow ? 700 : 400, minWidth: 26 }}>
                      C{String(c.index).padStart(2, "0")}
                    </span>
                    <span style={{ fontFamily: FONT, fontSize: 9, color: isNow ? tokens.ink[0] : c.firedAt ? tokens.ink[3] : tokens.ink[2], fontWeight: isNow ? 700 : 400, flex: 1, textTransform: "uppercase", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {c.name}
                    </span>
                    <span style={{ fontFamily: FONT, fontSize: 8, color: isNext && announced ? tokens.signal.warn : isNext && strip === "SET" ? tokens.green.text : tokens.ink[3], fontWeight: isNext ? 700 : 400 }}>
                      {c.firedAt ? courseTime(c) : isNext && announced ? "ANN" : isNext && strip === "SET" ? "SET" : ""}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {/* seats */}
          {seats.length > 0 && (
            <div style={{ padding: "10px 14px", borderBottom: `1px solid ${tokens.ink[5]}` }}>
              <div style={{ ...lbl, marginBottom: 6 }}>[SEATS]</div>
              {seats.map((s, i) => {
                const rs = restrOf(s.id);
                const water = s.water && s.water !== "—" ? String(s.water).toUpperCase() : "—";
                const pairing = s.pairing && s.pairing !== "—" ? String(s.pairing).toUpperCase() : "—";
                return (
                  <div key={s.id} style={{ display: "flex", gap: 12, alignItems: "baseline", padding: "3px 0", borderBottom: i < seats.length - 1 ? `1px solid ${tokens.ink[5]}` : "none" }}>
                    <span style={{ fontFamily: FONT, fontSize: 10, fontWeight: 700, color: tokens.ink[0], minWidth: 22 }}>P{s.id}</span>
                    <span style={{ fontFamily: FONT, fontSize: 9, color: water === "—" ? tokens.ink[4] : tokens.ink[1], minWidth: 40 }}>{water}</span>
                    <span style={{ fontFamily: FONT, fontSize: 9, color: pairing === "—" ? tokens.ink[4] : tokens.ink[1], flex: 1 }}>{pairing}</span>
                    {rs.map((r, k) => (
                      <span key={k} style={{ fontFamily: FONT, fontSize: 9, fontWeight: 700, color: tokens.signal.alert }}>
                        [{restrictionCode(r.note)}]
                      </span>
                    ))}
                  </div>
                );
              })}
            </div>
          )}

          {/* restrictions with no seat rows to ride (party not templated onto
              board seats yet) still must reach the runner */}
          {seats.length === 0 && restr.some((r) => r.note) && (
            <div style={{ padding: "10px 14px", borderBottom: `1px solid ${tokens.ink[5]}` }}>
              <div style={{ ...lbl, marginBottom: 6 }}>[RESTRICTIONS]</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {restr.filter((r) => r.note).map((r, k) => (
                  <span key={k} style={{ fontFamily: FONT, fontSize: 9, fontWeight: 700, color: tokens.signal.alert }}>
                    {r.pos != null ? `P${r.pos} ` : ""}[{restrictionCode(r.note)}]
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* extras — the quick cheese/beetroot gesture + its own Send */}
          {extrasVisible.length > 0 && seats.length > 0 && upd && (
            <div style={{ padding: "10px 14px", borderBottom: `1px solid ${tokens.ink[5]}` }}>
              <div style={{ ...lbl, marginBottom: 6 }}>[EXTRAS]</div>
              {extrasVisible.map((dish) => (
                <div key={dish.key || dish.id} style={{ display: "flex", gap: 6, alignItems: "center", padding: "3px 0", flexWrap: "wrap" }}>
                  <span style={{ fontFamily: FONT, fontSize: 9, textTransform: "uppercase", color: tokens.ink[2], minWidth: 64, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {dish.name}
                  </span>
                  {seats.map((s) => {
                    const on = !!(s.extras?.[dish.key] || s.extras?.[dish.id])?.ordered;
                    return (
                      <button
                        key={s.id}
                        onClick={() => toggleExtra(dish, s)}
                        style={{
                          fontFamily: FONT, fontSize: 9, fontWeight: on ? 700 : 400,
                          padding: "5px 8px", borderRadius: 0, cursor: "pointer", lineHeight: 1,
                          border: `1px solid ${on ? tokens.neutral[500] : tokens.ink[4]}`,
                          background: on ? tokens.tint.parchment : tokens.neutral[0],
                          color: on ? tokens.neutral[700] : tokens.ink[3],
                          touchAction: "manipulation",
                        }}
                      >P{s.id}</button>
                    );
                  })}
                </div>
              ))}
              <button
                disabled={upToDate}
                onClick={sendOrder}
                style={{ ...actionBtn(false, upToDate), display: "block", width: "100%", textAlign: "center", marginTop: 8, fontWeight: 700 }}
              >{upToDate ? "✓ KITCHEN UP TO DATE" : "SEND ORDER → KITCHEN"}</button>
              <div style={{ fontFamily: FONT, fontSize: 7, letterSpacing: "0.10em", textTransform: "uppercase", color: tokens.ink[4], marginTop: 6 }}>
                PAIRING &amp; SHARE → BOARD CARD
              </div>
            </div>
          )}

          {/* actions */}
          <div style={{ padding: "12px 14px" }}>
            {onAnnounce && (
              <button
                disabled={announced || !nextFire}
                onClick={() => onAnnounce()}
                style={{ ...actionBtn(true, announced || !nextFire), display: "block", width: "100%", textAlign: "center", marginBottom: 6 }}
              >
                {announced ? `ANNOUNCED ✓ C${String(nextFire?.index ?? "").padStart(2, "0")}`
                  : !nextFire ? "MENU COMPLETE"
                  : strip === "SET" ? "SEND SET → KITCHEN" : "SET → KITCHEN"}
              </button>
            )}
            <div style={{ display: "flex", gap: 0 }}>
              {onToggleStrip && (
                // the hands-call strip toggle — since a tap only selects,
                // this button IS how a table gets marked set on the floor
                <button onClick={() => onToggleStrip()} style={{ ...actionBtn(false, false), flex: 1, textAlign: "center", fontWeight: 700 }}>
                  {strip === "SET" ? "UNSET" : "SET"}
                </button>
              )}
              {onOpenDetail && bt && (
                <button onClick={() => onOpenDetail(bt.id)} style={{ ...actionBtn(false, false), flex: 1, textAlign: "center", marginLeft: onToggleStrip ? -1 : 0 }}>DETAILS →</button>
              )}
            </div>
          </div>
        </>
      )}
    </>,
  );
}
