# Overcooked floor layouts today, and what the Milka RIS floor editor taught us (codebase analysis)

Source roots used in every citation below (read-only analysis, nothing built or run):
`OC/` = the Overcooked repo, extracted from `576cbf56-overcooked-develop_3.zip` into `/tmp/claude-0/-home-user-Test/28f8ba15-10f9-5eeb-831e-c532e4d13cd5/scratchpad/overcooked-src/overcooked-develop/`.
`MR/` = the old Milka RIS app at `/home/user/Test/` (branch `claude/peaceful-shannon-wuzx9m`).
Line numbers are `:start-end`. "Inferred" means I deduced it from code; I did not find it stated.

## Q1 — What is Overcooked trying to be? (product docs, and the exact floor, table and seat user stories)

### Takeaway
Overcooked is a clean rewrite of Milka RIS for one fine-dining, tasting-menu restaurant model. It carries one information chain: reservation → catalogue → pre-service outputs (briefing, per-seat printed menus, kitchen tickets) → live Service Board and Kitchen Display → permanent archive. Its headline promises are tenant isolation, "plan vs live copy never silently rewrite each other", and working through bad Wi-Fi. Floor plans are MVP Epic 7, at parity with Milka RIS. The future scope adds physical-table records (capacities, combinations, accessibility, retirement), immutable published versions, overlap warnings, service-specific floor plans, a full table lifecycle and movement history.

### Cited Findings
**Product statement and repo rules**
- README: "Overcooked is the working system of a fine-dining, tasting-menu restaurant — the successor and clean rewrite of Milka RIS… staff record reservations with each guest's menu choice, language, restrictions, and occasion… before each service the team generates a briefing breakdown, personalized printed guest menus per seat, and kitchen tickets per table; during the live evening the front-of-house Service Board and the Kitchen Display pace the room together through seat-level orders, SET signals, and fired courses; and every finished service settles into a permanent archive exactly as it happened. Information is entered once and flows everywhere, the plan and the live copy never silently rewrite each other, each restaurant's workspace is fully isolated, and the whole system keeps working through bad Wi-Fi on every device in the building." — [README.md](OC/README.md)
- Root AGENTS.md standards:
  - "Change data shapes at their source. Update schemas, generated types, contracts, and then edge functions and the client, in that order. Derive each step's types from the preceding step."
  - "Ask the user before adding a scoped lint exception."
  - "Ask the user before adding tests."
  - Ask before `just db-update`, which "resets the local database, regenerates the rolling migration, and updates generated types and contracts mirrors".

  — [AGENTS.md](OC/AGENTS.md)
- Docs index: "`_archive/` holds completed or superseded specs; read them for history, not as current truth." It lists `product_v2.md` as "Overcooked product scope: MVP and future scope" and `product.md` as "Milka RIS product and feature map (predecessor reference)". The ADR and External sections both say "None yet." — [.docs/INDEX.md](OC/.docs/INDEX.md)
- product_v2 framing: "MVP scope: capabilities already supported by Milka RIS. Future scope: improvements and additions required to reach the broader Overcooked product vision." Each story "describes a user outcome rather than a specific screen or technical implementation." — [product_v2.md:7-10](OC/.docs/internal/_archive/product_v2.md)

**Glossary (the canonical vocabulary, quoted exactly)** — [.docs/glossary.md](OC/.docs/glossary.md)
- "**Area** — a named part of the Restaurant where Guests sit, such as Terrace, in the Admin's own order. Its name is unique among unarchived Areas. It has Floor layouts, one of them its default, and can be deleted only while it has none. Stored in `Area`."
- "**Floor layout** — one arrangement of an Area on a grid, with walls, doors, blocks, Tables, and their Seats. An Area can have several, and its default layout is the one a Service uses. Avoid: Floor map, Floor Plan."
- "**Seat** — one place at a Table. The Table sets the Seat count, so Seat numbers stay the same in every Floor layout."
- "**Table** — a place where one party sits, with a number and a label that are unique in the Restaurant, and a Seat count."
- "**Archived** — retired, hidden from lists by default, and cannot be newly referenced." / "**Disabled** — switched off and reversible, still listed. Avoid: inactive."
- Terminology conflict: the glossary says "Avoid: … Floor Plan", but the product_v2 user stories use "Floor Plan(s)" throughout — [product_v2.md:36,64,145,150-152](OC/.docs/internal/_archive/product_v2.md)

**Epic 7, Tables, Floor Plans & Seating (verbatim)** — [product_v2.md:136-155](OC/.docs/internal/_archive/product_v2.md)
- MVP:
  - "As an Admin, I can configure the Restaurant's working Table identifiers and labels."
  - "As an Admin, I can create and edit Dining Room and Terrace maps containing room objects, Tables, shapes, positions, rotations, and Seats."
  - "As an Admin, I can create, duplicate, rename, reset, and switch between reusable Floor layouts."
  - "As reservation staff, I can assign Reservations to individual or joined Tables and resolve direct assignment conflicts."
  - "As Service staff, I can move, swap, join, split, seat, and clear parties while keeping the Floor view connected to live Service state."
  - "As Service and Kitchen staff, I can see occupancy, restrictions, Course progress, and SET state on the operational Floor Plan."
- Future:
  - "As an Admin, I can maintain physical Table records with capacities, areas, accessibility, features, allowed combinations, availability, and retirement status."
  - "As an Admin, I can draft, validate, publish, archive, and restore immutable Floor Plan versions."
  - "As an Admin, I receive warnings when Tables overlap physical objects or appear incorrectly in a Floor Plan."
  - "As Service staff, I can create a Service-specific Floor Plan without changing its reusable source."
  - "As staff, I can use a complete Table lifecycle covering expected, arrived, seated, active, SET, dirty, reset, finished, and unavailable states."
  - "As staff, I can review the history of party and Table movements during a Service."
  - "As reservation staff, I can receive understandable whole-Service Table assignment suggestions while retaining final control."

**Stories in other epics that touch tables, seats, layouts or joins (verbatim)** — [product_v2.md](OC/.docs/internal/_archive/product_v2.md)
- Setup:
  - "As an Admin, I can configure the Restaurant name, subtitle, Tables, and optional Hotel Guest features…" (:35)
  - "As an Admin, I can manage Restaurant-specific menus, restrictions, drinks, Floor Plans, layouts, and quick-access options from one administration area." (:36)
  - (future) "As an Admin, I can review and restore supported configuration versions without changing historical Services." (:48)
- Reservations:
  - "As reservation staff, I can create and edit a Reservation with its time, Table, Guest count, Menu, language, Hotel information, notes, and restrictions." (:56)
  - "As reservation staff, I can move, swap, join, split, or remove Reservations while receiving warnings about direct Table conflicts." (:57)
  - "As staff working across devices, I can keep Reservation changes synchronized and avoid silently replacing a newer conflicting edit." (:60)
  - (future) "…reusable Service Types with times, duration, capacity, party limits, Menus, Floor Plans, policies, and booking rules." (:64)
  - (future) "…see which Reservations are affected before applying an important Calendar or Service change." (:66)
  - (future) "…calculate Availability from capacity, Table combinations, Reservation duration, holds, closures, accessibility, and current demand." (:68)
- Guests and restrictions:
  - "As staff, I can assign restrictions to individual Guests or Seats and keep unknown restrictions visibly unassigned until clarified." (:80)
  - "As Kitchen staff, I can see restriction-specific Dish changes and clear warnings on the correct Ticket and Seat." (:81)
- Catalogue:
  - "…offer alcoholic, non-alcoholic, premium, optional, and shared choices per Seat." (:101)
  - "As Service staff, I can record bottles, glasses, Pairings, aperitifs, and other drinks for the correct Table or Seat." (:102)
- Menus:
  - "As Service staff, I can generate a personalized Guest Menu for each Seat using its language, restrictions, Pairing, drinks, and branding." (:122)
  - (future) "…preview every real Seat…" (:131)
  - (future) "…an exact versioned Guest Menu record for every Guest or Seat." (:132)
  - (future) "…print in a chosen Table, Seat, or sitting order." (:133)
- Pre-Service Planning:
  - "As staff, I can review the sitting order, Tables, Guest totals, restrictions, Hotel Rooms, celebrations, and notes before Service." (:162)
  - "As Kitchen staff, I can preview and print Kitchen Tickets for planned Reservations before Service." (:164)
  - (future) "As Service and Kitchen staff, I can prepare one shared Daily Service plan containing every Reservation, Table, Seat, Menu, and restriction." (:169)
  - (future) "…Table-assignment readiness together." (:170)
- Live Front-of-House Service:
  - "…see upcoming, seated, active, and completed parties on a live Service Board." (:180)
  - "…seat or unseat a Reservation and manage its Guests at Seat level." (:181)
  - "…record restrictions, water, Pairings, drinks, aperitifs, and optional Dishes for the correct Seat or Table." (:182)
  - "…follow Course progress, send SET signals, and see Kitchen responses." (:183)
  - "…move, swap, join, split, and transfer parties between the Terrace and Dining Room." (:184)
  - "…clear a Table or the Board through actions that are separate from starting or finishing Service." (:185)
  - "…continue core Service work during poor connectivity and see when changes are pending or refused." (:186)
  - (future) "…create a formal Live Party and Live Seats from the Reservation plan without depending on later Reservation edits." (:190)
  - (future) "…a consistent Table and Party lifecycle across the Board, Floor Plan, and Kitchen." (:192)
  - (future) "…split or combine Parties through explicit operations that preserve Guest and Seat history." (:194)
- Kitchen Operations:
  - "…see active and upcoming Tickets with their time, Table, Guest count, Menu, Courses, restrictions, and notes." (:201)
  - "…see Seat-specific restrictions, substitutions, unassigned warnings, and changes sent from Service." (:204)
  - "As Kitchen staff, I can use the Kitchen Board, Kitchen Floor view, and minimap to follow the current Service." (:205)
  - "…continue working during poor connectivity and receive synchronized Service changes when the connection returns." (:206)
