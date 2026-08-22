import { useEffect, useState } from "react";
import { tokens } from "../../styles/tokens.js";
import FloorMap from "./FloorMap.jsx";
import FloorDock from "./FloorDock.jsx";
import { DisplayBoardCard } from "../service/DisplayBoard.jsx";
import {
  getActiveDiningMap, getTerraceMap, terraceOccupancy, boardIdsOf,
  resolveReservationTable, floorStatusOf, mapTicker,
} from "../../utils/floorMaps.js";
import { visitStateOf } from "../../utils/terraceFlow.js";
import useIsFullscreen from "../../hooks/useIsFullscreen.js";
import { getVisibleCoursesForTable, getCourseProgressState } from "../../utils/courseProgress.js";
import {
  floorPositionKey, seatFloorPosition, restrictionsAtFloorPositions,
} from "../../utils/tableHelpers.js";

const FONT = tokens.font;

// FloorView — the FOH floor surface (serviceView "floor"). One spatial
// projection of the same App state the board renders: map tabs (active dining
// layout + terrace), a ticker strip, and the shared FloorMap renderer in
// `service` mode.
//
// Tap model (per Djan, 21–22.08): a TABLE tap SELECTS — the dock beside the
// map follows it and carries every action. On the terrace that includes the
// party actions (MOVE IN / CHANGE TABLE / CLEAR, and the assign picker on a
// free table) — the old bottom sheet is gone, ONE surface instead of two.
// A CHAIR tap opens the board's QUICK ACCESS card for that table in a side
// panel — the same editor as board mode, not a copy. Nothing toggles on any
// tap, so peeking can never flip a SET.
//
// STRICTLY service — geometry editing is an admin concern and lives in the
// Floor & Terrace panel (FloorEditor), not here.

const btn = (on) => ({
  fontFamily: FONT, fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase",
  padding: "8px 14px", marginLeft: -1, borderRadius: 0, cursor: "pointer",
  border: `1px solid ${on ? tokens.charcoal.default : tokens.ink[4]}`,
  background: on ? tokens.charcoal.default : tokens.neutral[0],
  color: on ? tokens.neutral[0] : tokens.ink[2], fontWeight: on ? 600 : 400,
  touchAction: "manipulation",
});

const actionBtn = (primary) => ({
  fontFamily: FONT, fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase",
  padding: "10px 14px", border: `1px solid ${primary ? tokens.ink[0] : tokens.ink[4]}`,
  background: primary ? tokens.ink[0] : tokens.neutral[0],
  color: primary ? tokens.neutral[0] : tokens.ink[2],
  borderRadius: 0, cursor: "pointer", touchAction: "manipulation", fontWeight: primary ? 600 : 400,
});

