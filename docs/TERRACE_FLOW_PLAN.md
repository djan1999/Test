# Terrace Flow, Floor Assignment & Kitchen Floor View — Implementation Plan

Status: implementation in progress on `claude/new-session-z8j0hn`.
Spec source: TERRACE_FLOW_PROMPT (terrace leg → last-bite arming → move to
dining table → kitchen floor view with house seat numbering).

Per the spec's working style this plan is posted first: the contradictions
between the spec and the codebase as it actually exists, the adapted data
model, the schema diff, and the file-touch list.

---

## 1. Spec ↔ codebase contradictions (flagged, not worked around silently)

The spec references several structures that do not exist in this repo. Each
one is listed with the adaptation chosen; nothing below is silently ignored.

| # | Spec says | Codebase reality | Adaptation |
|---|-----------|------------------|------------|
| C1 | "Read `SYNC_MIGRATION_PLAN.md`" / "Read `FEATURE_MANIFEST.MD`" | Neither file exists. Closest: `docs/SYNC_UPGRADE_PLAN.md` (PowerSync as source of truth) and `docs/INVARIANTS.md`. | Read those. All new writes go through the existing seams (`stateStore`, `persistReservationRow`, `writeMenuCourses`); no new sync mechanism. |
| C2 | "Reuse the existing floor renderer component in a `picker` mode — do not fork it." | **No floor renderer exists anywhere in `src/`.** The board is a card grid (`DisplayBoard` in `App.jsx`); no geometry, chairs, or maps. | A single new renderer `src/components/floor/FloorMap.jsx` is created with `view` / `picker` / `seats` modes, and every consumer (FOH terrace picker, kitchen floor view, admin seats editor) uses that one component. |
| C3 | Terrace tables (T23…) hold seated parties. | `service_tables.table_id` has a DB `CHECK (1..10)`; the board is a fixed 10-table grid. Terrace tables cannot exist as board rows. | Terrace tables never enter `service_tables`. Terrace **occupancy is derived** from reservations (`visit_state='terrace'` + `terrace_table`); DIRTY strips live in a new `service_settings` row. Zero schema change, zero board impact. |
| C4 | Reservations "imported via SuperB email parsing". | No SuperB / email parsing exists; reservations are manual (`ResvForm`). | Irrelevant to the feature: `dining_table` ≡ `reservations.table_id` (+ `tableGroup`), which exists and is only read, exactly as the spec instructs. |
| C5 | Last-bite flag "lives on the course item id, never on sequence index". | Courses have **no stable id**: the natural key is `position`, and `moveCourse`/insert renumber positions across the list. `course_key` is a mutable auto-label. | `is_last_bite` is a boolean **column on the course row object**. Because the editor re-upserts whole rows after renumbering, the flag travels with the course through insert/reorder — acceptance 7 holds. The "stable course id" the spec assumes does not exist; if one is ever introduced, nothing here has to change. |
| C6 | "8-course, 12-course, veg menus each have their own" last-bite flag. | There are no separate menu entities. One course list; the short menu is `show_on_short`; veg/dietary are per-course substitutes. | Uniqueness is enforced across the single course list (one flagged course). If separate menu entities land later, the uniqueness scope moves with them. |
| C7 | Route `/kitchen/floor`, "gated by the existing kitchen display auth/session". | No router (no react-router dependency); views are a `mode` string. There is **no kitchen-specific auth** — any authenticated workspace member may open kitchen mode. | Kitchen floor = `mode "kitchen_floor"`, entered from the kitchen board header and from the login screen's KITCHEN entry, behind the same Supabase auth + workspace gate as the kitchen board. Acceptance 10 is satisfied at that (real) gate: no session → no view. |
| C8 | green = SET, amber = DIRTY table statuses. | No SET/DIRTY status enum exists on board tables; green is derived "seated". | DIRTY is introduced **only for terrace tables** (new settings row). The dining board's status model is untouched. |
| C9 | "board_state realtime" channel. | No such channel. Realtime = PowerSync sync stream (SQLite-primary) + Supabase realtime safety net. | The kitchen floor view renders from the same App state (tables + reservations) fed by those existing channels. No new subscription. |
| C10 | "do not regress the 64-check baseline". | No 64-check baseline exists anywhere. The real baseline: vitest, 32 files / 585 tests, all green at branch point. | Rule applied as "no test regressions"; new logic ships with its own tests. |
| C11 | New seat-restriction schema `{ seat, code, note }`. | Seat-level restrictions **already exist**: `{ note, pos }` where `pos` = seat number, `pos: null` = whole table (`mergeRestrictionPositions`, seat pickers in App + KitchenBoard, generators). | No shape change. `pos ≡ seat`, `note ≡ code/note`. New work is only: chair-mark rendering on the floor view and the map-aware seat-count cap on the selector. |
| C12 | Floor editor "gets a SEATS mode". | No floor editor exists (roadmap 0.4: floor plan not yet configurable). | A minimal admin Floor panel is added: active-layout toggle (with re-resolve diff confirm) + SEATS renumber mode on the shared renderer. Walls/doors editor internals stay out of scope, per spec. |

