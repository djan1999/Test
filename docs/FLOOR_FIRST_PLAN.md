# Floor-First Correction — Implementation Plan

Status: IMPLEMENTED on `claude/floor-manager-sheet-layer-740ej2` (approved
2026-07-05; open points resolved as recommended in §7 — EDIT behind the
existing workspace gate, FLOOR as the third view-toggle option, statuses
keyed per mapId).
Spec source: FLOOR_FIRST_FIX_PROMPT (+ interaction reference
`floor-manager-v3.jsx`, matched for interaction model and visual register,
not literal code).

The correction: the floor map becomes the product surface — a live spatial
FOH view with two-zone tables (body tap → party sheet, bottom strip →
DIRTY/SET), plus a geometry editor — instead of the admin sub-panel +
collapsed terrace row the previous session shipped.

---

## 1. Spec ↔ codebase adaptations (flagged, not worked around silently)

| # | Spec says | Codebase reality | Adaptation |
|---|-----------|------------------|------------|
| A1 | "Header toggle on the service board: `BOARD ⇄ FLOOR`" | The board header already carries a persisted two-way `[BOARD \| SHEET]` view toggle (`serviceView`, `milka_service_view` in localStorage). | FLOOR becomes the **third option in the same segmented control**: `BOARD \| SHEET \| FLOOR`. Default and unknown-value fallback stay `board` (acceptance 8: board pixel-identical until FLOOR is opened). |
| A2 | EDIT "admin-gated like other admin entry points" | There are **no enforced per-user roles yet**: ADMIN is available to any explicit workspace member. Demo uses a separate sandbox membership. | REVISED per Djan (post-merge follow-up): the geometry editor lives **inside the admin Floor & Terrace panel** (`FloorEditor` mounted by `FloorPanel`, replacing its seat-numbering section — renumbering is part of the editor). The FOH floor view is strictly service-only, no EDIT toggle. |
| A3 | "if the board already carries an equivalent per-table hands-call state, reuse it" | It does not. `courseReady`/`kitchenAlert` is a kitchen course handshake, not a SET/DIRTY strip; dining tables have no hands-call status. Terrace DIRTY lives in `terrace_state_v1` as `{ dirty: { [label]: true } }`. | New settings row **`floor_status_v1`** = `{ [mapId]: { [label]: 'SET' \| 'DIRTY' } }` through the same stateStore seam. `terrace_state_v1.dirty` migrates via one-time read-through (see §2c). |
| A4 | Body tap opens "the board table's existing sheet/quick access" | Quick access is `DisplayBoardCard` in `quickMode`, defined inside `App.jsx` (not exported), expanded inline on the board. | The floor view's dining-table sheet **renders the same `DisplayBoardCard` (quickMode)** via a render prop passed down from App — no extraction of the ~700-line card, no fork, literally the same sheet the board opens. Terrace tables get the folded-in TerracePanel actions instead (they have no board slot — `service_tables` CHECK 1..10). |
| A5 | Mockup's rotate = swap w/h; grid snap | Map units are a 100×92 viewBox, tables ~10–26 units wide. | Grid snap = **1 map unit** (≈4px on a 390px phone, matches the mockup's SNAP-relative feel), clamp to canvas. Rotate = swap `w`/`h` (round tables: no-op visually, still allowed). |
| A6 | "delete the hairline-row pattern" (TerracePanel) | TerracePanel also hosts the always-visible ARRIVING / stranded-ARMED rows ("need an action NOW"). | Those needs stay covered without the panel: board cards already carry MARK SEATED / terrace badges (`_visit` decoration), and the floor view surfaces the same parties on the map. `TerracePanel.jsx` is deleted; the party-first ASSIGN TERRACE mini-map modal (reached from board cards) stays. |
| A7 | Phase-2 `sheet` key reserved per map | `sanitizeFloorMaps` keeps whole map objects (filters on `id` + `tables` only). | Already tolerant — unknown per-map keys like `sheet` survive round-trips today. Documented as reserved; **no rendering or editing of it now**. |

## 2. Data model / settings-key changes (all through the stateStore seam)

No Postgres change. `service_settings` is k/v — no schema diff, no new
dependencies, `service_tables` untouched.

### 2a. `floor_maps_v1` — extended in place

```
{
  geometryVersion: 2,               // NEW — see §2d (v1 ≡ absent = the terrace-flow seeds)
  maps: [ { id, kind, name,
            tables: [ { label, shape, x, y, w, h, boardIds?, members?, seats, ... } ],
            sheet?: {...}           // RESERVED (Phase 2) — preserved, never rendered
          } ],
  activeDiningMapId,
  config: { moveSingleTap }
}
```

Same table shape as today; the editor only rewrites values that already
exist (plus adds/removes tables/maps/seats). `sanitizeFloorMaps` keeps a
stored `geometryVersion` (default 1) so the banner can compare.

### 2b. `floor_status_v1` — NEW row

```
{ [mapId]: { [label]: 'SET' | 'DIRTY' } }
```