export default function FloorView({
  // "terrace" | "dining": the caller owns which map shows (the 11.07
  // flattening — BOARD/TERRACE/DINING ROOM one row up in App); the inner
  // tab bar disappears. Unset → legacy self-owned tabs.
  mapKind = null,
  floorMaps, floorStatus, reservations = [], tables = [],
  menuCourses = [], profiles = [], assignments = {},
  optionalExtras = [], optionalPairings = [],
  aperitifOptions = [],     // quick-access panel: the same catalogs the board card gets
  wines = [], cocktails = [], spirits = [], beers = [],
  onCycleStatus,
  onAssign, onClear, onMove,
  onSendSetToKitchen,
  onSwapSeats,
  onOpenDetail,             // (boardId) → App raises the board's table sheet
  onUnsetKitchen,           // (boardId) → clears the kitchen banner (courseReady)
  upd,                      // (boardId, field, value|fn) — dock + quick-access writes
  updSeat,                  // (boardId, seatId, field, value) — quick-access seat writes
  isMobile,
}) {
  const diningMap = getActiveDiningMap(floorMaps);
  const terraceMap = getTerraceMap(floorMaps);
  const tabs = [diningMap, terraceMap].filter(Boolean);

  const [tabId, setTabId] = useState(null);
  const [dockLabel, setDockLabel] = useState(null); // the table the side dock follows (last tap)
  const [dockSeatNo, setDockSeatNo] = useState(null); // chair tap → that ONE seat's quick access, in the dock column
  const [movingParty, setMovingParty] = useState(null); // terrace CHANGE TABLE: the reservation being re-seated
  // Fullscreen (the gate toggle / F11 / the PWA's fullscreen display mode):
  // the extra pixels go to the map and the dock, not to margins.
  const isFullscreen = useIsFullscreen();

  const forcedMap = mapKind === "terrace" ? terraceMap : mapKind === "dining" ? diningMap : null;
  const map = forcedMap || tabs.find((m) => m.id === tabId) || tabs[0];
  // Leaving the map (App's toggle) must drop the dock focus / quick panel /
  // pending CHANGE TABLE, exactly like the old tab switch did.
  useEffect(() => {
    if (mapKind) { setDockLabel(null); setDockSeatNo(null); setMovingParty(null); }
  }, [mapKind]);
  if (!map) return null;

  // No confirmation toast (per Djan, 22.08): it mounted above the ticker and
  // shoved the whole floor down for a beat on every action. The map and the
  // dock already show each outcome — chips, rings, labels — so nothing is
  // announced twice.
  const switchTab = (id) => { setTabId(id); setDockLabel(null); setDockSeatNo(null); setMovingParty(null); };

  const progressOf = (boardTable) => {
    if (!boardTable) return "";
    const visible = getVisibleCoursesForTable(boardTable, menuCourses, { profiles, assignments });
    const p = getCourseProgressState(boardTable, visible);
    return p.total ? `C${p.firedCount}/${p.total}` : "";
  };

  // The course a board table would announce right now (its next unfired one).
  const nextFireKeyOf = (bt) => {
    if (!bt) return null;
    const visible = getVisibleCoursesForTable(bt, menuCourses, { profiles, assignments });
    return getCourseProgressState(bt, visible).nextFire?.key || null;
  };
  // A SET table has ALREADY been sent when the kitchen already holds a "SET
  // FOR …" banner for the exact course we'd send now — courseReady.key (written
  // by onSendSetToKitchen) equals its current nextFire. Re-sending it is a pure
  // duplicate: pressing SEND after setting a second table used to re-fire the
  // first one too. Already-sent tables drop out of the send set and wear an
  // amber ring instead; they clear on their own when the course fires
  // (courseReady resolves → SET strip drops).
  const alreadySent = (bt) => {
    const nk = nextFireKeyOf(bt);
    return nk != null && bt?.courseReady?.key === nk;
  };

  const diningLabelOf = (r) =>
    resolveReservationTable(diningMap, r.table_id).table?.label || `T${r.table_id}`;

  // A merge's slots point at the group's PRIMARY board table — the one whose
  // card the board shows (same rule as DisplayBoard's isPrimary).
  const boardTableOf = (mapTable) => {
    const id = boardIdsOf(mapTable)[0];
    const bt = tables.find((x) => x.id === id) || null;
    if (bt?.tableGroup?.length) {
      const primary = Math.min(...bt.tableGroup);
      return tables.find((x) => x.id === primary) || bt;
    }
    return bt;
  };

  // ── per-table presentation for the visible map ────────────────────────────
  // NO reservation names on the FOH floor (per Djan): tables read label +
  // ×pax + course; the runner's info is the per-seat water·pairing note at
  // each chair. Names stay on the board and the terrace assign picker.
  // Waters are ALREADY house shortcuts (XC / XW / OC / OW) — show the stored
  // value untouched. Pairings use the house codes; unknown values fall back
  // to their initials.
  const PAIRING_CODES = { "Wine": "WP", "Non-Alc": "NA", "Premium": "PWP", "Our Story": "OS" };
  const pairingCode = (p) => {
    const v = String(p || "").trim();
    if (!v || v === "—") return "";
    return PAIRING_CODES[v] || v.split(/[\s-]+/).map((w) => w.charAt(0)).join("").toUpperCase();
  };
  const bevNote = (s) => {
    const water = s.water && s.water !== "—" ? String(s.water).toUpperCase() : "";
    return [water, pairingCode(s.pairing)].filter(Boolean).join("·");
  };
  const seatNotesOf = (bt, positionKey) => {
    const notes = {};
    for (const s of bt?.seats || []) {
      const note = bevNote(s);
      if (note) notes[seatFloorPosition(s, positionKey)] = note;
    }
    return Object.keys(notes).length ? notes : null;
  };
  // Chairs outline in the seat's gender color (Mr blue / Mrs pink) so the
  // runner can address the right guest from the map.
  const seatGendersOf = (bt, positionKey) => {
    const out = {};
    for (const s of bt?.seats || []) {
      if (s.gender === "Mr" || s.gender === "Mrs") out[seatFloorPosition(s, positionKey)] = s.gender;
    }
    return Object.keys(out).length ? out : null;
  };
  // A terrace party's live restrictions belong to its BOARD table (seat
  // assignments made in service/kitchen live there) — the reservation blob is
  // only the fallback for parties whose board table isn't templated yet.
  const terracePartyBoardTable = (r) => {
    if (!r) return null;
    let bt = tables.find((x) => x.id === Number(r.table_id)) || null;
    if (bt?.tableGroup?.length) bt = tables.find((x) => x.id === Math.min(...bt.tableGroup)) || bt;
    return bt;
  };

  const occ = map.kind === "terrace" ? terraceOccupancy(reservations) : {};
  const tableState = {};
  const restrictionsByLabel = {};
  const seatNotesByLabel = {};
  const seatGendersByLabel = {};
  for (const t of map.tables || []) {
    const strip = floorStatusOf(floorStatus, map.id, t.label);
    const positionKey = floorPositionKey(map.id, t.label);
    if (map.kind === "terrace") {
      const r = occ[t.label];
      const bt = terracePartyBoardTable(r);
      const restrSource = (bt?.restrictions?.length ? bt.restrictions : r?.data?.restrictions) || [];
      const restr = restrictionsAtFloorPositions(bt?.seats || [], restrSource, positionKey)
        .filter((x) => x && x.note);
      tableState[t.label] = r
        ? {
            status: "occupied",
            pax: r.data?.guests || undefined, // ticker covers; not rendered
            // the party's identity on the terrace IS their dining table
            sub: diningLabelOf(r),
            allergy: restr.length > 0,
            strip,
            // announced to the kitchen (SET on a kitchen ticket, the board
            // sheet, or here) → amber ring, whatever surface pressed it
            sent: alreadySent(bt),
          }
        : { status: "free", strip };
      if (restr.length) restrictionsByLabel[t.label] = restr;
      if (bt) {
        const notes = seatNotesOf(bt, positionKey);
        if (notes) seatNotesByLabel[t.label] = notes;
        const genders = seatGendersOf(bt, positionKey);
        if (genders) seatGendersByLabel[t.label] = genders;
      }
    } else {
      const bt = boardTableOf(t);
      const restr = restrictionsAtFloorPositions(bt?.seats || [], bt?.restrictions || [], positionKey)
        .filter((x) => x && x.note);
      if (bt) {
        const genders = seatGendersOf(bt, positionKey);
        if (genders) seatGendersByLabel[t.label] = genders;
      }
      if (bt?.active) {
        tableState[t.label] = {
          status: "occupied",
          pax: bt.guests || undefined, // ticker covers; not rendered
          allergy: restr.length > 0,
          strip,
          // the table's course readout ("C3/7") rides the tile like the
          // kitchen floor's — the same information wherever you look
          sub: progressOf(bt),
          // announced to the kitchen for its next course → amber ring. NOT
          // gated on the strip: a SET pressed on the kitchen ticket or the
          // board sheet writes courseReady only, and the floor must show it
          // all the same. Announced tables stay excluded from the next SEND.
          sent: alreadySent(bt),
        };
        const notes = seatNotesOf(bt, positionKey);
        if (notes) seatNotesByLabel[t.label] = notes;
      } else if (bt && (bt.resName || bt.resTime)) {
        tableState[t.label] = {
          status: "reserved",
          pax: bt.guests || undefined,
          allergy: restr.length > 0,
          strip,
        };
      } else {
        tableState[t.label] = { status: "free", strip };
      }
      if (restr.length) restrictionsByLabel[t.label] = restr;
    }
  }

  const ticker = mapTicker(Object.values(tableState));

  // Drag a chair onto another chair of the same table. TERRACE: P-numbers
  // stay tied to guests; only the chair assignment for this map changes (the
  // aperitif chair must not rewrite the dining plan). DINING: the chair IS
  // the kitchen's plate position — a real swap, so P-numbers and restriction
  // positions renumber and the kitchen ticket reads the new chair.
  const swapSeatPositions = (label, aNo, bNo) => {
    if (!onSwapSeats) return;
    const bt = map.kind === "terrace"
      ? terracePartyBoardTable(occ[label])
      : boardTableOf((map.tables || []).find((x) => x.label === label));
    if (!bt) return;
    const positionKey = floorPositionKey(map.id, label);
    const source = (bt.seats || []).find((seat) => seatFloorPosition(seat, positionKey) === Number(aNo));
    if (!source) return;
    if (map.kind === "terrace") {
      onSwapSeats(bt.id, Number(aNo), Number(bNo), positionKey);
      return;
    }
    onSwapSeats(bt.id, Number(aNo), Number(bNo), positionKey, { identity: true });
  };

  // Parties the terrace tab must keep reachable even without a tile: any
  // terrace party whose label no longer exists on the current map (tile
  // renamed/deleted mid-service). No tile means no dock actions and no MOVE —
  // this banner is the only way back in. (A table-less 'terrace' row never
  // gets here: visitStateOf self-heals it to 'booked'.)
  const mapLabels = new Set((map.tables || []).map((t) => t.label));
  const stranded = map.kind === "terrace"
    ? reservations.filter((r) =>
        visitStateOf(r.data) === "terrace" && !mapLabels.has(r.data?.terrace_table))
    : [];

  // The dining-side counterpart: LIVE board parties whose slot no tile on
  // this map claims (a mid-service rename/delete, or an unlinked table).
  // They used to vanish from the floor silently — no tile, no SET, only the
  // admin editor's RESOLVE list knew (15.07 audit). The floor itself warns.
  const floorInvisible = map.kind === "terrace" ? [] : (() => {
    const claimed = new Set((map.tables || []).flatMap((t) => boardIdsOf(t).map(Number)));
    return (tables || []).filter((t) =>
      (t.active || t.resName || t.resTime) &&
      (!t.tableGroup?.length || t.id === Math.min(...t.tableGroup)) &&
      !(t.tableGroup?.length > 1 ? t.tableGroup : [t.id]).some((id) => claimed.has(Number(id))));
  })();

  // Parties eligible for a terrace assignment: anyone without a terrace leg
  // yet. Seated-inside parties stay eligible — Djan seats the board table
  // first (courses start) while the party physically sits outside — and so
  // do 'dining' parties who already came IN from the terrace: they may go
  // back out for the last course / dessert (per Djan, 15.07). Only parties
  // already on the terrace, and cleared rows, are out.
  const bookedParties = reservations.filter((r) =>
    ["booked", "dining"].includes(visitStateOf(r.data)) && !r.data?.clearedFromBoard);

  // SET tables with a live board ticket, grouped by board id (a merge shares one
  // ticket). SEND forwards only the ones not yet announced for their next course.
  const setBoardTables = map.kind === "terrace" ? [] : [...new Map(
    (map.tables || [])
      .filter((t) => floorStatusOf(floorStatus, map.id, t.label) === "SET")
      .map((t) => boardTableOf(t))
      .filter((bt) => bt?.active)
      .map((bt) => [bt.id, bt]),
  ).values()];
  const sendableIds = setBoardTables.filter((bt) => !alreadySent(bt)).map((bt) => bt.id);

  // ── dock content — the last tapped table, resolved to its merge-primary
  // board table exactly the way the tiles themselves resolve it ─────────────
  const dockTable = dockLabel ? (map.tables || []).find((t) => t.label === dockLabel) : null;
  const dockParty = map.kind === "terrace" && dockTable ? occ[dockLabel] : null;
  const dockBoard = dockTable
    ? (map.kind === "terrace" ? terracePartyBoardTable(dockParty) : boardTableOf(dockTable))
    : null;
  const dockStrip = dockTable ? floorStatusOf(floorStatus, map.id, dockLabel) : null;
  // same restriction source rule as the tiles: the board table, falling back
  // to the reservation blob for terrace parties not templated onto a board
  // table yet — the dock must never disagree with the chair it sits beside
  const dockRestrictions = map.kind === "terrace"
    ? ((dockBoard?.restrictions?.length ? dockBoard.restrictions : dockParty?.data?.restrictions) || [])
    : (dockBoard?.restrictions || []);
  // chair tap → the guest at that floor position; resolved with the same
  // per-map mapping the swap drags use, so the panel can never show the
  // wrong person after a seat swap
  const dockSeat = dockSeatNo != null && dockBoard
    ? (dockBoard.seats || []).find(
        (s) => seatFloorPosition(s, floorPositionKey(map.id, dockLabel)) === Number(dockSeatNo),
      ) || null
    : null;
  // announce THIS table — the kitchen banner plus the local strip (when not
  // on yet); the dock is the ONE surface for it on both floors
  const announceDock = onSendSetToKitchen && dockBoard ? () => {
    onSendSetToKitchen([dockBoard.id]);
    if (dockStrip !== "SET") onCycleStatus(map.id, dockLabel);
  } : undefined;
  // the one set button's other face: announced → UNSET clears the kitchen
  // banner AND the strip together (mirrors the sheet's onUnsetKitchen)
  const unannounceDock = onUnsetKitchen && dockBoard ? () => {
    onUnsetKitchen(dockBoard.id);
    if (dockStrip === "SET") onCycleStatus(map.id, dockLabel);
  } : undefined;

  // Terrace party actions live IN the dock (per Djan, 22.08 — the old bottom
  // sheet made every terrace tap two pop-ups).
  const partyActions = map.kind === "terrace" && dockParty ? {
    moveLabel: diningLabelOf(dockParty),
    onMoveIn: onMove ? () => { onMove(dockParty); setDockLabel(null); setDockSeatNo(null); } : undefined,
    onChangeTable: () => setMovingParty(dockParty),
    onClear: onClear ? () => { onClear(dockParty); setDockLabel(null); setDockSeatNo(null); } : undefined,
  } : null;
  // Free terrace table → the assign picker, also in the dock.
  const assignOptions = map.kind === "terrace" && dockTable && !dockParty && onAssign
    ? bookedParties.map((r) => ({
        id: r.id,
        label: `${r.data?.resName || "—"} ×${r.data?.guests || "?"}`
          + (visitStateOf(r.data) === "dining" ? ` · ${diningLabelOf(r)} ↩`
            : r.data?.resTime ? ` · ${r.data.resTime}` : ""),
        onPick: () => onAssign(r, dockLabel),
      }))
    : null;

  // CHANGE TABLE armed: the next terrace tap lands the party — on a FREE
  // table it re-seats; on an OCCUPIED one the two parties SWAP tables (per
  // Djan, 22.08). A stranded party (no live tile) can't swap — nowhere to
  // send the other party — so occupied stays refused for them.
  const resolveMovingTap = (label) => {
    if (!movingParty || map.kind !== "terrace") return false;
    const targetParty = occ[label];
    if (targetParty) {
      const fromLabel = movingParty.data?.terrace_table || null;
      const fromOnMap = fromLabel && mapLabels.has(fromLabel);
      if (!fromOnMap || targetParty.id === movingParty.id) return true; // nothing to swap with
      onAssign(movingParty, label);
      onAssign(targetParty, fromLabel);
      setMovingParty(null);
      return true;
    }
    onAssign(movingParty, label);
    setMovingParty(null);
    return true;
  };

  return (
    <div style={{ margin: isMobile ? "0 12px 40px" : "0 24px 48px" }}>
      {/* map tabs — hidden when the caller owns the map choice (mapKind) */}
      {!mapKind && (
        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 0, marginBottom: 8 }}>
          {tabs.map((m) => (
            <button key={m.id} style={btn(m.id === map.id)} onClick={() => switchTab(m.id)}>
              {m.name}
            </button>
          ))}
        </div>
      )}

      {/* ticker — the visible map's live counts */}
      <div style={{
        display: "flex", flexWrap: "wrap", gap: "2px 14px", alignItems: "baseline",
        borderTop: `1px solid ${tokens.ink[4]}`, borderBottom: `1px solid ${tokens.ink[4]}`,
        padding: "6px 2px", marginBottom: 8,
        fontFamily: FONT, fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase",
      }}>
        <span style={{ color: tokens.ink[0], fontWeight: 700 }}>COVERS {ticker.covers}</span>
        <span style={{ color: tokens.ink[2] }}>SEATED {ticker.seated}</span>
        <span style={{ color: tokens.ink[2] }}>RES {ticker.reserved}</span>
        <span style={{ color: tokens.green.text }}>SET {ticker.set}</span>
        <span style={{ flex: 1 }} />
        {sendableIds.length > 0 && onSendSetToKitchen ? (
          <button
            style={{ ...actionBtn(true), padding: "7px 12px", fontSize: 8 }}
            onClick={() => onSendSetToKitchen(sendableIds)}>
            SEND SET → KITCHEN ({sendableIds.length})
          </button>
        ) : (
          <span style={{ color: tokens.ink[3], fontSize: 8 }}>TAP TABLE → DOCK · TAP CHAIR → QUICK ACCESS</span>
        )}
      </div>

      {/* CHANGE TABLE banner — armed until a table is tapped */}
      {movingParty && (
        <div style={{
          display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
          border: `1px solid ${tokens.ink[0]}`, background: tokens.neutral[0],
          padding: "8px 12px", marginBottom: 6,
        }}>
          <span style={{ fontFamily: FONT, fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", fontWeight: 700, color: tokens.ink[0] }}>
            TAP A TABLE FOR {(movingParty.data?.resName || "—").toUpperCase()} ×{movingParty.data?.guests || "?"} — OCCUPIED SWAPS
          </span>
          <span style={{ flex: 1 }} />
          <button style={actionBtn(false)} onClick={() => setMovingParty(null)}>CANCEL</button>
        </div>
      )}

      {/* stranded terrace parties — the label vanished in a map edit;
          actions must stay one tap away */}
      {stranded.map((r) => (
        <div key={r.id} style={{
          display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
          padding: "8px 12px", border: `1px solid ${tokens.ink[4]}`, background: tokens.neutral[0], marginBottom: 6,
        }}>
          <span style={{ fontFamily: FONT, fontSize: 11, fontWeight: 700, color: tokens.ink[0] }}>
            {r.data?.resName || "—"} {r.data?.guests ? `×${r.data.guests}` : ""}
          </span>
          <span style={{ flex: 1 }} />
          <button style={actionBtn(false)} onClick={() => setMovingParty(r)}>CHANGE TABLE</button>
          <button style={actionBtn(true)} onClick={() => onMove(r)}>MOVE TO {diningLabelOf(r)} →</button>
        </div>
      ))}

      {/* live parties this dining map can't show — no tile claims their
          board slot. The board/kitchen still serve them; the floor says WHY
          they're missing here instead of hiding them. */}
      {floorInvisible.map((t) => (
        <div key={t.id} style={{
          display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
          padding: "8px 12px", border: `1px solid ${tokens.signal.warn}`,
          background: tokens.neutral[0], marginBottom: 6,
        }}>
          <span style={{
            fontFamily: FONT, fontSize: 8, letterSpacing: "0.12em", fontWeight: 700,
            textTransform: "uppercase", color: tokens.signal.warn,
          }}>NOT ON THIS MAP</span>
          <span style={{ fontFamily: FONT, fontSize: 11, fontWeight: 700, color: tokens.ink[0] }}>
            {t.resName || "—"} {t.guests ? `×${t.guests}` : ""}
          </span>
          <span style={{ fontFamily: FONT, fontSize: 10, color: tokens.ink[3] }}>
            board {t.tableGroup?.length > 1 ? t.tableGroup.join("-") : t.id} — no table here claims this slot (Admin → Floor → SLOTS)
          </span>
        </div>
      ))}

      {/* map + dock: the dock lives in the gutter the capped map leaves
          free (below the map on mobile) and follows the last tapped table */}
      <div style={{
        display: "flex", flexDirection: isMobile ? "column" : "row",
        gap: 16, alignItems: isMobile ? "stretch" : "flex-start",
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <FloorMap
            map={map}
            mode="service"
            tableState={tableState}
            restrictionsByLabel={restrictionsByLabel}
            // The label ▲ read as a dead button (per Djan) — the restriction CODE
            // in red at the exact chair replaces it on the FOH floor too.
            seatCodes
            seatNotesByLabel={seatNotesByLabel}
            seatGendersByLabel={seatGendersByLabel}
            onSeatSwap={onSwapSeats ? swapSeatPositions : undefined}
            showPartyLines={false}
            serviceSelectedLabel={dockLabel}
            serviceSelectedSeat={dockSeatNo != null && dockLabel ? { label: dockLabel, no: dockSeatNo } : null}
            // a chair tap swaps the dock column to that ONE seat's quick
            // access (per Djan, 22.08) — the same editor as board mode,
            // scoped to the tapped position; it does not bubble to the
            // table tap
            onServiceSeatTap={(label, no) => {
              if (resolveMovingTap(label)) return;
              setDockLabel(label);
              setDockSeatNo(Number(no));
            }}
            // fullscreen owns more pixels — the map takes them (22.08)
            height={isMobile ? 380 : isFullscreen ? 680 : 560}
            onTableTap={(t) => {
              // CHANGE TABLE in flight: the tap lands the party (free) or
              // swaps the two parties (occupied).
              if (resolveMovingTap(t.label)) return;
              // A tap SELECTS (per Djan, 21.08) — the dock follows it and
              // holds every action, terrace party actions included. Nothing
              // toggles on the tap itself; a table tap also returns the
              // column from a seat's quick access to the table dock.
              setDockLabel(t.label);
              setDockSeatNo(null);
            }}
          />
        </div>
        {/* the dock column — a chair tap swaps it to that ONE seat's quick
            access (the real board editor, scoped by onlySeatId); a table
            tap or ✕ brings the table dock back. Fullscreen widens it. */}
        <div style={{ width: isMobile ? "100%" : isFullscreen ? 330 : 260, flexShrink: 0 }}>
          {dockSeat && dockBoard ? (
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                <span style={{ fontFamily: FONT, fontSize: 8, letterSpacing: "0.16em", textTransform: "uppercase", color: tokens.ink[3] }}>
                  [QUICK ACCESS · {dockLabel} · P{dockSeat.id}]
                </span>
                <span style={{ flex: 1 }} />
                <button onClick={() => setDockSeatNo(null)} aria-label="Back to table dock"
                  style={{ fontFamily: FONT, fontSize: 11, fontWeight: 700, border: `1px solid ${tokens.ink[4]}`, background: tokens.neutral[0], color: tokens.ink[2], width: 26, height: 26, cursor: "pointer", borderRadius: 0, touchAction: "manipulation" }}>
                  ✕
                </button>
              </div>
              <DisplayBoardCard
                t={dockBoard}
                quickMode
                onlySeatId={dockSeat.id}
                upd={upd}
                updSeat={updSeat}
                onOpenDetail={onOpenDetail}
                optionalExtras={optionalExtras}
                optionalPairings={optionalPairings}
                aperitifOptions={aperitifOptions}
                wines={wines}
                cocktails={cocktails}
                spirits={spirits}
                beers={beers}
              />
            </div>
          ) : (
            <FloorDock
              label={dockLabel}
              mapKind={map.kind === "terrace" ? "terrace" : "dining"}
              boardTable={dockBoard}
              restrictions={dockRestrictions}
              strip={dockStrip}
              menuCourses={menuCourses}
              profiles={profiles}
              assignments={assignments}
              optionalExtras={optionalExtras}
              optionalPairings={optionalPairings}
              onToggleStrip={dockLabel ? () => onCycleStatus(map.id, dockLabel) : undefined}
              onAnnounce={announceDock}
              onUnannounce={unannounceDock}
              onOpenDetail={onOpenDetail}
              partyActions={partyActions}
              assignOptions={assignOptions}
              upd={upd}
              isMobile={isMobile}
              wide={isFullscreen && !isMobile}
            />
          )}
        </div>
      </div>
    </div>
  );
}