Also honoured from the appendix: T7 (both layouts) and T8 numbering are
unmarked — the seed data ships clockwise defaults tagged `confirm: true`
(**CONFIRM WITH DJAN**), rendered with a `?` marker in the seats editor.

## 2. Data model (adapted to the real schema)

### 2a. Party / visit state — inside `reservations.data` (jsonb)

`reservations.data` and `service_tables.data` round-trip opaquely through
PowerSync (whole-blob text columns), so party state needs **no Postgres or
seam change** and is queue-safe offline in both storage modes:

```
visit_state        'booked' | 'terrace' | 'arriving' | 'dining' | 'done'   (absent = legacy/'booked')
terrace_table      text | null      terrace table label, set at arrival
terrace_map_id     text | null      future-proofing for multiple outdoor maps
last_bite_fired_at ISO string | null
moved_at           ISO string | null
```

- `dining_table` ≡ the existing `table_id` (+ `tableGroup`) — read, never
  duplicated. The existing move/swap tool keeps working; MOVE always targets
  the current `table_id` resolved against the active map.
- ARMED is derived: `last_bite_fired_at != null && visit_state === 'terrace'`.
- A reservation with none of these keys behaves byte-for-byte as today
  (acceptance 1).

### 2b. Menu — the only Postgres change

```sql
alter table public.menu_courses
  add column if not exists is_last_bite boolean not null default false;
```

Seam ripple (all in this repo): `src/powersync/AppSchema.js` (+column),
`SupabaseConnector.js` `BOOLEAN_COLUMNS`, `reads.js`
`MENU_COURSE_BOOL_COLUMNS`, `App.jsx` course mappers, sync-rules use
`SELECT *` so the column flows once in the publication.

### 2c. Floor maps + terrace state — `service_settings` rows (existing seam)

```
id "floor_maps_v1": {
  maps: [ { id, kind: 'terrace'|'dining', name,
            tables: [ { label, shape: 'rect'|'round', x, y, w, h,
                        members?: ['T6','T7'],          // merge = logical table
                        seats: [ { no, side, offset } | { no, angle } ],
                        confirm?: true } ] } ],
  activeDiningMapId,
  config: { moveSingleTap: false }        // MOVE_SINGLE_TAP flag
}
id "terrace_state_v1": { dirty: { [tableLabel]: true } }
```

Seeded from the appendix diagrams (Layout A, Layout B, default terrace map).
Seat definitions are per map (T9 seats 2 in A, 3 in B). Restriction seat
numbers (`pos`) are house seat numbers; the selector caps at the assigned
table's seat count **in the active map**.

### 2d. Reservation ↔ active-layout resolution

Reservation tables are integers 1–10; map tables are labels (`T7`) or merges
(`T2-3` with `members`). Resolution order per spec: exact label → member →
`NEEDS TABLE`. Switching the active dining layout re-resolves the service's
reservations and shows a confirm diff before applying (writes `tableGroup`
via the existing repoint-safe helpers).