- Strip tap cycles `— → DIRTY → SET → —` (pure `cycleFloorStatus`).
- Keyed per map per the spec. Nuance flagged: dining layouts A and B do
  not share strips, so a DIRTY set under Layout A is not visible after a
  switch to Layout B. Layout switches are pre-service, so accepted.
- Sanitizer drops junk values/labels, never throws.

### 2c. `terrace_state_v1` — deprecated, read-through migration

On load: if `floor_status_v1` is absent/empty for the terrace map,
`migrateTerraceState(terraceState, terraceMapId)` folds `dirty: {T23: true}`
into `{ [terraceMapId]: { T23: 'DIRTY' } }` — one-time, in-memory until the
first strip write persists it. `terrace_state_v1` is no longer written;
the sanitizer stays tolerant so an old device still writing it can't break
anything (its writes are simply no longer read once `floor_status_v1`
exists). Terrace flow side effects rewire to the new key: assigning onto a
DIRTY table claims it (clears the strip), MOVE marks the vacated terrace
table DIRTY.

### 2d. `geometryVersion` — the unfreeze (Part C)

- `buildDefaultFloorMaps()` stamps the current `GEOMETRY_VERSION` (2).
- Stored < current → **no auto-overwrite**; EDIT mode shows the one-line
  banner `NEW DEFAULT GEOMETRY AVAILABLE — RESET MAP`.
- Per-map `RESET TO DEFAULTS` (confirm dialog): `resetMapToDefaults(state, mapId)`
  replaces only that map's `tables` from the seed matched by map id, keeps
  every other map intact, and stamps the blob's `geometryVersion` current
  once no map lags. User-created maps have no seed → no reset action shown.

## 3. Surfaces

### Part A — FOH FLOOR view

- `serviceView === "floor"` renders new container
  `src/components/floor/FloorView.jsx`: map tabs (active dining layout +
  TERRACE), ticker strip `COVERS · SEATED n · RES n · SET n · DIRTY n`
  (pure `mapTicker` helper, per visible map), and `FloorMap` in new mode
  **`service`**.
- Mode `service` = two-zone tables in the one renderer:
  - **Body** tap → `onTableTap` → FloorView opens the bottom sheet: dining
    tables resolve `boardIds → service_tables` slot → the existing
    `DisplayBoardCard` quick access (render prop, A4); terrace tables get
    the folded-in actions (ASSIGN party from the booked list, MOVE TO
    {dining}, MARK SEATED, CLEAR TABLE, MARK CLEAN) — TerracePanel's exact
    logic relocated, then the panel deleted.
  - **Status strip** along the bottom: rendered ~30% of table height,
    invisible hit rect ≥40%; tap → `onStatusTap(label)` → cycle. Amber
    DIRTY / green SET (`tokens.signal.warn` / `tokens.green.*`), the only
    color on the canvas. DIRTY pulses subtly via a CSS keyframe gated by
    `@media (prefers-reduced-motion: reduce)`.