- History:
  - "…finish and resume a Service without deleting its Board, Tables, Tickets, or Guest information." (:242)
  - "…review archived Services, Table details, Guests…" (:243)
  - "…work from a local copy, synchronize pending work, and protect newer Restaurant information from stale-device conflicts." (:247)
  - (future) "…search the complete Service Archive by… Table" (:252)
  - (future) "…Reports for… Tables, and Kitchen timing" (:256)

**Development roadmap**
- Milestone 2, "Operational Configuration and Catalogues", MVP scope:
  - "Restaurant Tables and working identifiers."
  - "Dining Room and Terrace Floor Plans, objects, positions, rotations, and Seats."
  - "Reusable Floor layouts and layout management."
  - Exit criterion: "Floor and Menu layout previews use the same core rendering rules as their later operational outputs."

  — [development_roadmap.md:140-163](OC/.docs/internal/_archive/development_roadmap.md)
- Live-service milestone objective: "Allow front of house to run a complete live Service from arrival through Table completion." Scope includes "Live Dining Room and Terrace Floor views", "Table and party movement, swapping, joining, splitting, and Terrace transfers", and "Live Floor occupancy, restrictions, Course progress, and SET state"; exit criterion: "Table and party operations preserve the intended Guest and Seat information." The kitchen scope includes "Kitchen Board, Kitchen Floor view, and minimap." — [development_roadmap.md:226-263](OC/.docs/internal/_archive/development_roadmap.md)
- Cross-cutting items: "Select and prove the offline and synchronization architecture." (:96) and "Offline edits either synchronize safely or are visibly refused for a clear reason." (:192) — [development_roadmap.md](OC/.docs/internal/_archive/development_roadmap.md)

**product.md, "Tables and Floor Plans" chapter (the richest vision text)** — [product.md:1975-2357](OC/.docs/internal/_archive/product.md)
- Table Information:
  - Fields: "Table name or number; Public and internal name if different; Minimum and comfortable maximum Guests; Absolute maximum Guests when allowed; Area or room; Shape and size; Normal number of Seats; Tables it can join with; Allowed joined-table combinations; Accessibility or special features; Whether it can move; Whether it can be used on the Terrace; Whether it is Active, Temporarily Unavailable or Retired; Internal notes."
  - Rules: "A Table is the physical Restaurant Table / A Floor Plan stores where that Table is placed / A Service Floor Plan stores how it was arranged for one Daily Service / Retiring a Table must never remove it from past Services."
- Floor Plan Builder and Editor, "Needs to do" (paraphrased list, each item stated in the doc):
  - set the usable size and shape of the room
  - "Add walls, doors, windows, fixed furniture and useful labels"
  - move, rotate and resize tables; "Add, move and number Seats"
  - show physically joined tables; "Create saved Table groups for common large-party combinations"; capacity for each table and joined group
  - "Warn when Tables overlap walls, doors or other Tables"; "Warn when a Table is used twice in the same Floor Plan"
  - accessibility and Service routes
  - separate plans for Dining Room, Terrace, events and seasons; copy, rename, start from an existing plan
  - Draft; preview total capacity before Publishing; Publish; Archive
  - keep old versions used by old Services; show which future Services use a plan; restore an old version as a new Draft
  - "Prevent two people from unknowingly replacing each other's changes"; record who created, edited and published each version
- Floor Plan Builder rules: "Editing a Draft Floor Plan must not move Tables in a Live Service / Publishing a new version must not rewrite a completed Daily Service / The visual shape helps staff understand the room, but Table identity and capacity come from Table Information."
- Service Floor Plan:
  - copy a Published plan into a "Service-specific working layout"; adjust it for the day without changing the reusable plan; move or join tables for a large party; temporarily add or remove a table
  - warn about Reservations with no table and about double assignment
  - statuses "Free, Expected, Arrived, Seated, Active, SET, DIRTY, Finished or Unavailable"
  - "Work during bad internet"; "Resolve returning-device conflicts without allowing an old layout to wipe newer work"; keep the final arrangement and table movement history
  - "No lifecycle action such as starting or finishing Service may blank the Service Floor Plan."
- Automatic Table Assignment: "an assistant, not the final decision-maker"; it considers the whole Service; it plans joined tables for large groups.
- Live Party and Seat Information: "Create one Seat for every Guest when individual information is required"; "Allow a Seat to be named, numbered or left as a position"; "Allow Seats to move with the Party when the Table changes"; "The Reservation is the plan and the Live Party is what is happening now."
- The product.md header principles include "Information already used during a previous Service must stay connected to the version that was used at that time", "Service and Kitchen must remain usable during bad internet" and "A returning device must never be able to replace newer Restaurant information with an old copy." — [product.md:1-33](OC/.docs/internal/_archive/product.md)

**Open items (unresolved)** — [open-items.md:5-12](OC/.docs/internal/open-items.md)
- "**Archiving an Area with future Reservations** — Reservations are not implemented yet, so archiving currently has no Reservation check. When Reservations are added, atomically refuse archive if any future Reservation uses the Area, list those Reservations for the Admin to move, and prevent concurrent Reservation placement into an archived Area. Past Services must still show the archived Area." (:9)
- "Soft deletes — the application will use them; nothing is designed yet." (:5)
- Realtime membership notifications and reconnect catch-up are undecided (:7). Offline access change and Restaurant relocation are undecided (:8).
- "Statements `db diff` misses": DML, `alter policy`, grants, `comment on`, partitions, publications, storage buckets and materialized views do not reach the rolling migration (:6).

### Inferences
- `product.md` is labelled the "predecessor reference" in INDEX.md, but its Tables & Floor Plans chapter describes capabilities the MR code does not implement: Draft/Published versions, Service Floor Plan copies, table capacities and combinations, and automatic assignment. It reads as the complete target feature map, not a description of shipped MR behaviour. (Inferred by comparison with the MR code in Q4.)
- The MVP stories are parity with MR: room objects, positions, rotations, seats, duplicate/rename/reset/switch, joined tables, the live floor, and the kitchen floor view and minimap. Every "physical table record / version / service copy" idea is explicitly future scope.
- The glossary's "Seat numbers stay the same in every Floor layout" is a deliberate departure from MR, where seat numbers were per-map and drag-renumbered (see Q4/Q5). (Inferred.)

### Gaps
- No ADR exists for floor plans. No doc defines what "reset" means for an Overcooked layout: MR's reset restored hard-coded seed geometry, and OC has no seed geometry.
- No doc defines the physical size of a grid cell, nor whether windows, furniture kinds or accessibility belong to MVP.

## Q2 — What is the exact current floor data model? (contracts, Supabase schema, generated types)

### Takeaway
There are four tables: `area`, `dining_table`, `floor_layout` and `floor_layout_table`, plus one enum, `table_shape` (`'round'`, `'rectangle'`). A layout is an integer-cell grid (4–60 × 4–60, default 20×12). Its `content` jsonb holds `{walls, doors, blocks}`. Tables are placed as rows in `floor_layout_table` (`x`, `y`, `width`, `height`, `rotation` 0/90/180/270, `seat_arrangement` jsonb `{sides, order}`).

The Zod contracts validate geometry: bounds, cell overlap between blocks and tables, a unique table per layout, and unique seat numbers. The database enforces only column checks, tenant-scoped composite FKs, admin-only writes, and "a Table may sit on at most one *default* layout across unarchived Areas". Geometry is saved only through the security-definer RPC `save_floor_layout`, which replaces all placements (delete + insert) and takes no version check.

### Cited Findings
**Constants** — [floor.constants.ts:1-9](OC/packages/contracts/src/floor/floor.constants.ts)
- `TABLE_LABEL_MAX_LENGTH = 20`, `TABLE_SEAT_COUNT_MAX = 20`
- `AREA_NAME_MAX_LENGTH = 30`, `FLOOR_LAYOUT_NAME_MAX_LENGTH = 30`
- `FLOOR_LAYOUT_DEFAULT_GRID_WIDTH = 20`, `FLOOR_LAYOUT_DEFAULT_GRID_HEIGHT = 12`
- `FLOOR_GRID_MIN_SIZE = 4`, `FLOOR_GRID_MAX_SIZE = 60`
- `FLOOR_BLOCK_LABEL_MAX_LENGTH = 20`

**Branded IDs:** `AreaId`, `TableId`, `FloorBlockId`, `FloorLayoutId` (each `z.uuid().brand<…>()`) — [floor.primitives.ts:3-13](OC/packages/contracts/src/floor/floor.primitives.ts)

**Schemas (all `z.strictObject`, so unknown keys are rejected)** — [floor.schemas.ts](OC/packages/contracts/src/floor/floor.schemas.ts)
- Enums and scalars:
  - `TableShape = z.enum(Constants.public.Enums.table_shape)` (:16)
  - `Rotation = 0 | 90 | 180 | 270` (:19)
  - `SeatSide = 'top'|'right'|'bottom'|'left'` (:22)
  - `GridAxis = 'horizontal'|'vertical'` (:25)
  - `Cell = z.int().nonnegative()`, `Span = z.int().positive()`, `SeatNumber = z.int().min(1).max(20)` (:28-30)
- `Table` = `{ id: TableId, number: int>0, label: trim 1..20, seatCount: SeatNumber }`. `TableInput` picks `number, label, seatCount`. (:32-41)
- `Area` = `{ id, name: trim 1..30, position: Position (int>0), defaultFloorLayoutId: FloorLayoutId|null, archivedAt: ISO datetime with offset|null }`. `AreaInput = {name}`. `AreaListItem = Area + isUsed: boolean`. (:43-56)
- `GridEdge` = `{ x: Cell, y: Cell, axis: GridAxis, length: Span }`, used for both walls and doors. (:58-64)
- `FloorBlock` = `{ id: FloorBlockId, x, y: Cell, width, height: Span, rotation: Rotation, label: trim 1..20 | null }`. (:66-75)
- `FloorLayoutContent` = `{ walls: GridEdge[], doors: GridEdge[], blocks: FloorBlock[] }`. (:77-82)
- `SeatArrangement` = `{ sides: { seat: SeatNumber, side: SeatSide }[], order: SeatNumber[] }`. (:84-88)
- `FloorLayoutTable` = `{ tableId, shape: TableShape, x, y: Cell, width, height: Span, rotation: Rotation, seatArrangement }`. (:90-100)
- `FloorLayoutDraft` = `{ gridWidth: int 4..60, gridHeight: int 4..60, content, tables: FloorLayoutTable[] }.superRefine(floorLayoutGeometryIssues)`. (:102-112)
- `FloorLayoutListItem` = `{ id, areaId, name: trim 1..30, isDefault, isUsed, archivedAt }`. (:116-124)
- `FloorLayoutInput = {areaId, name}`, `FloorLayoutNameInput = {name}`. (:126-130)
- `FloorLayout` = `{ id, areaId, name, archivedAt, …draft fields }` with the same `superRefine`. (:132-141)