## 3. State machine

Implemented as pure functions in `src/utils/terraceFlow.js` (unit-tested),
side effects applied through `persistReservationRow` / `saveStateKey`:

```
booked  ──assignTerrace(label)──────────▶ terrace
booked  ──(existing seat flow, no terrace)─▶ dining        (unchanged path)
terrace ──kitchen fires is_last_bite course─▶ terrace+ARMED (badge only)
ARMED   ──MOVE TO {dining}──────────────▶ arriving   (terrace table → DIRTY + freed, moved_at)
arriving ──MARK SEATED──────────────────▶ dining
dining  ──existing clear flow───────────▶ done
```

- No readiness handshake; MOVE never blocked by dining-table status.
- `MOVE_SINGLE_TAP` config: MOVE goes straight to `dining`.
- Edge cases per spec: last bite with no terrace assignment → no-op; terrace
  table cleared meanwhile → ARMED + MOVE still reachable from the reservation
  row; extra courses after last bite → nothing re-arms/un-arms.

## 4. File-touch list

| File | Change |
|------|--------|
| `docs/TERRACE_FLOW_PLAN.md` | this plan (new) |
| `schema.sql` | + `menu_courses.is_last_bite` |
| `src/powersync/AppSchema.js` | + `is_last_bite` column |
| `src/powersync/SupabaseConnector.js` | + `is_last_bite` in `BOOLEAN_COLUMNS` |
| `src/powersync/reads.js` | + `is_last_bite` in `MENU_COURSE_BOOL_COLUMNS` |
| `src/utils/floorMaps.js` | new, pure: seed maps (appendix), resolution (exact > member > NEEDS TABLE), layout-switch diff, seat counts, renumber |
| `src/utils/terraceFlow.js` | new, pure: visit-state derivation + transitions, ARMED, last-bite hook decision |
| `src/components/floor/FloorMap.jsx` | new, the single floor renderer: `view` / `picker` / `seats` modes, seat marks + numbers, restriction dots |
| `src/components/kitchen/KitchenFloorView.jsx` | new, read-only kitchen floor view (tabs, default TERRACE, popover) |
| `src/components/kitchen/KitchenBoard.jsx` | `onCourseFired` hook (the single kitchen integration point) + FLOOR header entry |
| `src/components/admin/FloorPanel.jsx` | new: active-layout toggle + re-resolve confirm diff + SEATS renumber mode |
| `src/components/admin/AdminLayout.jsx` | mount FloorPanel |
| `src/components/admin/CourseEditorPanel.jsx` | LAST BITE toggle (unique per list) + `◼ LAST BITE` marker |
| `src/App.jsx` | course mappers (+`is_last_bite`); floor-maps/terrace settings load+save; terrace section on the service board (assign picker, ARMED badge, MOVE/SEATED actions); ARRIVING visual on dining cards; `kitchen_floor` mode; last-bite fire hook wiring; NEEDS TABLE flag |
| `src/__tests__/floorMaps.test.js` | new |
| `src/__tests__/terraceFlow.test.js` | new |
| existing menu / connector / reads tests | extended for `is_last_bite` |

## 5. Commit sequence (small commits per seam)

1. this plan document
2. pure logic: `floorMaps.js` + `terraceFlow.js` + tests
3. `is_last_bite` through every seam + course editor toggle + tests
4. `FloorMap.jsx` shared renderer
5. FOH wiring in `App.jsx`: terrace section, assign picker, MOVE/SEATED, ARRIVING visual, terrace DIRTY state
6. kitchen: fire hook + `KitchenFloorView`
7. admin: FloorPanel (active layout + diff confirm + SEATS mode)
8. full-suite pass (baseline 32 files / 585 tests) + follow-ups

## 6. Out of scope (per spec, seams noted)

- Floor sheet editor internals (walls/doors) — the map model stores plain
  geometry so an editor can attach later.
- Return-to-terrace leg, per-table last-bite overrides, readiness pings,
  multi-turn terrace reservations — `terrace_map_id` and the pure transition
  functions are the seams for these.