- Occupied dining tables render label, name ×pax, course `C4/12` (reusing
  KitchenFloorView's `progressOf` derivation, lifted into FloorView),
  allergy `▲` when any seat restriction exists; ARRIVING renders dashed +
  `ARRIVING · KV`; ARMED badge on terrace (all already supported by
  `tableState`, only `▲` is new in the renderer).
- BOARD stays default; nothing on the board path changes when FLOOR is
  never opened.

### Part B — Geometry editor

- EDIT toggle on FloorView (gate per A2) → `FloorMap` mode **`edit`**:
  pointer-event drag (`touchAction: "none"` on the SVG while editing,
  client→viewBox coordinate conversion, 1-unit snap, clamp), tap =
  select → bottom inspector panel `src/components/floor/FloorInspector.jsx`
  (mockup's register in repo tokens): rename label, RECT/ROUND, W/H
  steppers, ⟳ rotate (swap w/h), duplicate, delete.
- **Seats**: inspector gains ADD SEAT / REMOVE SEAT; seat marks draggable
  along the outline in edit mode (rect: nearest side + offset; round:
  angle — pure `moveSeat(table, index, point)`); the existing
  tap-in-sequence renumber flow and `?` CONFIRM markers are kept and
  reachable from the same inspector (FloorPanel's SEATS section keeps
  working unchanged).
- **Maps**: add / rename / duplicate / delete, `kind: dining | terrace`.
  Guards (pure, tested): cannot delete the last map of a kind; deleting
  the active dining map falls back to another dining map. Duplicate =
  deep copy + `(name) COPY` + fresh id — the "LAYOUT C" path.
- **Merges**: inspector exposes `members` (multi-select of labels) and
  `boardIds` (explicit slot claims — the Layout-B T6-7/T7 disambiguation
  comment and behavior preserved verbatim in `floorMaps.js`). Any edit
  to these re-runs `planLayoutSwitch` against tonight's reservations and
  shows the same conflict rows inline before saving.
- Every mutation is a pure helper in `utils/floorMaps.js` returning the
  next state, applied through the existing `updateFloorMaps` →
  `saveStateKey(FLOOR_MAPS_KEY)` seam. No new persistence path.

### Untouched (KEEP list)

`terraceFlow.js` state machine, `planLayoutSwitch`/apply, seat geometry,
`KitchenFloorView` (only its DIRTY read moves to `floor_status_v1`),
last-bite hook, layout-switch confirm diff in FloorPanel, all existing
tests, `service_tables` schema, board card grid.

## 4. File-touch list

| File | Change |
|------|--------|
| `docs/FLOOR_FIRST_PLAN.md` | this plan (new) |
| `src/utils/floorMaps.js` | extend, pure + tested: `GEOMETRY_VERSION` + version-aware sanitize; table ops (`moveTable`, `resizeTable`, `rotateTable`, `renameTable`, `setTableShape`, `duplicateTable`, `deleteTable`); seat ops (`addSeat`, `removeSeat`, `moveSeat`); map ops (`addMap`, `renameMap`, `duplicateMap`, `deleteMap` + guards, `resetMapToDefaults`); merge ops (`setTableMembers`, `setTableBoardIds`); floor status (`FLOOR_STATUS_KEY`, `sanitizeFloorStatus`, `floorStatusOf`, `cycleFloorStatus`, `migrateTerraceState`); `mapTicker` counts |
| `src/components/floor/FloorMap.jsx` | + mode `service` (two-zone strip, ≥40% hit area, DIRTY pulse, `▲` allergy marker) and mode `edit` (drag/snap/clamp, selection, seat drag) — same single renderer |
| `src/components/floor/FloorView.jsx` | NEW container: map tabs, ticker, service-mode canvas, bottom sheet (DisplayBoardCard render prop / terrace actions), EDIT mode + inspector + geometry banner |
| `src/components/floor/FloorInspector.jsx` | NEW: edit-mode inspector (table/seat/merge/map ops, RESET TO DEFAULTS confirm) |
| `src/components/floor/TerracePanel.jsx` | DELETE — actions folded into the FloorView sheet |
| `src/App.jsx` | `serviceView` 3-way toggle; mount FloorView (remove TerracePanel mount); `floor_status_v1` load/save + terrace migration; rewire terrace DIRTY side effects to floor status; pass the quick-access render prop |
| `src/components/kitchen/KitchenFloorView.jsx` | DIRTY read from `floor_status_v1` (still strictly read-only) |
| `src/__tests__/floorMaps.test.js` | extend: every new pure helper incl. guards, reset isolation, status cycle/migration, version sanitize |
| `src/__tests__/floorMap.smoke.test.jsx` | extend: strip-tap cycle vs body-tap separation, edit-mode drag (pointer sequence → snapped move), `▲` marker |
| `src/__tests__/floorView.smoke.test.jsx` | NEW: tabs + ticker counts + sheet opens on body tap + terrace assign action |

Settings keys touched: `floor_maps_v1` (extended, backward-compatible),
`floor_status_v1` (new), `terrace_state_v1` (deprecated, read-through only).
No schema.sql change, no new dependencies.

## 5. Commit sequence

1. this plan — **STOP for approval**
2. pure logic: floorMaps extensions + floor status + tests
3. FloorMap modes `service` + `edit` + smoke tests
4. FloorView + sheet fold-in + App wiring (TerracePanel deleted) + status migration
5. editor inspector: table/seat/map/merge ops + geometry banner + RESET
6. kitchen DIRTY rewire + full-suite pass

## 6. Acceptance mapping

| # | Acceptance | Covered by |
|---|-----------|------------|
| 1 | FLOOR shows dining map, party + course, body tap = board sheet | §3A (mode `service`, A4 render prop) |
| 2 | Strip cycle syncs + survives reload | `floor_status_v1` via stateStore (§2b) |
| 3 | Terrace assign / LAST BITE / MOVE / ARRIVING→SEATED from the map | TerracePanel fold-in (§3A, A6) |
| 4 | Phone drag T9, resize, rename → persists everywhere | mode `edit` + `updateFloorMaps` (§3B); kitchen renders the same blob |
| 5 | Add seat to T8, drag north, renumber → selector cap follows | seat ops + kept renumber flow; `mapSeatCountForBoardTable` already map-driven |
| 6 | Duplicate LAYOUT A → C, move tables, switch active → diff applies | `duplicateMap` + existing `planLayoutSwitch` confirm |
| 7 | RESET restores one map only | `resetMapToDefaults` (§2d) |
| 8 | BOARD pixel-identical when FLOOR never opened | A1 (default `board`, floor path additive) |

## 7. Open points for approval

1. **A2 gating** — EDIT visible to any authenticated workspace member
   (the only gate that exists). OK, or hide it behind entering from ADMIN
   mode first?
2. **A1 toggle** — FLOOR as the third option of the existing
   BOARD/SHEET control (not a separate toggle). OK?
3. **§2b keying** — statuses per `mapId` per the spec; dining layouts
   don't share strips across a switch. OK?