**Geometry refinement `floorLayoutGeometryIssues`** — [floor.logic.ts:86-109](OC/packages/contracts/src/floor/floor.logic.ts)
- Returns early, with no geometry checks, if either grid size is invalid. (:91)
- Every issue is `{ code: 'custom', path }` with no message. (:93) This matches the `no-validation-messages` lint rule in Q3.
- Walls and doors: a horizontal edge is invalid if `x+length > gridWidth || y > gridHeight`; a vertical edge if `y+length > gridHeight || x > gridWidth`. Edges lie on grid lines, so `y == gridHeight` is valid. (:11-15, :100-101)
- Blocks then tables, in one pass: each rectangle must satisfy `x+width ≤ gridWidth` and `y+height ≤ gridHeight`, and may not share any cell with an earlier rectangle. Blocks cannot overlap blocks or tables, and tables cannot overlap each other. (:58-71, :102)
- A repeated `tableId` in one layout is reported. (:103-107)
- Within each table, a repeated seat number in `seatArrangement.sides[*].seat` or in `seatArrangement.order` is reported. (:73-84)

**Not validated anywhere** (observed absences in `floor.logic.ts` and the SQL below)
- Rotation does not change the footprint check: `width` and `height` are used as-is.
- Seat numbers are not checked against `dining_table.seat_count`, only capped at 20.
- `order` need not list every seat; `sides` need not cover every seat.
- Doors need not lie on a wall. Walls and doors may cross tables or blocks.
- A `round` shape with `width ≠ height` is allowed.

**Constraint-name constants** — [floor.constraints.ts:3-11](OC/packages/contracts/src/floor/floor.constraints.ts)
- `AREA_NAME_KEY`
- `FLOOR_LAYOUT_AREA_ID_FKEY` and `AREA_DEFAULT_FLOOR_LAYOUT_ID_FKEY`, both typed `satisfies ForeignKeyName`
- `FLOOR_LAYOUT_AREA_ID_NAME_KEY`
- `FLOOR_LAYOUT_TABLE_TABLE_ID_FKEY`
- `DINING_TABLE_NUMBER_KEY`, `DINING_TABLE_LABEL_KEY`

**SQL tables** — [schemas/floor/tables/*.sql](OC/apps/supabase/schemas/floor/tables/)
- `area`
  - Columns: `id uuid pk default gen_random_uuid()`; `restaurant_id → restaurant(id) on delete cascade`; `name text check (char_length 1..30 and name = btrim(name))`; `position integer not null default 0`; `default_floor_layout_id uuid null`; `archived_at timestamptz null`; `created_at`; `updated_at`.
  - Keys: `unique (restaurant_id, id)`. Unique index `area_name_key on (restaurant_id, lower(name)) where archived_at is null`.
  - Grants: `select, insert (restaurant_id, name), update (name, archived_at), delete`.
  - FK `area_default_floor_layout_id_fkey (id, default_floor_layout_id) → floor_layout (area_id, id)`, so the default must belong to the same Area.
  - — [area.sql](OC/apps/supabase/schemas/floor/tables/area.sql), [floor_layout.sql](OC/apps/supabase/schemas/floor/tables/floor_layout.sql)
- `dining_table`
  - Columns: `id`; `restaurant_id` (cascade); `number integer check (number > 0)`; `label text check 1..20, trimmed`; `seat_count smallint check (seat_count between 1 and 20)`; `created_at`; `updated_at`.
  - Keys: `dining_table_number_key unique (restaurant_id, number)`. Unique index `dining_table_label_key on (restaurant_id, lower(label))`, which is case-insensitive and has no archive filter.
  - There is no `archived_at` or `disabled_at` column.
  - Grants: `insert (restaurant_id, number, label, seat_count)`, `update (number, label, seat_count)`, `delete`.
  - — [dining_table.sql](OC/apps/supabase/schemas/floor/tables/dining_table.sql)
- `floor_layout`
  - Columns: `id`; `restaurant_id` (cascade); `area_id`; `name 1..30 trimmed`; `grid_width smallint check 4..60`; `grid_height smallint check 4..60`; `content jsonb not null default {"walls":[],"doors":[],"blocks":[]} check (jsonb_typeof(content) = 'object')`; `archived_at`; `created_at`; `updated_at`.
  - Keys: `unique (restaurant_id, id)`, `unique (area_id, id)`. FK `floor_layout_area_id_fkey (restaurant_id, area_id) → area (restaurant_id, id) on delete restrict`. Unique index `floor_layout_area_id_name_key on (area_id, lower(name)) where archived_at is null`.
  - Grants: `insert (restaurant_id, area_id, name, grid_width, grid_height)`, `update (name, archived_at)`, `delete`. Clients cannot update `content` or the grid directly.
  - — [floor_layout.sql](OC/apps/supabase/schemas/floor/tables/floor_layout.sql)
- `floor_layout_table`
  - Columns: `id`; `restaurant_id` (cascade); `floor_layout_id`; `table_id`; `shape public.table_shape`; `x ≥ 0`; `y ≥ 0`; `width ≥ 1`; `height ≥ 1`; `rotation smallint default 0 check in (0,90,180,270)`; `seat_arrangement jsonb default {"sides":[],"order":[]}` with an object check; `created_at`; `updated_at`.
  - Keys: `unique (floor_layout_id, table_id)`. FK `(restaurant_id, floor_layout_id) → floor_layout on delete cascade`. FK `floor_layout_table_table_id_fkey (restaurant_id, table_id) → dining_table (restaurant_id, id)` with no ON DELETE clause, so a placed Table cannot be deleted. Index `(restaurant_id, table_id)`.
  - Grants: `select` only.
  - — [floor_layout_table.sql](OC/apps/supabase/schemas/floor/tables/floor_layout_table.sql)
- Enum: `create type public.table_shape as enum ('round', 'rectangle')` — [table_shape.sql](OC/apps/supabase/schemas/floor/types/table_shape.sql)

**RLS policies** — [schemas/floor/policies/*.sql](OC/apps/supabase/schemas/floor/policies/)
- `area`, `dining_table`, `floor_layout`: select uses `is_restaurant_member(restaurant_id)`; insert, update and delete use `has_restaurant_role(restaurant_id, '{admin}')`.
- `floor_layout_table`: only `floor_layout_table_select` (members). All writes go through the RPC.

**Functions** — [schemas/floor/functions/*.sql](OC/apps/supabase/schemas/floor/functions/)
- `save_floor_layout(p_floor_layout_id uuid, p_grid_width smallint, p_grid_height smallint, p_content jsonb, p_tables jsonb) returns void`, security definer, `search_path=''`. In order, it:
  - takes `select … for update` on the layout row;
  - raises `P0002` if the layout is missing, `42501` unless `has_restaurant_role(…,'{admin}')`, and `22023` if `p_tables` is not an array;
  - updates `grid_width`, `grid_height` and `content`;
  - **deletes all** `floor_layout_table` rows for the layout;
  - re-inserts from `jsonb_to_recordset(p_tables)` with columns `(table_id uuid, shape table_shape, x, y, width, height, rotation smallint, seat_arrangement jsonb)`.

  Execute is granted to `authenticated`. It does not check `archived_at`, does not validate the content shape, and takes no expected-version or `updated_at` argument. Placement row ids are regenerated on every save. — [save_floor_layout.sql](OC/apps/supabase/schemas/floor/functions/save_floor_layout.sql)
- `set_default_floor_layout(p_floor_layout_id)`: security definer, admin-only. It refuses an archived layout ('An archived Floor layout cannot be the default', `23514`) and sets `area.default_floor_layout_id`. — [set_default_floor_layout.sql](OC/apps/supabase/schemas/floor/functions/set_default_floor_layout.sql)
- `check_default_floor_layout_tables(p_restaurant_id)`: locks the restaurant row `for no key update`, then raises `23514` 'Table % is on more than one default Floor layout' (with `hint = label`) if any `dining_table` appears on more than one default layout of an *unarchived* Area. It is invoked by the trigger function `enforce_default_floor_layout_tables`. — [check_default_floor_layout_tables.sql](OC/apps/supabase/schemas/floor/functions/check_default_floor_layout_tables.sql)
- `prevent_default_floor_layout_archive` (security invoker): 'A default Floor layout cannot be archived' (`23514`).
- `assign_first_default_floor_layout`: an Area's first layout becomes its default.
- Internal functions have `revoke execute … from public, anon, authenticated, service_role, supabase_auth_admin`.

**Triggers** — [schemas/floor/triggers/*.sql](OC/apps/supabase/schemas/floor/triggers/)
- `tr_floor_layout_first_default`: after insert on `floor_layout`.
- `tr_floor_layout_keep_default`: before update of `archived_at`.
- `tr_area_default_tables`: after update of `default_floor_layout_id, archived_at` on `area`.
- `tr_floor_layout_table_default_tables`: after insert or update on `floor_layout_table`.
- `tr_area_position`: before insert; uses `set_position_at_end('restaurant_id')`.
- `updated_at` triggers on all four tables.

**Generated types and the Deno mirror**
- `Database['public']['Tables']` Row fields, alphabetical:
  - `area`: `archived_at, created_at, default_floor_layout_id, id, name, position, restaurant_id, updated_at`
  - `dining_table`: `created_at, id, label, number, restaurant_id, seat_count, updated_at`
  - `floor_layout`: `archived_at, area_id, content: NonNullable<Json>, created_at, grid_height, grid_width, id, name, restaurant_id, updated_at`
  - `floor_layout_table`: `created_at, floor_layout_id, height, id, restaurant_id, rotation, seat_arrangement: NonNullable<Json>, shape: Enums['table_shape'], table_id, updated_at, width, x, y`
- `Relationships` list the composite FKs.
- Functions: `save_floor_layout.Args {p_content: Json, p_floor_layout_id, p_grid_height, p_grid_width, p_tables: Json}`, `set_default_floor_layout.Args {p_floor_layout_id}`, both returning `undefined`.
- `Enums.table_shape: "round" | "rectangle"`.
- — [generated/database.types.ts:103-151, 250-290, 853-965, 1861-1906, 2231](OC/packages/contracts/src/generated/database.types.ts)
- The edge-function mirror `apps/supabase/functions/_shared/contracts/floor/` is byte-identical to `packages/contracts/src/floor/` (`diff -rq` found no differences). — [functions/_shared/contracts/floor](OC/apps/supabase/functions/_shared/contracts/floor/)

**Seed:** the only floor data seeded is `insert into public.area (restaurant_id, name) values (v_restaurant_id, 'Dummy Terrace')` for "Dummy Bistro". No tables, layouts or placements are seeded. — [seeds/seed.sql:89-90](OC/apps/supabase/seeds/seed.sql)

### Inferences
- Seats are not rows. A Seat is a number 1..`seat_count` on the Table, and per layout the only seat geometry is a side (top/right/bottom/left) per seat number plus a free `order` list. There are no seat coordinates, no offset along a side, and no round-table angles. (Inferred from `SeatArrangement`.)
- Joined or combined tables are absent from the model: no combination or group table, no `members`, no join capacity. (Inferred.)
- The "Table may sit on at most one default layout across Areas" rule lets the Service floor be the union of the Areas' defaults without double-booking a physical table. It is weaker than versioning: changing an Area's default is an instant, global, unversioned switch, with no per-date or per-service binding (MR had `activeDiningByDate`, Q4). (Inferred.)
- Geometry validity depends on clients parsing `FloorLayoutDraft`. Any Admin can call `save_floor_layout` directly with arbitrary JSON. The DB enforces only `jsonb_typeof = 'object'` for `content`, plus column checks on placements; it does not check placements against grid bounds or seat counts. (Inferred from the SQL.)
- `updated_at` exists on every floor table but nothing reads it for compare-and-set. `save_floor_layout`'s row lock serialises writers, but the last writer still silently wins: the same bug class as MR's FLOOR-EDITOR-1, now on the server (Q4). (Inferred.)

### Gaps
- No contract, DB or client tests for floor geometry were found. `apps/supabase/AGENTS.md` says "No tests are set up for either".
- The physical size of a grid cell, how rotation of a non-square table is rendered, and the coordinate origin are unspecified: no renderer exists to settle them.
- `Position` is `z.int().positive()` in contracts, while `area.position` defaults to `0` in SQL. I assume `set_position_at_end` always assigns ≥1 but did not read that function.

## Q3 — What floor UI exists in the new client, and which architecture rules constrain new UI?

### Takeaway
The client's floor layer (`apps/client/layers/floor`, component prefix `Floor`, about 2,200 lines across 46 files) is CRUD only:
- Areas: list, create, rename, drag-reorder, archive/restore, delete.
- Floor layouts: create with Area and name at the default 20×12 grid, rename, make default, archive/restore, delete.
- Tables: number, label and seat count, paginated search.

There is no canvas, no geometry or seat editing, no read of `content`, `grid_*` or `floor_layout_table`, and nothing calls `save_floor_layout`. The Service, Kitchen and Reservations pages are empty shells. A new editor must follow strict layering, contract-derived validation, Nuxt UI wrapper usage, VueUse-only browser APIs, semantic colours and i18n rules, many of them enforced by ESLint.

### Cited Findings
**Pages**
- `/admin/tables` (nav order 3, icon `table`) renders `<FloorTableList>`.
- `/admin/areas` (order 4, icon `floorPlan`) renders `<FloorAreaList can-manage>`.
- `/admin/floor-layouts` (order 5, icon `layouts`) renders `<FloorLayoutList can-manage :areas-location>`.
- `admin.vue`: `access: { roles: ['admin'] }`.
- `service.vue` and `reservations.vue`: `access: { roles: ['admin','front_of_house'] }`, rendering only `<BaseAppShell :title=…/>`. `kitchen.vue` (`KITCHEN_ACCESS`) is also shell-only.
- — [pages/admin/*.vue, service.vue, kitchen.vue, reservations.vue](OC/apps/client/app/pages/)

**Layout repository** — [layout.repository.ts](OC/apps/client/layers/floor/app/repositories/layout.repository.ts)
- `LAYOUT_COLUMNS = 'id, area_id, name, archived_at, area:area!floor_layout_area_id_fkey(default_floor_layout_id)'`.
- Functions: `listLayouts`, `createLayout` (inserts `grid_width: FLOOR_LAYOUT_DEFAULT_GRID_WIDTH`, `grid_height: FLOOR_LAYOUT_DEFAULT_GRID_HEIGHT`), `renameLayout`, `setDefaultLayout` (`rpc('set_default_floor_layout')`), `archiveLayout`, `restoreLayout`, `deleteLayout`.
- A grep of `apps/client` for `save_floor_layout|seat_arrangement|floor_layout_table|FloorLayoutDraft|FloorBlock|GridEdge` matched only that one `grid_width` insert line.

**Layout mapper and row actions**
- The mapper sets `isUsed: isDefault`, so "used" means only "is the default", because nothing else references layouts yet. — [layout.mappers.ts](OC/apps/client/layers/floor/app/repositories/layout.mappers.ts)
- `getLayoutRowActions`:
  - archived: `['restore']`, plus `'delete'` if unused
  - default: `['edit']` (rename only)
  - otherwise: `edit, makeDefault, archive`, plus `delete` if unused

  — [layout.logic.ts](OC/apps/client/layers/floor/app/lib/layout/layout.logic.ts)

**Areas and Tables**
- Areas: the list selects `layouts:floor_layout!floor_layout_area_id_fkey(id)` to compute `isUsed`. Reorder uses `rpc('reorder_positions', { p_table: 'area', p_ordered })`. Error messages map `FLOOR_LAYOUT_AREA_ID_FKEY` to "This Area has Floor layouts. Archive it instead." — [area.repository.ts](OC/apps/client/layers/floor/app/repositories/area.repository.ts), [area.messages.ts](OC/apps/client/layers/floor/app/lib/area/area.messages.ts), [en.ts](OC/apps/client/layers/floor/i18n/locales/en.ts)
- Tables:
  - The list is paginated; search is a `label ilike` or exact `number`.
  - `getNextTableNumber` suggests max+1. `TABLE_DEFAULT_SEAT_COUNT = 2`.
  - Deleting a placed table fails via `FLOOR_LAYOUT_TABLE_TABLE_ID_FKEY`, shown as "This Table is on a Floor layout. Remove it from the Floor layout first."

  — [table.repository.ts](OC/apps/client/layers/floor/app/repositories/table.repository.ts), [table.constants.ts](OC/apps/client/layers/floor/app/lib/table/table.constants.ts), [table.messages.ts](OC/apps/client/layers/floor/app/lib/table/table.messages.ts)
- User-facing rules already in i18n:
  - "{name} and its Floor layouts will be hidden from planning and Service." (archive Area)
  - "Table {label} is already on the default layout of another Area." (make-default error, mapped from the DB `23514` hint)
  - "This is the default layout. Make another layout the default first."

  Locales are `en` and `sl`; the app's `defaultLocale` is `'sl'`. — [en.ts](OC/apps/client/layers/floor/i18n/locales/en.ts), [apps/client/nuxt.config.ts](OC/apps/client/nuxt.config.ts)

**Stack**
- Client: `ssr: false` (SPA); modules `@nuxt/ui`, `@nuxtjs/supabase` (types `'@repo/contracts/generated'`), `@nuxtjs/i18n`, `@pinia/nuxt`, `@vueuse/nuxt`, `@nuxt/eslint`. — [apps/client/nuxt.config.ts](OC/apps/client/nuxt.config.ts)
- Catalog versions: nuxt 4.6.4, @nuxt/ui 4.12.0, vue 3.5.44, zod 4.6.7, tailwindcss 4.3.3, pinia 4.1.0, @supabase/supabase-js 2.118.0, @vueuse/* 15.0.0. No canvas, SVG or geometry library appears in client dependencies. — [pnpm-workspace.yaml](OC/pnpm-workspace.yaml), [apps/client/package.json](OC/apps/client/package.json)
- Floor layer config: `components: [{ path: 'components', prefix: 'Floor' }]`, `imports.dirs: ['composables/**']`. — [layers/floor/nuxt.config.ts](OC/apps/client/layers/floor/nuxt.config.ts)
- Shared icons: `floorPlan: 'i-lucide-layout-grid'`, `layouts: 'i-lucide-panels-top-left'`, `table: 'i-lucide-armchair'`. — [icons.constants.ts](OC/apps/client/layers/shared/app/utils/icons.constants.ts)
- Editor precedent: the menu-layout repository also only does list/create/rename/archive/delete and never calls `save_menu_layout`, so the jsonb-content visual editor for Menu layouts is not built either. — [menu-layout.repository.ts](OC/apps/client/layers/catalog/app/repositories/menu-layout.repository.ts)

**AGENTS.md rules that bind a new editor**
- [apps/client/AGENTS.md](OC/apps/client/AGENTS.md):
  - "Keep presentation and local interaction state in components. Obtain domain decisions from the layer's `*.logic.ts` predicates or props."
  - "Keep reactive state and orchestration in composables… Put domain calculations in `*.logic.ts`, even with one caller."
  - "Read with `useAppAsyncData` by default… Key every read from the domain's `<DOMAIN>_ASYNC_DATA_KEY` map." Today `FLOOR_ASYNC_DATA_KEY` has only `areas`, `layouts` and `tables`. — [floor.constants.ts](OC/apps/client/layers/floor/app/lib/floor.constants.ts)
  - "Derive form validation from contracts. Keep client-only additions in the feature's `*.schemas.ts`. Do not repeat contract rules."
  - "Put error messages in `<FEATURE>_ERROR_MESSAGES`…"
  - "When an action needs confirmation, await `confirmAction(options)`…"
  - "Domains read the active restaurant id through `useActiveRestaurantId()`."
  - "Read `useAuth()` only in the shell."
  - "Give read-only viewers a `canManage` prop instead of another mode."
  - "Do not edit generated types."
- [layers/AGENTS.md](OC/apps/client/layers/AGENTS.md):
  - "Add work to an existing domain. When no domain owns the vocabulary and data, ask the user before creating a domain."
  - "Do not repeat domain names in component names (The layer adds the domain prefix)."
  - Placement table: components `components/<Feature>/<Subfeature>/`; lib `lib/<feature>/<subfeature>/<feature>-<subfeature>.<kind>.ts`; composables `composables/<feature>/<subfeature>/`, named `use<Domain><Feature><Subfeature><Role>.ts`. A sub-level is allowed only "for a sub-feature that owns its own state or rules".
  - lib kinds are limited to `logic`, `types`, `constants`, `mappers`, `schemas`, `messages`.
  - "Use at most one domain store for state shared by several features or the shell."
  - "Add a port only when a caller needs access across the layer boundary."
- [app/AGENTS.md](OC/apps/client/app/AGENTS.md): to resolve dependencies between domains, "Use the first option that works": (1) compose both domains in a page or app component through props and events; (2) move a stable concept to shared code; (3) a port in the domain, implemented by the shell; (4) an event as last resort; (5) ask about merging layers.
- [pages/AGENTS.md](OC/apps/client/app/pages/AGENTS.md): "Keep pages thin."
- [packages/AGENTS.md](OC/packages/AGENTS.md): "Do not change shared ESLint rules."

**ESLint guardrails (`sound-arch/*` plugin plus app rules)**
- `client-restrictions`:
  - "Components must not import repositories/gateways directly; use a composable."
  - "Mappers must not import Vue, Pinia, Nuxt auto-imports, or gateways."

  — [client-restrictions.ts](OC/packages/eslint-plugin/src/nuxt-rules/client-restrictions.ts)
- `usage-selectors`:
  - "Components must not use stores; read state through composables."
  - Raw `addEventListener`, `removeEventListener`, `setTimeout`, `setInterval`, `localStorage` and `sessionStorage` are banned: "Use VueUse: useLocalStorage/useSessionStorage, useEventListener, useTimeoutFn/useDebounceFn/refDebounced, useIntervalFn."

  — [usage-selectors.ts:26-46](OC/packages/eslint-plugin/src/nuxt-rules/usage-selectors.ts)
- Rule descriptions in the nuxt-rules folder:
  - `component-properties`: "Require component props to be a local *Properties interface"
  - `layer-imports`: "Enforce cross-layer imports go through the imported layer port"
  - `no-cross-layer-auto-imports`: "Ban auto-imported composables and components of another domain layer"
  - `no-raw-color-classes`: "Ban raw Tailwind color-scale utilities in class/:class attributes"
  - `no-overlay-open-state`: "Ban open state bindings on modal, slideover, and drawer elements"
  - `no-relative-imports`: "Require absolute imports in the client app and layers"
  - `locale-keys`: "Require layer locale files to have the layer domain as single root key"
  - `subfeature-files`: "Require sub-feature lib filenames to use the feature and sub-feature prefix"

  — [nuxt-rules/](OC/packages/eslint-plugin/src/nuxt-rules/)
- Package rules:
  - `contracts-barrel` (only re-exports)
  - `contracts-imports`: "Contracts must use portable ECMAScript imports."
  - `no-validation-messages`: "Keep contract validation messages in client i18n"
  - `no-enum`: "Use a const object with a derived union type instead of enum."

  — [package-rules/](OC/packages/eslint-plugin/src/package-rules/), [no-enum.ts](OC/packages/eslint-plugin/src/general-rules/no-enum.ts)
- App rules:
  - `no-raw-sortable`: `sortablejs` and `@vueuse/integrations/useSortable` imports are banned outside `layers/shared/app/composables/useSortableList.ts` ("Use useSortableList for drag-to-reorder.").
  - `no-raw-ui-elements`: `UModal` → "Use BaseModal for domain modals."; `USlideover` → "Use BaseSlideover."; `UTable` → "Use BaseTable."
  - `no-raw-ui-composables`: `useToast` → `useAppToast()`; `useOverlay` → `useAppOverlay`.

  — [no-raw-sortable.ts](OC/apps/client/eslint/rules/no-raw-sortable.ts), [no-raw-ui-elements.ts](OC/apps/client/eslint/rules/no-raw-ui-elements.ts), [no-raw-ui-composables.ts](OC/apps/client/eslint/rules/no-raw-ui-composables.ts)
- Other app rules exist that I did not read: `no-raw-icons`, `no-raw-enum-items`, `no-unwrapped-requests`, `no-row-types`, `no-inline-error-messages`, `no-provider-error-mapping`, `message-tables`, `form-schema`, `repository-usage`, `page-usage`, `layer-usage`, `component-usage`. — [apps/client/eslint/rules/](OC/apps/client/eslint/rules/)
- Folder kinds owned by a layer: `'lib', 'components', 'composables', 'stores', 'repositories', 'gateways'`. — [project-layout.ts:15](OC/packages/eslint-plugin/src/structure/project-layout.ts)
- Skeleton decision: "Repositories + gateways are the only backend doors. Reason: single data-access seam; enables the future offline swap. Codified in ESLint." — [repo-skeleton.shaping.md:152](OC/.docs/internal/_archive/repo-skeleton.shaping.md)

### Inferences
- A floor editor fits the existing Layout feature as a sub-feature. Plausible names (unverified): component `layers/floor/app/components/Layout/Editor/*.vue` (auto-named `FloorLayoutEditor…`), composables `composables/layout/editor/useFloorLayoutEditor<Role>.ts`, pure geometry ops in `lib/layout/editor/layout-editor.logic.ts`. MR's pure `state → state` op style (Q4) maps cleanly onto the `*.logic.ts` rule. (Inferred from the placement table.)
- Canvas drag is not "drag-to-reorder", so `no-raw-sortable` does not apply to it. Pointer and keyboard listeners must still go through VueUse (`useEventListener` and similar). No rule bans raw `<svg>` in templates. Colours must be semantic Nuxt UI tokens, because raw Tailwind colour scales are linted out. (Inferred from the rule texts above.)
- Validation should reuse the `FloorLayoutDraft` `superRefine` paths and map them to i18n messages client-side, because contracts must not carry messages. (Inferred.)
- A Service or Kitchen floor view that needs reservation or live-party data from another domain must be composed in the shell page through props and events, or through a port. A floor-layer component cannot import another domain's composables. (Inferred from the `app/AGENTS.md` workflow and `no-cross-layer-auto-imports`.)

### Gaps
- I did not read the full text of the unread app rules listed above. They may constrain icons, request wrapping and repository usage in an editor.
- There is no canvas or editor component anywhere in the client to copy patterns from, and the menu-layout visual editor is equally unbuilt.

## Q4 — How did Milka RIS model and edit floor maps; what were its features and known problems?

### Takeaway
MR stored every map in one whole-JSON `service_settings` row, `floor_maps_v1`, written whole on each gesture through `stateStore`/PowerSync.
- Geometry used a 100×92 unit viewBox. Tables were keyed by **label**, with explicit `boardIds` claims onto the fixed integer board slots and `members` for merges.
- Seats were `side`+`offset` (rectangles) or `angle` (rounds). Each map carried an architecture `sheet` of wall polylines, door and passage openings, hatched zones and planters.
- There were several maps (dining Layout A/B plus Terrace), a per-day active dining layout, and a layout-switch planner run against reservations.
- The SVG editor offered SELECT/MOVE/WALL/DOOR/ZONE/PLANT tools, an inspector, magnetic snapping, tap-sequence seat renumbering, merges, duplicate/reset map, and a per-device mirror view.

Its own 2026-07 audit rates the core persistence model critical: whole-blob last-writer-wins with offline replay, no draft/publish/undo/history, and a non-atomic layout switch. Label-identity fragility, grouped-table moves that "vanish" parties, and no overlap detection are further high-severity findings.

### Cited Findings
**Data model**
- File header: maps live in "the `floor_maps_v1` service_settings row (written through lib/stateStore — the PowerSync seam — never directly)". "The dining board itself stays the fixed 10-slot service_tables grid; a map 'logical table' points at the board slot(s) it occupies via `boardIds`. Merges are explicit (`members`), and boardIds are explicit PER TABLE rather than derived from members". Example: in Layout B the T6+T7 merge claims slot 6 only, while a round two-top "T7" claims 7. — [floorMaps.js:1-13](MR/src/utils/floorMaps.js)
- `FLOOR_MAPS_KEY = "floor_maps_v1"`, `FLOOR_STATUS_KEY = "floor_status_v1"`, `MAP_W = 100`, `MAP_H = 92`, `GEOMETRY_VERSION = 3` ("v3: seed sheets (walls / doors / zones / planters)"). — [floorMaps.js:16-28](MR/src/utils/floorMaps.js)
- Seat encoding: rectangle seat `{no, side: N|S|W|E, offset}`; round seat `{no, angle}` (0 = N, clockwise); optional `confirm: true` marks numbering "unmarked on the diagrams". — [floorMaps.js:30-42](MR/src/utils/floorMaps.js)
- Sheet shape: `{ walls: [{id, pts: [[x,y]…], closed, dashed}], openings: [{id, wallId, seg, t, width, kind: "door", swing, hinge}], zones: [{id, x, y, w, h, label}], planters: [{id, x, y, r}] }`. Openings are "cut INTO a wall segment (position t along the segment, width in map units)" and render "as a door leaf + swing arc or as a plain passage with jamb ticks". — [floorMaps.js:44-61, 664-700](MR/src/utils/floorMaps.js)
- Seeds: `dining_a` "LAYOUT A" (T1, T2-3 merge `members ["T2","T3"]`, `boardIds [2,3]`, T4–T10 with rounds T5/T9/T10), `dining_b` "LAYOUT B" (T6-7 merge claims [6], round T7 claims [7], T9 with 3 seats), `terrace_main` "TERRACE" (T21–T26, no `boardIds`). Default `activeDiningMapId: "dining_a"`. The dining sheet has a "PASS / KITCHEN" zone; the terrace has dashed walls and 3 planters. — [floorMaps.js:63-137](MR/src/utils/floorMaps.js)
- Stored shape per plan: `{ geometryVersion, maps: [{ id, kind, name, tables: [{ label, shape, x, y, w, h, boardIds?, members?, seats, … }], sheet? }], activeDiningMapId, config: { moveSingleTap } }`. "No Postgres change. `service_settings` is k/v". — [FLOOR_FIRST_PLAN.md §2a](MR/docs/FLOOR_FIRST_PLAN.md)
- Per-day layout: `activeDiningByDate` overrides the default for one service day, added after a 12.08 report: "the floor editor doesn't let me use a different layout for today's service because it wouldn't function on tomorrow's". `DAY_BINDING_KEEP = 120`. — [floorMaps.js:160-203](MR/src/utils/floorMaps.js)

**Reservation and board resolution**
- `resolveReservationTable`: an exact label `T${tableId}` beats a member match; no match means NEEDS TABLE. — [floorMaps.js:216-228](MR/src/utils/floorMaps.js)
- `labelBoardIds` fallback reads "T4" / "T2-3" when there are no explicit claims. It was added after "activating a new dining room rendered every table dead mid-service: no seats, no status, no SET (15.07 incident)". — [floorMaps.js:230-249](MR/src/utils/floorMaps.js)
- `mapSeatCountForBoardTable` caps the restriction seat selector by the map's chair count ("T9 offers 3 seats under Layout B, only 2 under Layout A"). — [floorMaps.js:251-258](MR/src/utils/floorMaps.js)

**Layout switch planning** — [floorMaps.js:260-338](MR/src/utils/floorMaps.js)
- `planLayoutSwitch(nextMap, reservations, tables)` returns rows with status `move | unchanged | needs_table | conflict`.
- Conflicts are keyed by `${date}:${session}:${slot}`.
- `seated` flags parties whose live state moves with them.
- `layoutSwitchBlockers` blocks only the current service day.
- `applyLayoutSwitchRow` sets `table_id = to[0]` and `data.tableGroup = to` for multi-slot claims.

**Seat geometry and renumbering**
- `seatDisplayPoints`: "Chairs are ALWAYS perfectly distributed — the stored positions only decide ORDER". Seats on a rectangle side are spread evenly. A round ring's rotation is fitted by circular mean and snapped to 15°. The code notes a 12.08 floating-point tie bug that tilted T9's chairs. — [floorMaps.js:340-405](MR/src/utils/floorMaps.js)
- `assignSeatNumbers`: tap chairs in sequence; numbers commit only when every seat is tapped; an explicit renumber clears CONFIRM. — [floorMaps.js:407-424](MR/src/utils/floorMaps.js)

**Editor ops (pure `state → state`; an invalid op returns the same object)** — [floorMaps.js:426-662](MR/src/utils/floorMaps.js)
- Tables:
  - `moveTable`: 1-unit snap, magnetic edge alignment `MAGNET = 1.5`, chair-clearance stops `CHAIR_CLEARANCE = 11`, canvas clamp.
  - `resizeTable` (`MIN_SIDE = 4`); `rotateTable` swaps `w`/`h`; `setTableShape` takes `rect|round`.
  - `renameTable`: uppercase; unique among labels *and merge members*.
  - `duplicateTable`: drops `boardIds`/`members`; label gets a prime (`T4'`).
  - `addTable`: first free T-number, at a fixed spot (44,40), 12×9, 2 seats.
  - `deleteTable`.
- Seats:
  - `addSeat` places new seats on a rotating side or angle.
  - `removeSeat` compacts numbering to 1..n.
  - `moveSeat`: magnetic stops at 0.22/0.5/0.78 offsets, otherwise a 0.05 grid; rounds snap to 15°; "moving is not renumbering".
- Merges: `setTableMembers` (a single member is allowed as "a merge under construction") and `setTableBoardIds` (1..999).
- Sheet and maps:
  - Sheet ops: `addWall`, `setWallDashed`, `deleteWall` (takes its openings with it), `addDoorAt` (nearest wall segment within 6 units), `patchOpening`, `deleteOpening`, `addZoneAt`/`patchZone`/`deleteZone`, `addPlanterAt`/`patchPlanter`/`deletePlanter`. `hitTestSheet` precedence: doors → planters → zones → walls.
  - `mirrorFloorMap`: a render-time reflection per device (`upDown`/`leftRight`); "Stored maps are never mirrored".
  - Map ops: `addMap(kind)`, `renameMap`, `duplicateMap` (how "LAYOUT C" nights are made), `deleteMap` (the last map of a kind is undeletable; deleting the active dining map falls back to another), `resetMapToDefaults` (seed maps only).

  — [floorMaps.js:695-1049](MR/src/utils/floorMaps.js)

**Floor status and ticker** — [floorMaps.js:1051-1178](MR/src/utils/floorMaps.js)
- `floor_status_v1 = { [mapId]: { [label]: 'SET' } }`. "DIRTY was removed per Djan; stored DIRTY values from older builds sanitize away on load." The plan originally had SET|DIRTY and a strip that cycled `— → DIRTY → SET → —`. — [FLOOR_FIRST_PLAN.md §2b](MR/docs/FLOOR_FIRST_PLAN.md)
- `pruneFloorStatus` exists because re-minted labels showed "a SET the table never earned, and sendableIds forwarded it to the kitchen as a phantom SET".
- `renameFloorStatusLabel` exists because without it "a live hands-call [was] silently lost mid-service, 15.07 audit".
- `clearStripsForBoardGroup` drops strips when the announced course fires.
- `mapTicker` produces COVERS · SEATED · RES · SET counts; `terraceOccupancy` is derived from reservations.

**Editor UI**
- `FloorEditor.jsx` is "an ADMIN surface (mounted in the Floor & Terrace panel; the FOH floor view is service-only)". Two layers: TABLES (tap to select → inspector; "Dragging tables is armed by the MOVE tool only… so a stray touch can't rearrange the room"; RENUMBER switches to seats mode) and SHEET.
  - Tools: SELECT, MOVE, WALL ("tap to place points (ortho snap) — CLOSE makes a room, END a partition"), DOOR ("tap a wall to cut an opening with a swing arc"), ZONE, PLANT.
  - Banner "NEW DEFAULT GEOMETRY AVAILABLE — RESET MAP" when the stored `geometryVersion` is older than the code's.
  - Canvas height 420 px on mobile, 640 px otherwise.

  — [FloorEditor.jsx](MR/src/components/floor/FloorEditor.jsx)
- `FloorMap.jsx` is "THE floor renderer. Every spatial surface (FOH floor view, terrace picker, kitchen floor view, admin seats editor, geometry editor) renders through this one component; do not fork it — add a mode instead". Modes: `view`, `picker`, `seats`, `service`, `edit`.
  - Drag previews commit on pointer release ("exactly one updateFloorMaps persist").
  - `getScreenCTM` client-to-viewBox conversion.
  - An iOS Safari workaround: "iOS Safari ignores touch-action on SVG *children*", so a manual non-passive `touchmove` listener blocks scrolling while a drag is armed.
  - Per-label presentation `status: 'free'|'occupied'|'reserved'` and `strip: 'SET'|null`.

  — [FloorMap.jsx:8-24, 170-263](MR/src/components/floor/FloorMap.jsx)
- `FloorInspector.jsx`:
  - Table ops: rename, shape, size, rotate, duplicate, delete, seats, merge claims.
  - Map ops: rename, add table, add/duplicate/delete/reset map.
  - "Destructive actions are two-step (tap once → CONFIRM) instead of a modal"; "Editing members/boardIds re-runs the layout-switch resolver on tonight's reservations".
  - Label-fallback claims render dashed.
  - It warns when a destructive edit hits a slot with a live party (the "NOT ON THIS MAP" banner).

  — [FloorInspector.jsx:16-25, 89-99, 251-254, 322-326](MR/src/components/floor/FloorInspector.jsx)
- `FloorPanel.jsx` has three seams:
  - "ACTIVE LAYOUT: exactly one dining map is active per service (manual pre-service toggle). Switching re-resolves tonight's reservations and shows the confirm diff (moves / conflicts / NEEDS TABLE) BEFORE applying"
  - GEOMETRY (the FloorEditor)
  - terrace flow config

  Only today's unresolved rows block a switch; activation binds that day only; it re-plans at confirm time. — [FloorPanel.jsx:10-31, 54-57](MR/src/components/admin/FloorPanel.jsx)
- Design history: the floor began as a FOH view with an EDIT toggle. A post-merge revision moved geometry editing "inside the admin Floor & Terrace panel… The FOH floor view is strictly service-only", because "There are **no enforced per-user roles yet**" at the time. Rotate meant swapping `w`/`h`; snap was 1 map unit (≈4 px on a 390 px phone). — [FLOOR_FIRST_PLAN.md §1 A2, A5](MR/docs/FLOOR_FIRST_PLAN.md)
- PRODUCT_ROADMAP item 0.4: "**Configurable floor plan — DONE for the pilot.** The table set (ids + labels) is per‑workspace in `restaurant_config_v1`; the DB check is now `table_id BETWEEN 1 AND 999` and the client caps a configured floor at 60 tables. Zones/sections are still not modelled." — [PRODUCT_ROADMAP.md:77](MR/docs/PRODUCT_ROADMAP.md)
- V2 design audit:
  - "**One table, three unrelated drawings.** The same table renders as a board card (RESERVED chip + SEAT), a floor shape (dashed outline), and kitchen P1/P2 chips".
  - The floor map is "The strongest current screen; v2 builds on it."
  - Principles: "One table entity, three projections"; "14 px operational floor, 48 px tap targets"; signal colours gold/red/green only.

  — [V2_DESIGN_RESEARCH.md](MR/docs/V2_DESIGN_RESEARCH.md)

**Known problems (MR's own audit, 2026-07-19)** — [APP_ANALYSIS_2026-07.md:132-200](MR/docs/APP_ANALYSIS_2026-07.md)
- E1 (Critical, verified): "The entire multi-map model is **one settings blob written whole on every gesture**, unconditional upsert, offline replay with no staleness bound… Two admins editing different maps erase each other's entire work; a stale iPad reconnecting hours later overwrites a redesign with its old blob. No undo, no draft/publish, no history."
- E2 (High): "Layout switch is non-atomic across three persistence domains (board rows → reservations → activation flag…)."
- E3 (High): "A confirmed switch **silently skips blocked moves** (`console.warn`, still returns `ok:true`)."
- E4 (High): "Deleting the active dining map bypasses the entire guarded switch flow."
- E5 (High): "`renameTable` checks label uniqueness against table labels but not merge *members*… Nothing prevents two tiles claiming the same `boardId`." The current code has since added the member check. — [floorMaps.js:507-523](MR/src/utils/floorMaps.js)
- E6 (High): planning "only sees the **active session of the current day**".
- E7 (Medium): "no collision/overlap detection, `+ TABLE` stamps every new table at the same spot, magnet snap invisible until finger lift, walls immutable after placement, geometry edits during a test service silently discarded."
- Recommended direction: split the blob ("one row per map… Add an `updated_at` CAS like the board rows"), "Make layout switch one transaction-shaped operation", route active-map deletion through the guarded flow, then "undo stack over the pure-op layer (it's already pure — an op log is cheap), overlap warnings, spawn-position offsets".
- F1 (Critical, verified): "**Moving/swapping a combined (tableGroup) booking makes the party vanish** from board, kitchen tickets and floor."
- F4 (High): "Floor SET strips and `reservations.data` are whole-blob LWW across devices".
- F5 (Medium): chair-identity residue; "move/swap doesn't carry tile-scoped state (SET strip stays on the old tile, chair placements silently lost)".
- F6 (Medium): terrace flow gaps, including "two offline devices can seat different parties on the same table (occupancy check is local-only)".
- The 17-finding floor-editor appendix titles include: FLOOR-EDITOR-8 (closure-scope blobs clobber concurrent edits after an await), -9 ("Silent fallback to seed defaults when the boot read fails — the next edit overwrites the real maps with defaults"), -10 (edits during a TEST SERVICE discarded), -11 ("No undo, no draft/publish — every gesture is instantly live on every device"), -12 (no overlap detection), -13 (60 s echo guard compares device wall clocks), -14 (out-of-range board-slot claims invisible). — [APP_ANALYSIS_2026-07.md:831-880](MR/docs/APP_ANALYSIS_2026-07.md)
- Nuance flagged at design time: "dining layouts A and B do not share strips, so a DIRTY set under Layout A is not visible after a switch to Layout B. Layout switches are pre-service, so accepted." — [FLOOR_FIRST_PLAN.md §2b](MR/docs/FLOOR_FIRST_PLAN.md)
- Concurrency baseline: "if two people edit the exact same seat at the same time, the last committed edit wins. Different-seat edits are merged and preserved". This protection covers board rows only. — [REWORK_NOTES.md](MR/REWORK_NOTES.md), [FAILURE_LOG.md:50](MR/docs/FAILURE_LOG.md), [APP_ANALYSIS_2026-07.md:32](MR/docs/APP_ANALYSIS_2026-07.md)

### Inferences
- MR's root fragility was identity. Labels keyed statuses, merges, renumbering and the bridge to fixed integer board slots, which produced shadowing, orphaned or phantom SET strips, "dead" editor-built tables and party-vanishing group moves. OC's UUID `TableId` with stable seat numbers addresses this class directly. (Inferred from the incident comments plus the OC model.)
- MR's best transferable asset is the pure, tested `state → state` op layer plus a single renderer with modes. Its biggest anti-patterns are whole-blob persistence and an instantly-live editor. (Inferred from the audit.)
- MR's geometry is richer than OC's: continuous 0–100 units versus integer cells; door swing arcs on wall segments versus unit-length edges; zones and planters versus generic labelled blocks; seat offsets and angles versus sides only. (Inferred comparison.)

### Gaps
- I did not read TERRACE_FLOW_PLAN.md or the `visit_state` terrace machine in detail.
- I read only the first 14 of the 17 floor-editor findings. MR's `stateStore` and PowerSync code was not inspected directly; its behaviour comes from the audit text.

## Q5 — How do the floor plan and seats connect to the rest of each app, and where are the gaps against the vision?

### Takeaway
**Connections.** In MR, the floor is a projection over two things: the board (`service_tables` rows whose `data` JSON holds the seats, with restrictions, water, pairings, pour mode, extras, gender, LH and birthday) and the reservations (`table_id` plus `data.tableGroup`). The FOH floor, dock, kitchen floor view, minimap, seat caps and layout switch all derive from it. In OC, nothing downstream exists yet: no reservation, service, party, seat, ticket or per-seat menu schema references `dining_table` or `floor_layout`. The only stated link is "its default layout is the one a Service uses".

**Gaps against the vision.** Windows, furniture kinds, seat positions, combinations and joined tables, capacities, table retirement or availability, accessibility, versions and drafts, service-specific copies, and concurrency-safe saving are all missing.

**Constraints on a redesign.**
- Tenant-scoped composite FKs plus RLS (member read, admin write).
- Security-definer RPCs that check roles internally.
- The schema → generated types → contracts → client order, with branded IDs, strict objects and message-free validation.
- An offline/sync layer that is promised but deliberately unbuilt, behind the "repositories/gateways are the only backend doors" seam.

### Cited Findings
**MR wiring**
- Tables:
  - `service_tables (workspace_id, service_id, table_id integer not null check (table_id between 1 and 999), data jsonb, primary key (workspace_id, service_id, table_id))`
  - `service_settings (… state jsonb)`, a k/v store holding `floor_maps_v1`, `floor_status_v1`, `restaurant_config_v1` and others
  - `services.session in ('lunch','dinner')`, `status in ('live','ended')`
  - `workspace_members.role in ('admin','service','kitchen')`

  — [schema.sql:28, 81-92, 189-195, 237-240](MR/schema.sql)
- The board defaults to 10 tables: `initTables = Array.from({ length: 10 }, …)`, each blank table carrying `tableGroup: []`. `mergeTableGroups` detects groups via an explicit `tableGroup`, falling back to `resName|resTime`. `MAX_CONFIGURED_TABLES = 60`. — [tableHelpers.js:121-159, 341](MR/src/utils/tableHelpers.js), [restaurantConfig.js:6](MR/src/config/restaurantConfig.js)
- Day resolution: "the whole app — floor view, kitchen view, minimap, seat caps, NEEDS TABLE — follows the day's room". — [floorMaps.js:182-192](MR/src/utils/floorMaps.js)
- Seat-level data shown on the floor:
  - Chair pills carry water ("XC / XW / OC / OW"), pairing codes, BTG/BTB pour mode, LH (left-hander), a 🎂 birthday marker, and gender colour ("Mr blue / Mrs pink").
  - A chair tap opens the board's QUICK ACCESS card ("the same editor as board mode, not a copy").
  - "NO reservation names on the FOH floor".

  — [FloorView.jsx:20-34, 190-235](MR/src/components/floor/FloorView.jsx)
- The dock reuses the board's derivations ("the floor must never disagree with the board/kitchen"), with SET/FIRE/UNDO weighted SET 5 / FIRE 2 / UNDO 1. — [FloorDock.jsx:15-34](MR/src/components/floor/FloorDock.jsx)
- The kitchen floor view shows "terrace (default tab) + the active dining layout, ×pax, course progress C4/12… chair marks with restrictions in the app red, and the FOH SET markers. NO guest names". On the dining tab, a chair drag is "a real swap, so P-numbers and restriction positions renumber and the ticket '→ P4' follows the drag". — [KitchenFloorView.jsx:16-30, 183-187](MR/src/components/kitchen/KitchenFloorView.jsx)
- The kitchen minimap is "a small, always-on room map docked in the board's spare bottom-right… The architecture layer (walls/zones/planters) is stripped". It is interactive (seat swap, CHANGE TABLE) and offers only in-house parties so "a not-yet-arrived booking can never be seated onto the terrace by a mis-tap". — [KitchenMinimap.jsx:14-38](MR/src/components/kitchen/KitchenMinimap.jsx)
- Kitchen tickets render per-seat chips (pour mode, digestivo per seat) from `table.seats`. — [kitchenTicketGenerator.js:80-231](MR/src/utils/kitchenTicketGenerator.js)
- Audit defects at these joins:
  - "Seat ids are not always 1..N — a dining-map chair drag legitimately yields ids like {1,2,3,5,6} for 5 guests" (:714)
  - combined-table views "duplicate restrictions and attach them to the wrong merged seat" (RESTRICTIONS-7, :723-732)
  - `archive_and_finish_service` "blanks generate_series(1,10)… but restaurant config supports up to 60 tables" (:312)
  - kitchen-added restrictions live on table state only (:666)

  — [APP_ANALYSIS_2026-07.md](MR/docs/APP_ANALYSIS_2026-07.md)

**OC wiring today**
- Schema domains present: `auth, dish, drink, floor, layout (menu layout), menu, restaurant, restriction, shared, translation`. There is no reservation, service, party or seat domain. — [apps/supabase/schemas/](OC/apps/supabase/schemas/)
- The glossary ties a Service to each Area's default layout and fixes Seat numbers across layouts. — [glossary.md](OC/.docs/glossary.md)
- The Area-archive check against future Reservations is explicitly deferred. — [open-items.md:9](OC/.docs/internal/open-items.md)
- Roles: `create type public.restaurant_role as enum ('admin', 'kitchen', 'front_of_house')`. Floor writes are admin-only and reads are open to all members. — [restaurant_role.sql](OC/apps/supabase/schemas/restaurant/types/restaurant_role.sql), [floor policies](OC/apps/supabase/schemas/floor/policies/)

**Vision vs current OC model (each row cites both sides)**

| Vision item | Vision source | Current OC model |
|---|---|---|
| Windows, fixed furniture, labels | "Add walls, doors, windows, fixed furniture and useful labels" — [product.md:2045-2110](OC/.docs/internal/_archive/product.md) | `content` = `walls`, `doors` (`GridEdge`) and `blocks` (rectangle with optional label, no kind). No windows, furniture types or planters. MR had zones and planters. — [floor.schemas.ts:58-82](OC/packages/contracts/src/floor/floor.schemas.ts) |
| Table shapes | "Shape and size" — [product.md:1990-2000](OC/.docs/internal/_archive/product.md) | `table_shape` = `round`, `rectangle` only — [table_shape.sql](OC/apps/supabase/schemas/floor/types/table_shape.sql) |
| Seat positions | "Add, move and number Seats"; "Allow a Seat to be named, numbered or left as a position" — [product.md](OC/.docs/internal/_archive/product.md) | Side-per-seat + `order`; no offset, angle or name; seats are numbers, not rows — [floor.schemas.ts:84-88](OC/packages/contracts/src/floor/floor.schemas.ts) |
| Combinations and joined tables | "Tables it can join with", "Allowed joined-table combinations", "saved Table groups", capacity per joined group — [product.md](OC/.docs/internal/_archive/product.md); "assign Reservations to individual or joined Tables" — [product_v2.md:143](OC/.docs/internal/_archive/product_v2.md) | None (no group or combination entity) — [schemas/floor/tables](OC/apps/supabase/schemas/floor/tables/) |
| Capacity | "Minimum and comfortable maximum Guests", "Absolute maximum" — [product.md](OC/.docs/internal/_archive/product.md) | `seat_count` 1..20 only — [dining_table.sql](OC/apps/supabase/schemas/floor/tables/dining_table.sql) |
| Table's Area or room | "Area or room" on the table record — [product.md](OC/.docs/internal/_archive/product.md) | Tables are restaurant-wide; the Area is only implied by placement on a default layout — [dining_table.sql](OC/apps/supabase/schemas/floor/tables/dining_table.sql) |
| Availability and retirement | "Active, Temporarily Unavailable or Retired"; "Retiring a Table must never remove it from past Services" — [product.md](OC/.docs/internal/_archive/product.md) | No `archived_at`/`disabled_at` on `dining_table`; delete blocked while placed; soft deletes undecided — [dining_table.sql](OC/apps/supabase/schemas/floor/tables/dining_table.sql), [open-items.md:5](OC/.docs/internal/open-items.md) |
| Accessibility and service routes | Table features and accessibility; "Show accessibility and important Service routes"; Availability uses "accessibility" — [product.md](OC/.docs/internal/_archive/product.md), [product_v2.md:68](OC/.docs/internal/_archive/product_v2.md) | None |
| Versions, draft/publish, history, authorship | "draft, validate, publish, archive, and restore immutable Floor Plan versions" — [product_v2.md:150](OC/.docs/internal/_archive/product_v2.md); "Record who created, edited and Published each version" — [product.md](OC/.docs/internal/_archive/product.md) | One mutable layout; `archived_at` only; `save_floor_layout` overwrites in place; no author columns — [save_floor_layout.sql](OC/apps/supabase/schemas/floor/functions/save_floor_layout.sql) |
| Concurrent-edit safety | "Prevent two people from unknowingly replacing each other's changes" — [product.md](OC/.docs/internal/_archive/product.md) | No expected-version argument; delete+insert replace — [save_floor_layout.sql](OC/apps/supabase/schemas/floor/functions/save_floor_layout.sql) |
| Overlap warnings | "Warn when Tables overlap walls, doors or other Tables" — [product.md](OC/.docs/internal/_archive/product.md); "warnings when Tables overlap physical objects" — [product_v2.md:151](OC/.docs/internal/_archive/product_v2.md) | Hard *rejection* of table/block cell overlap and out-of-bounds, contract-side only; walls and doors versus tables unchecked — [floor.logic.ts:58-109](OC/packages/contracts/src/floor/floor.logic.ts) |
| Service-specific plan | "Copy that Floor Plan into a Service-specific working layout" — [product.md](OC/.docs/internal/_archive/product.md); [product_v2.md:152](OC/.docs/internal/_archive/product_v2.md) | None; the Area default is global (MR at least had a per-day binding) — [set_default_floor_layout.sql](OC/apps/supabase/schemas/floor/functions/set_default_floor_layout.sql) |
| Table lifecycle states | "expected, arrived, seated, active, SET, dirty, reset, finished, and unavailable" — [product_v2.md:153](OC/.docs/internal/_archive/product_v2.md) | None (no live service schema) |
| Reset and duplicate layouts | "create, duplicate, rename, reset, and switch" — [product_v2.md:142](OC/.docs/internal/_archive/product_v2.md) | Create, rename and make-default exist; duplicate and reset do not — [layout.repository.ts](OC/apps/client/layers/floor/app/repositories/layout.repository.ts) |

**Constraints a redesign must respect**
- Multi-tenancy:
  - Every floor table has `restaurant_id → restaurant on delete cascade` plus `unique (restaurant_id, id)`, and child FKs are composite `(restaurant_id, …)`, so cross-tenant references are impossible.
  - RLS: select for `is_restaurant_member`, writes for `has_restaurant_role(…,'{admin}')`.
  - `revoke all … from anon, authenticated`, then column-level grants.

  — [schemas/floor/tables](OC/apps/supabase/schemas/floor/tables/)
- Schema rules: "Deny access by default. Grant only the privileges required by client operations"; "Use `security invoker` by default. Use `security definer` only when an operation needs elevated privileges"; "Enforce authorization inside privileged functions." — [schemas/AGENTS.md](OC/apps/supabase/schemas/AGENTS.md)
- Supabase layout rules: "Write schema changes only in `schemas/`. Keep one object per file, named after the object"; tables and grants in `tables/`, enums in `types/`, policies in `policies/`; "Do not edit `migrations/` or generated output". The add-a-table workflow requires asking before `just db-update`. — [apps/supabase/AGENTS.md](OC/apps/supabase/AGENTS.md)
- Contracts rules:
  - "Derive database-backed enums from generated `Constants`."
  - "Brand each entity ID. Reuse the referenced entity's brand for foreign keys."
  - "Put database constraint names in `<domain>.constraints.ts`… Type foreign keys with `satisfies ForeignKeyName`."
  - "Do not edit `src/generated/` or the Deno mirror. Tooling writes both."
  - "A module may have one internal subfolder level."
  - Validation messages belong in client i18n (lint rule `no-validation-messages`).

  — [packages/contracts/AGENTS.md](OC/packages/contracts/AGENTS.md)
- Offline and sync:
  - The README promises the whole system "keeps working through bad Wi-Fi on every device". — [README.md](OC/README.md)
  - The skeleton deliberately omits it: "**Offline/PowerSync layer** — engine, schema, and connector are omitted; no layer is reserved for them. Destination: a future implementation design." — [repo-skeleton.shaping.md:167](OC/.docs/internal/_archive/repo-skeleton.shaping.md), [repo-skeleton.technical.md:185](OC/.docs/internal/_archive/repo-skeleton.technical.md)
  - Repositories and gateways are the single seam meant to "enable the future offline swap". — [repo-skeleton.shaping.md:152](OC/.docs/internal/_archive/repo-skeleton.shaping.md)
  - The roadmap requires "Select and prove the offline and synchronization architecture" and "Offline edits either synchronize safely or are visibly refused for a clear reason." — [development_roadmap.md:96,192](OC/.docs/internal/_archive/development_roadmap.md)
  - Realtime catch-up and offline access change are open items. — [open-items.md:7-8](OC/.docs/internal/open-items.md)
- Migration tooling: publications, `comment on` and DML do not reach the rolling migration yet. — [open-items.md:6](OC/.docs/internal/open-items.md)

### Inferences
- OC's stable Seat numbers per Table, with geometry held separately per layout, directly answer MR's chair-identity drift (seat ids {1,2,3,5,6}, restrictions misattributed on merges). A redesign should keep "seat identity on the Table, seat placement on the layout". (Inferred.)
- Joined tables are needed by the MVP (reservations "individual or joined Tables", service "join, split") but have no representation. A combination model, such as allowed-join pairs or saved groups with capacity, is likely the largest structural addition, and it must avoid MR's label- and claim-derived merges. (Inferred.)
- Because `floor_layout_table` rows are regenerated on every save, any future reference to a placement row (for example, a service snapshot pointing at placement ids) would break. References should target `(floor_layout_id, table_id)` or an immutable layout version. (Inferred.)
- Because no sync engine is chosen, a redesign should keep edits as explicit, version-checked commands (an expected `updated_at` or version argument on save, or immutable versions) rather than whole-document blind overwrites. This holds whether the future layer is PowerSync-like or not, and it is the remedy MR's audit itself recommended (E1). (Inferred.)
- The floor admin is admin-only by RLS. Live table state (SET, occupancy, service-specific adjustments) will need separate tables writable by `front_of_house`/`kitchen`, not new columns on `floor_layout*`. (Inferred.)

### Gaps
- There is no OC design yet for the Service Floor Plan, Live Party/Seat, reservation-to-table assignment or joined tables, so the exact join points cannot be documented.
- I did not read the exact JSON shape of MR seat objects in `service_tables.data` (restrictions `pos`, extras, pour mode). Only usages seen in comments are cited.
- No source states the intended physical scale of an OC grid cell, or whether MVP must keep MR-level geometry: continuous coordinates, door swing arcs, zones and planters.
