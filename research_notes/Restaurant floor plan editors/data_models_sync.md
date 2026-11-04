# Restaurant floor plan data models, combinations, availability, versioning and offline sync

Research date: 2026-11-04. Source-quality legend used below: **[doc]** = primary vendor reference/help page fetched and read; **[code]** = source code read directly; **[snippet]** = only the search-engine excerpt was available (page blocked/truncated) — treat as lower confidence; **[3rd-party]** = integration partner's or reviewer's description of a vendor's system.

## 1. What entities and fields do real systems expose for floor plans, rooms/areas, tables, seats, sections and combinations?

### Takeaway
Integration-facing APIs (Toast, Lightspeed K-Series, Wix, Zenchef) expose only **identity + grouping + capacity** (GUID, display number/name, area/floor reference, min/max or default covers, active flag) and **never geometry**. Geometry (pixels, centre or top-left anchors, rotation) only shows up in editor-internal models (Odoo, Lightspeed L-Series editor, TastyIgniter JSON columns). Seats exist as **integers on order lines** (Toast `seatNumber`), not as geometric entities. Most reservation vendors' table/floor APIs are partner-gated (ResDiary, Eat App, Zenchef) or unpublished/not found (SevenRooms, OpenTable, Resy, Tock).

### Cited Findings

**Toast (Configuration + Orders APIs; doc pages show no version/date)**
- `Table` object: `guid` (required, "The GUID maintained by the Toast POS"), `entityType` (required), `name` ("The human-readable name of this table as it appears in the POS"), `revenueCenter` (ExternalReference: `guid`, `entityType`, `externalId`), `serviceArea` (ToastReference: `guid`, `entityType`). **No x/y, shape, seat count or capacity fields.** [doc] — [Toast Table schema](https://doc.toasttab.com/openapi/configuration/tag/Data-definitions/schema/Table)
- Service areas are physical groupings of tables, each with a GUID and a revenue-center reference; revenue centers group service areas and POS devices for separate reporting (GUID, name, description). Endpoints: `GET /tables`, `GET /tables/{guid}`, `GET /serviceAreas`, `GET /revenueCenters`; requests carry a `Toast-Restaurant-External-ID` header. [doc/snippet] — [Toast: get a service area](https://doc.toasttab.com/openapi/configuration/operation/serviceAreasGuidGet); [Toast RevenueCenter schema](https://doc.toasttab.com/openapi/configuration/tag/Data-definitions/schema/RevenueCenter); [Toast revenue-center guide](https://doc.toasttab.com/doc/devguide/apiOrdersRevenueCenters.html)
- Seats live only on order lines: `Selection.seatNumber` — "Indicates which guest seat at a restaurant table ordered a menu item selection." A positive integer = seat number; `0` = "the menu item is shared by multiple guests"; `-1` = "the restaurant employee did not select a seat". Marked "Response only". [doc] — [Toast Selection schema](https://doc.toasttab.com/openapi/orders/tag/Data-definitions/schema/Selection)
- In the POS, seat numbers are set per ordering mode as Required / Optional / Off. A "Share" section appears when seat numbers are on and cannot be turned off. [snippet] — [Toast support: seat numbers](https://support.toasttab.com/en/article/Seat-Numbers-Enabling-and-Configuring-1493086465089); [Toast: order by seat](https://support.toasttab.com/en/article/Order-by-Seat)

**Lightspeed**
- K-Series API portal (page reported "API version 1.0.0", "last updated Nov 4, 2026"): the only floor/table operations found are under Online Ordering API → Order and Pay. They are "Get All Floorplans", "Get Floorplan Tables", "Get Open Check by Table" and "Get All Open Checks". [doc] — [Lightspeed K-Series API docs](https://api-docs.lsk.lightspeed.app/)
- `GET /o/op/data/{businessLocationId}/floorplans/{floorPlanId}/tables` (both path params int64) returns an array of `{ number (int32, "The table number"), reference (string), id (string), active (boolean), description (string), defaultClientCount (int32, "The default client count for this table") }`. **No coordinates, shape or seats.** Tables are scoped under a floor plan. [doc] — [K-Series: Get Floorplan Tables](https://api-docs.lsk.lightspeed.app/operation/operation-apegettables)
- Storekit consumes this API as follows. Each Lightspeed floor plan becomes a storekit "area" (it keeps the Lightspeed area name and ID). Table description becomes the name, table number becomes the POS ID, default client count becomes covers, and the active state is copied. Tables are **matched on table number**: "Renumbering a table in Lightspeed makes storekit treat it as a new table, and the old table's QR code stops working." Sync is a manual, store-wide button that overwrites name, covers, active state and area. [3rd-party] — [storekit: Lightspeed dine-in](https://storekit.com/docs/guides/integrations/pos/lightspeed/dine-in)
- The Lightspeed Restaurant **L-Series** floor editor (UI, not API) has these settings:
  - Table: Name; "X and Y: Horizontal and vertical positioning"; "Width and Height … measured in pixels"; Chairs (count slider); Rotation slider ("If the slider is in the center, the table's rotation is at 0 degrees"); a Round toggle ("If disabled, the table is rectangular by default"); Table type (default "Restaurant").
  - Floor: name, "Width of the floor in pixels", "Height of the floor in pixels", "Booking capacity of the floor".
  - Editing requires the "Edit floors" permission.
  [doc] — [Lightspeed L-Series: Editing floor plans](https://resto-support.lightspeedhq.com/hc/en-us/articles/226405368)

**Square**
- A Square team member answered on the developer forum: "The Square API currently does not support direct interaction with the floor plan, sections, tables, and seats of the Square Restaurant POS". This means you can't retrieve that information or assign orders to tables or seats via the API. [3rd-party/forum, not reference docs] — [Square developer forum](https://developer.squareup.com/forums/t/inquiry-regarding-adding-unpaid-order-to-table-getting-floor-section-tables-information/21815)
- Floor plans, sections and tables are built in the Square Dashboard. A table shows as occupied as soon as a cover count is set, even with no items. [snippet] — [Square: building your floor plan](https://squareup.com/help/article/6427); [Square: table management settings](https://api.squareup.com/help/ca/en/article/8146-customize-table-management-settings)

**Wix Table Reservations — Reservation Locations API v1** (REST `GET https://www.wixapis.com/table-reservations/reservation-locations/v1/reservation-locations/{reservationLocationId}`) — the most complete public table/combination schema found
- The `configuration.tableManagement` block has these fields [doc] — [Wix GetReservationLocation schema](https://dev.wix.com/docs/api-reference/business-solutions/restaurants/reservations/reservation-locations/get-reservation-location.md?schema=true); [Wix Reservation Location object](https://dev.wix.com/docs/api-reference/business-solutions/restaurants/reservations/reservation-locations/reservation-location-object.md):
  - `mode` (enum `ON` | `IN_HOUSE_ONLY` | `OFF`)
  - `tableDefinitions[]` (maxItems 1000)
  - `deletedTableDefinitions[]` (maxItems 1000)
  - `tableCombinations[]` (maxItems 1000)
- `TableDefinition` fields: `id` (GUID, read-only), `name` (1–50 chars), `seatsMin`, `seatsMax` (each 0–10000), `isActive` ("Whether the table is active (available to be reserved)"). **No geometry, no area/room.** [doc] — same source
- `TableCombination` fields: `id` (GUID, read-only), `tableIds[]` (maxItems 1000), `seatsMin`, `seatsMax` ("…number of seats that can be reserved in this table combination"), `isActive`. [doc] — same source
- Mode semantics [doc] — same source:
  - `ON`: tables can be assigned manually, and "When tables aren't manually assigned, Wix assigns them automatically".
  - `IN_HOUSE_ONLY`: manual assignment only.
  - `OFF`: no assignment; "If you try to assign a table manually, the request will fail".
- The doc's example has "Small table" (seatsMin 1, seatsMax 4) and "Big table" (3–6), plus a combination of both with seatsMin 7, seatsMax 10. The combination's range is **set explicitly**, not derived from its members (here the minimum is raised so small parties don't take the combo). [doc] — same source

**Gated reservation APIs (partner access only)**
- Zenchef: API documentation is sent on request (api-tech-help@zenchef.com). The capability list includes "Tables & rooms: Get rooms and tables of the restaurant" (read only); no write operations are listed. [snippet] — [Zenchef API help](https://help.zenchef.com/hc/en-gb/articles/27690768125597-Zenchef-API)
- Eat App: the Partner API offers `GET /partners/v2/availability` and `POST /partners/v2/reservations`; the Concierge API covers reservations (with an idempotency token), guests and bootstrap data. Tables and rooms are mentioned as resources. Keys are issued only by Eat App. [snippet] — [Eat App Partner API guide](https://restaurant.eatapp.co/knowledge/using-the-eat-app-partner-api-to-get-and-post-availability); [Eat App documentation](https://restaurant.eatapp.co/knowledge/documentation)
- ResDiary: Consumer API, Data Extract API, EPOS API (bi-directional, covering "seating and arrival status updates") and Webhooks; access is by request (paid). [snippet] — [ResDiary: explore your API](https://help-resdiary.theaccessgroup.com/en/articles/16108724-explore-and-request-your-resdiary-api)
- SevenRooms (no public reference found). Partner docs say:
  - "only unique numeric Table Numbers are supported"; casual-service ("Bistro") tables are not supported; tables are opened in the POS when a reservation is assigned and flagged Partially Seated or Seated. [3rd-party] — [Swiftpos: SevenRooms](https://help.swiftpos.com.au/sevenrooms)
  - Table numbers must match exactly across systems. [3rd-party] — [Bepoz](https://help.bepoz.com/bepoz/sevenrooms-interface-product-summary-page); [OrderMate](https://help.ordermate.com.au/sevenrooms-reservation-integration)
  - Seating areas group tables and are targeted by Access Rules (e.g. "Parlor Seating" = tables 50–55). [3rd-party] — [PeopleVine](https://blog.peoplevine.com/blog/33789)
  - Tenzo maps the SevenRooms "Seating Area" to a Revenue Center. [3rd-party] — [Tenzo](https://support.gotenzo.com/integration-guides/reservations/guide-sevenrooms-reservations-and-reviews-api/)
- Oracle Simphony Table Management. Sections: "You can group tables within an area or station to indicate assignment to a specific server". "Optional seating section templates allow you to set predefined table layouts where the application automatically assigns tables to a specific section". Templates are defined at property level. [doc] — [Oracle Simphony: TMS sections](https://docs.oracle.com/en/industries/food-beverage/simphony/19.3/simcg/c_tms_sections.htm)

**Comparison of exposed table fields** (geometry columns only where the source shows them)

| System | Container(s) | Table identity | Capacity | Geometry | Source |
|---|---|---|---|---|---|
| Toast config API | serviceArea (physical), revenueCenter (reporting) | `guid`, `name` | none | none | [Toast](https://doc.toasttab.com/openapi/configuration/tag/Data-definitions/schema/Table) |
| Lightspeed K-Series API | floorplan (per business location) | `id`, `number`, `reference`, `description` | `defaultClientCount` | none | [LSK](https://api-docs.lsk.lightspeed.app/operation/operation-apegettables) |
| Lightspeed L-Series editor | floor (px width/height, booking capacity) | name | chairs | X/Y, width/height px, rotation slider (degrees), round toggle | [LS L-Series](https://resto-support.lightspeedhq.com/hc/en-us/articles/226405368) |
| Wix Reservations API | reservation location | `id` GUID, `name` | `seatsMin`/`seatsMax` | none | [Wix](https://dev.wix.com/docs/api-reference/business-solutions/restaurants/reservations/reservation-locations/get-reservation-location.md?schema=true) |
| Odoo 18 POS (code) | `restaurant.floor` | `id`, `table_number` | `seats` | `position_h`/`position_v` (px to centre), `width`/`height` px, `shape` square/round | [Odoo](https://github.com/odoo/odoo/blob/18.0/addons/pos_restaurant/models/pos_restaurant.py) |
| TastyIgniter (code) | `dining_areas` → `dining_sections` | `id`, `name` | `min_capacity`/`max_capacity`/`extra_capacity` | `shape`, `seat_layout` (JSON), area `floor_plan` (JSON) | [TastyIgniter](https://github.com/tastyigniter/ti-ext-reservation/blob/master/database/migrations/2022_09_15_000300_create_dining_areas_sections_tables_add_columns_table.php) |

### Inferences
- **Industry pattern:** separate identity and capacity, which other systems integrate against, from geometry, which stays inside the editor. Overcooked's zod contracts should mirror this:
  - A `Table` contract (id, number, label, seatCount, capacity range, area, active) that POS, KDS and reservations depend on.
  - A separate `LayoutPlacement`/geometry contract that only the editor and floor views depend on.
- **Identity vs display number.** Storing a stable GUID next to the display number, as Toast, Lightspeed and Wix do, guards against the renumbering failure storekit documents. Overcooked already has `tableId` plus `number`/`label`; keep integrations keyed on `tableId` only.
- **Capacity as a range.** Reservation-side systems model capacity as a range (Wix `seatsMin`/`seatsMax`, TastyIgniter min/max/extra). POS-side systems model a default cover count (Lightspeed `defaultClientCount`, Odoo `seats`). Overcooked's `seatCount` with stable seat numbers is the POS view. Add `minCovers`/`maxCovers` (and possibly `extraCapacity`) when availability arrives, rather than overloading `seatCount`.
- **Groupings are orthogonal.** Toast keeps the physical service area separate from the reporting revenue center. Simphony and TastyIgniter add sections for server assignment, and SevenRooms adds seating areas for booking rules. Overcooked's Area is the physical grouping. Add sections as a separate, per-layout or per-service grouping instead of overloading Area.
- **Overcooked's table placement is a less common shape.** Overcooked's restaurant-wide tables placed into several layouts resemble Wix (tables without geometry) plus a placement layer. Odoo and Lightspeed K-Series instead bind each table to exactly one floor (`floor_id`, or tables listed under a `floorPlanId`).

### Gaps
- Official SevenRooms, OpenTable, Resy, Tock, TheFork/Zenchef and Eat App table/floor schemas are partner-gated or unpublished. No exact field names could be verified. The Tock help article returned 403, and the full Resy help page could not be rendered.
- The Lightspeed K-Series "Get All Floorplans" response schema was not retrieved.
- The Toast ServiceArea/RevenueCenter full schemas were not expanded beyond the reference shapes shown in the Table example.
- No public API anywhere exposed seat-level geometry.

## 2. How are table combinations modelled (explicit lists vs adjacency rules), and how do availability engines use tables, combinations, durations and pacing?

### Takeaway
Every system with checkable details models combinations as **explicit, pre-declared sets of tables with their own capacity range** (and often a priority/sell order), not as runtime adjacency inference. Systems separately support **ad-hoc/temporary joins** scoped to a single booking or open order. Availability engines combine:
- tables and combinations with capacity ranges;
- duration (turn time) by party size;
- pacing caps per time-slot interval (seats and/or parties);
- shift-level overrides of these settings.

### Cited Findings

**Explicit combination lists**
- Wix: `tableCombinations[] {id, tableIds[], seatsMin, seatsMax, isActive}` sit alongside `tableDefinitions`. Combo capacity is explicit (the example combo is 7–10 from tables of 1–4 and 3–6). [doc] — [Wix schema](https://dev.wix.com/docs/api-reference/business-solutions/restaurants/reservations/reservation-locations/get-reservation-location.md?schema=true)
- ResDiary "Table Joins" (help article dateModified 2025-10-15) [doc] — [ResDiary: create your table joins](https://help-resdiary.theaccessgroup.com/en/articles/12082484-create-your-table-joins):
  - They "allow you to combine two or more tables together to allow you to book larger parties". They are created under Settings > Table Joins with a capacity set per join.
  - Priority by drag-and-drop: "You can choose which table combination should be sold first, when availability is the same."
  - Without a suitable join, a party larger than any single table gets "no availability". The article recommends adding every useful combination.
- ResDiary community thread: areas cannot be combined, but "Table joins can include all the tables in two or more areas" (so joins can cross areas). [snippet] — [ResDiary community](https://dishcultsupport.resdiary.com/fr/support/discussions/topics/4000339303)
- NowBookIt, a different product: "Table Joins can only be created for tables within the same section". [snippet] — [NowBookIt](https://help.nowbookit.com/knowledge-base/setting-up-table-joins-in-your-diary)
- LS Central: a combined dining table is made from two or more physical tables. It is assigned a table type whose capacity "can equal the sum of the tables or differ from it", and allocation filters on min/max capacity. [snippet] — [LS Central: combined dining tables](https://help.lscentral180.lsretail.com/Content/LS-Hospitality/Dining-Table-Management/Combined-Dining-Tables.htm)
- TastyIgniter `dining_tables` has `is_combo` (bool), `parent_id`, `nest_left`, `nest_right` (nested set), `priority`, `min_capacity`, `max_capacity` and `extra_capacity`. The model uses a `NestedTree` trait and declares scopes `whereCanAccommodate`, `whereIsAvailableAt`, `whereIsAvailableForDate`, `whereIsReservable`, `whereIsRoot` and `reservable(array $options)`. [code] — [migration](https://github.com/tastyigniter/ti-ext-reservation/blob/master/database/migrations/2022_09_15_000300_create_dining_areas_sections_tables_add_columns_table.php); [DiningTable model](https://github.com/tastyigniter/ti-ext-reservation/blob/master/src/Models/DiningTable.php)
- Tock: after adding tables to a floor plan you can set up combinations, which "allow you to combine smaller tables to accommodate larger parties". [snippet] — [Tock help](https://tock.zendesk.com/hc/en-us/articles/15126385902612)
- Libro distinguishes "basic" and "smart" table combinations; "a minimum of three tables is required to create a smart combination" (possibly chain/adjacency-based; page blocked). [snippet] — [Libro help](https://libroreserve.zendesk.com/hc/en-us/articles/32064244745755)

**Ad-hoc / runtime joins**
- ResDiary temporary joins (dateModified 2025-09-16) [doc] — [ResDiary: temporary table join](https://help-resdiary.theaccessgroup.com/en/articles/12304448-create-your-temporary-table-join):
  - They are "valid just for one time" and "apply only to the specific reservation being made", accommodating bookings "without permanently altering your table layout".
  - They are created from the booking form and marked with a broken-link icon.
- Odoo 18: `restaurant.table.parent_id` ("The parent table if this table is part of a group of tables"). The grouping is stored on the table row itself and loaded into the POS. [code] — [Odoo pos_restaurant.py](https://github.com/odoo/odoo/blob/18.0/addons/pos_restaurant/models/pos_restaurant.py)

**Availability engine inputs**
- Wix `configuration.onlineReservations` [doc] — [Wix schema](https://dev.wix.com/docs/api-reference/business-solutions/restaurants/reservations/reservation-locations/get-reservation-location.md?schema=true):
  - `partySize {min, max}`.
  - `defaultTurnoverTime` (minutes, 0–1440; "how much time a party is allotted … from being seated to leaving").
  - `turnoverTimeRules[] {seatsMin, seatsMax, minutes}` (≤1000), i.e. duration by party size.
  - `seatPacing {number, enabled}`: max seats filled by new reservations per slot.
  - `partyPacing {number, enabled}`: max parties starting per `timeSlotInterval`.
  - `timeSlotInterval` (default `15`).
  - `minimumReservationNotice` / `maximumReservationNotice {number, unit}`.
  - `businessSchedule` (≤100 periods).
  - `pauseSettings` (`pauseFrom`, `pauseUntil`).
  - Approval `mode` (`AUTOMATIC` | `MANUAL` | `MANUAL_FOR_LARGE_PARTIES` with `partySizeThreshold`, `considerTablesForManualApproval`).
  - Doc inconsistency: the seatPacing description says "within a 15-minute period", while its `number` field says "per `timeSlotInterval`".
- ResDiary services hold working times, duration times and yield management; a table reset window acts as a turn buffer; covers/bookings per interval can be capped. [snippet] — [ResDiary: finalise setup](https://help-resdiary.theaccessgroup.com/en/articles/12458175-finalise-your-resdiary-setup); [ResDiary table management collection](https://help-resdiary.theaccessgroup.com/en/collections/14904556-table-management)
- aleno automatic table assignment [doc] — [aleno: shift-specific settings](https://knowledge.aleno.me/en/kb/automatic-table-assignment-shift-specific-settings):
  - "The restaurant level forms the foundation of automatic table assignment".
  - Shifts can add buffers between reservations, a deadline for automatic reassignment, shared table usage, provisional reservations without a free table, and "shift-specific table capacities, combinations, exclusions, or priorities".
  - Examples: lunch gets extra combinations; dinner gets "fewer or no combinations to keep the table plan stable" and prioritises window tables, optionally by guest tags.
- SevenRooms (marketing): "AI-driven seating algorithm: considers 10,000+ combinations every second". [doc/marketing] — [SevenRooms table management](https://sevenrooms.com/platform/table-management/)
- OpenTable: "flexible turn controls" set a minimum number of turns per party size or table, flow controls pace tables "to help the kitchen", and turn times are adjustable within a single shift. [snippet] — [OpenTable press release](https://press.opentable.com/news-releases/news-release-details/opentable-releases-new-features-help-restaurants-maximize-table). "Smart Assign (automated table assignments)" is listed on the Core plan. [doc/marketing] — [OpenTable Core plan](https://www.opentable.ie/restaurant-solutions/plans/core/)
- easyTable tries to book a single table before combining tables for larger groups. [snippet] — [easyTable guide](https://help.easytable.com/?p=1040)
- Eat App Table Turns: intended leave time = "the seated time plus the reservation's original booked duration". If seated early or late, "the intended leave time shifts with it, but the original duration stays the same". Cover Flow buckets reservations into 15-minute slots. [doc] — [Eat App: cover flow and table turns](https://restaurant.eatapp.co/knowledge/cover-flow-and-table-turns)

### Inferences
- **Store combinations as explicit config rows.** Suggested shape:
  - `table_combination {id, name, min_covers, max_covers, priority, is_active, bookable_online}`, with members in `table_combination_member {combination_id, table_id}` or a `table_ids uuid[]` column.
  - Capacity is stored, not computed (the Wix and LS Central evidence).
  - Geometry adjacency in the editor can suggest combinations, but the stored list is authoritative (no system checked derives combos at runtime from geometry).
- **Scope combos to a published layout version.** Physical adjacency depends on where tables are placed, and Overcooked places the same restaurant-wide tables in several layouts. A combination should therefore be scoped to the layout version where those tables are adjacent, or carry a "valid in layouts" list.
- **Model "joined tables during service" as service-day state, not config.** For example `service_table_join {service_id, table_ids[], created_by, created_at, released_at}`, echoing ResDiary temporary joins and Odoo `parent_id`. That way joining tonight never mutates the reusable plan.
- **Minimal availability engine for Overcooked:**
  1. Candidate resources = active tables + active combinations whose `[min,max]` covers the party.
  2. Occupancy interval = start + duration(partySize) + buffer.
  3. Reject slots exceeding seat pacing or party pacing per interval.
  4. Rank by priority / smallest fitting resource (prefer single table before combo).
  5. Apply shift-level overrides that inherit restaurant defaults (aleno pattern).
  For fine dining, seat pacing (covers per 15 minutes) maps directly to kitchen load.

### Gaps
- No official algorithm descriptions (SevenRooms, OpenTable Smart Assign, Resy) were found; their combination selection logic is proprietary.
- The Libro "smart combination" definition could not be read (403), so I couldn't confirm whether adjacency-based combo generation exists in any shipping product.
- TastyIgniter's combo-creation code (how `is_combo` parents relate to children) was not in the model file. That combos are parent rows with member children is **an inference** from the columns.

## 3. How do systems separate configuration (the reusable plan) from a service-day snapshot, and how do they version/publish floor plans without breaking past services and historical seat data?

### Takeaway
No vendor documentation found exposes an explicit "immutable floor-plan version" entity. Instead, the evidence shows six recurring mechanisms:
1. Several saved floor plans, with one activated per shift (Resy).
2. Restaurant-level defaults that shifts inherit and override (aleno).
3. Blocking structural edits while a service/session is open (Odoo).
4. Soft-delete/archive instead of delete (Odoo `active`, Wix `deletedTableDefinitions`, Lightspeed `active`).
5. Optimistic-concurrency revisions on config objects (Wix `revision`).
6. Copying policy/duration onto the booking at creation time (Wix cancellation policy, Eat App booked duration).

Historical seat data survives layout changes because it references **stable table IDs and integer seat numbers on order lines** (Toast `seatNumber`), not geometry.

### Cited Findings
- Resy: a floor plan must be added to a shift before it is active — "you must 'Add' your Floor plan to the shift for it to be active". This implies multiple stored plans and per-shift activation. [snippet] — [Resy: Floor Plan Web Editor](https://helpdesk.resy.com/en_us/floor-plan-on-web-SyTdJuBp9)
- aleno: "All configurations from the restaurant level are visible and active on the shift level by default". Rules can be toggled per shift, and shift-only rules "apply only to the selected shift and do not affect other shifts". [doc] — [aleno](https://knowledge.aleno.me/en/kb/automatic-table-assignment-shift-specific-settings). Additional rooms/areas can be activated for specific shifts or days (e.g. outside seating). [snippet] — [aleno: activate additional rooms](https://knowledge.aleno.me/en/kb/outside-seating-how-to-activate-additional-rooms-or-areas)
- Odoo 18 guards config while a POS session is open [code] — [Odoo pos_restaurant.py](https://github.com/odoo/odoo/blob/18.0/addons/pos_restaurant/models/pos_restaurant.py):
  - `restaurant.floor.write` raises `UserError` when changing `pos_config_ids` or `active` while an attached config has an active session.
  - `@api.ondelete` blocks deleting floors or tables used by a non-closed session.
  - `deactivate_floor` refuses if draft orders exist, otherwise cascades `active=False` to tables.
  - `restaurant.table.are_orders_still_in_draft` raises if open orders exist.
  - Tables also have `active` ("If false, the table is deactivated and will not be available in the point of sale").
- Wix [doc] — [Wix object](https://dev.wix.com/docs/api-reference/business-solutions/restaurants/reservations/reservation-locations/reservation-location-object.md); [Wix schema](https://dev.wix.com/docs/api-reference/business-solutions/restaurants/reservations/reservation-locations/get-reservation-location.md?schema=true):
  - `revision` (int64) — "Each time the reservation location is modified, its `revision` changes. For an update operation to succeed, you must specify the latest revision" (optimistic concurrency on the whole config document).
  - `deletedTableDefinitions[]` retains deleted tables.
  - The cancellation policy is copied onto each reservation at creation and "governs any cancellation fee that may apply, even if the policy is later updated" (snapshot-on-write).
  - Locations carry an `archived` flag.
- Lightspeed/storekit: matching on display number means "Renumbering a table … makes storekit treat it as a new table, and the old table's QR code stops working". This is a concrete failure mode of keying history or integrations on mutable display numbers. [3rd-party] — [storekit](https://storekit.com/docs/guides/integrations/pos/lightspeed/dine-in)
- TastyIgniter's v4 schema change [code] — [TastyIgniter migration](https://github.com/tastyigniter/ti-ext-reservation/blob/master/database/migrations/2022_09_15_000300_create_dining_areas_sections_tables_add_columns_table.php):
  - It copied old `tables` rows into `dining_tables` (shape defaulted to `'rectangle'`).
  - It created a `'Default'` dining area per location.
  - It back-filled `reservation_tables.dining_table_id` with `unique(['reservation_id','dining_table_id'])`, preserving historical reservation-to-table links across a model change. Its `down()` does not reverse the data copy.
- ResDiary temporary joins apply "only to the specific reservation" and do not alter the permanent layout (service-scoped state). [doc] — [ResDiary temporary join](https://help-resdiary.theaccessgroup.com/en/articles/12304448-create-your-temporary-table-join)
- Eat App keeps the reservation's "original booked duration" even when seating time shifts (the duration is captured on the booking). [doc] — [Eat App](https://restaurant.eatapp.co/knowledge/cover-flow-and-table-turns)
- Square derives live occupancy from service-day state (a cover count makes a table "occupied"), not from layout config. [snippet] — [Square table management settings](https://api.squareup.com/help/ca/en/article/8146-customize-table-management-settings)
- Toast seat data on orders is an integer `seatNumber` (with `0` shared and `-1` none) attached to each selection. It is independent of floor geometry. [doc] — [Toast Selection](https://doc.toasttab.com/openapi/orders/tag/Data-definitions/schema/Selection)

### Inferences
- **Recommended pattern for Overcooked:**
  - **Draft** (mutable, editor-only rows) → **publish** (a server-side RPC/Edge Function that validates, then writes an immutable `floor_plan_version {id, floor_id, version_no, content jsonb, content_hash, published_by, published_at}`) → **Service** references `floor_plan_version_id` (pinned at service creation or "service start").
  - A Service's "tonight" overrides (joins, blocked tables, section assignments, table lifecycle states) live in service-scoped tables keyed by `service_id` + `table_id`, never in the version.
  - This combines Resy's per-shift activation, Odoo's "no structural edits during an open session" and Wix's snapshot-on-write.
- **History stays valid without versioning tables.** Tables and seat numbers are restaurant-wide and stable in Overcooked, so orders and course data keyed by `(table_id, seat_number)` stay valid across layout versions. Layout versions only change presentation and adjacency.
  - Guard rails: never hard-delete tables (use `active`/archived like Odoo, Lightspeed and Wix).
  - Forbid reducing `seatCount` below seat numbers referenced by open orders.
  - Treat renumbering as a label change on the same `tableId`.
- **Use a revision check on drafts.** A `revision`/`version` integer on the draft (Wix style; PowerSync "version_mismatch" strategy, see §5) lets publish detect that the draft changed since an admin last reviewed it.
- **Service-specific floor plans** fit as either a different pinned `floor_plan_version_id` per service, or aleno-style "inherit + override" rows (`service_layout_override`) on top of the default version. The former is simpler and immutable; the latter avoids version proliferation for small tweaks.

### Gaps
- No vendor document explicitly describes immutable floor-plan versioning or what happens to existing reservations when an active plan is edited (Resy and SevenRooms pages not readable).
- Whether SevenRooms or OpenTable pin a layout per shift-date or apply edits live could not be confirmed from primary docs.

## 4. Trade-offs for storing geometry: JSON documents vs normalized rows, grid cells vs continuous coordinates, rotation steps vs free angles, seat positions derived vs stored, and overlap validation

### Takeaway
Shipping systems mostly use **continuous pixel coordinates in normalized table rows**:
- Odoo stores floats in pixels to the table centre.
- Lightspeed L-Series uses pixels with a free rotation slider.

Some systems add a **JSON blob for decorative or plan-level content**: TastyIgniter has `dining_areas.floor_plan` longText and per-table `seat_layout` JSON. Seat positions are usually **derived from a count** (Odoo `seats`, Lightspeed "Chairs" slider). Explicit stored seat layouts are rarer (TastyIgniter `seat_layout`). No source describes overlap validation. For sync, Figma's model (objects as rows of independently-mergeable properties, with parent+position stored as a single property) is the strongest precedent.

### Cited Findings
- Odoo 18 `restaurant.table` [code] — [Odoo pos_restaurant.py](https://github.com/odoo/odoo/blob/18.0/addons/pos_restaurant/models/pos_restaurant.py):
  - `position_h` (Float, default 10): "The table's horizontal position from the left side to the table's center, in pixels". `position_v` (Float, default 10) is the same measured from the top.
  - `width`/`height` (Float, default 50): "in pixels".
  - `shape` Selection `square`/`round`; `seats` Integer ("default number of customer served at this table"); `color` (CSS background value).
  - **No rotation field** in the 18.0 model file.
  - Floor has `background_color` (default `'rgb(249,250,251)'`), `background_image`/`floor_background_image`, and `sequence`.
  - POS clients load exactly `['table_number','width','height','position_h','position_v','parent_id','shape','floor_id','color','seats','active']`.
- Lightspeed L-Series: X/Y position, width/height "measured in pixels", rotation via slider (centre = 0°, i.e. free angle rather than 90° steps), round vs rectangular, chair count. Floor width/height are also in pixels. [doc] — [Lightspeed L-Series](https://resto-support.lightspeedhq.com/hc/en-us/articles/226405368)
- TastyIgniter uses a hybrid of normalized rows and JSON columns [code] — [migration](https://github.com/tastyigniter/ti-ext-reservation/blob/master/database/migrations/2022_09_15_000300_create_dining_areas_sections_tables_add_columns_table.php); [DiningTable model](https://github.com/tastyigniter/ti-ext-reservation/blob/master/src/Models/DiningTable.php):
  - `dining_areas.floor_plan` is `longText` nullable (plan document).
  - `dining_tables.seat_layout` is `longText` nullable, cast `'seat_layout' => 'array'`.
  - `dining_tables.shape` is a nullable string.
  - `toFloorPlanArray()` serialises tables (using `max_capacity`) for the plan UI.
  - A 2025-10-03 migration adds indexes to dining tables and areas (file name only seen) — [migrations dir](https://github.com/tastyigniter/ti-ext-reservation/tree/master/database/migrations)
- Integration APIs carry no geometry at all (Toast Table, Lightspeed K-Series tables, Wix TableDefinition). [doc] — [Toast](https://doc.toasttab.com/openapi/configuration/tag/Data-definitions/schema/Table); [LSK](https://api-docs.lsk.lightspeed.app/operation/operation-apegettables); [Wix](https://dev.wix.com/docs/api-reference/business-solutions/restaurants/reservations/reservation-locations/get-reservation-location.md?schema=true)
- Figma's document model [doc] — [Figma blog, Evan Wallace, 2019-10-16](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/):
  - The document is a tree of objects, modelled as `Map<ObjectID, Map<Property, Value>>`; "edits to different properties or objects don't conflict".
  - Parent links are a property on the child.
  - Sibling order uses **fractional indexing** (a fraction between 0 and 1). The parent link and position are stored as **one property** so they update atomically.
  - Clients generate object IDs (including a unique client ID) so creation works offline.

### Inferences
These go beyond what any source states.
- **JSON vs rows.** A single `content` JSON column (Overcooked's walls/doors/blocks) is simple to validate with zod and to snapshot on publish. Under PowerSync's default per-column LWW (§5), though, the whole blob is one "field": two offline edits to different walls clobber each other.
  - Recommendation: use **rows per element** (`layout_element {id uuid (client-generated), layout_id, kind wall|door|block|table, x, y, w, h, axis, length, rotation, label, z/order}`) for the **mutable draft**.
  - Materialize to one **JSONB document** in the **immutable published version**, which gives cheap snapshot reads on tablets, a hash for change detection, and no row churn.
  - This mirrors Figma (rows of properties for editing) and TastyIgniter (plan JSON for display).
- **Grid cells vs continuous.** Integer grid units (Overcooked: 4–60 cells) make several things trivially deterministic:
  - snapping;
  - wall/door edge addressing (`x,y,axis,length`);
  - overlap checks (integer rectangle intersection);
  - zod validation (bounds `0 ≤ x, x+w ≤ gridWidth`).
  
  Pixel-float systems (Odoo, Lightspeed) need tolerance logic and are resolution-dependent. If finer placement is needed later, a sub-cell multiplier (e.g. half-cells) keeps integers. Pixels are a rendering concern.
- **Rotation steps vs free angles.** 0/90/180/270 keeps tables axis-aligned (AABB overlap math, side-based seat assignment, grid-edge walls). Free angles (Lightspeed slider) need OBB/SAT collision checks and break "seat on side N" semantics. For fine dining, where seat order matters, 90° steps are the safer fit.
- **Seat positions derived vs stored.**
  - Positions derived from `(shape, w, h, rotation, seatCount)` stay consistent when a table is resized.
  - Overcooked's stored `seatArrangement` (per-seat side + service order) is valuable because service order is business data, not geometry. Keep it as stored data keyed by the stable seat number, and derive pixel positions at render time.
  - Validate that the arrangement covers seats 1..seatCount exactly once.
- **Overlap validation.** Run it in three places:
  1. Client-side in the editor (zod `superRefine` on the draft).
  2. Authoritatively in the publish RPC before creating the version.
  3. Optionally in Postgres for draft rows. The idea is that Postgres geometric `box` types with a GiST `EXCLUDE … WITH &&` constraint can enforce non-overlap. That is from general knowledge, not verified in this session.
  
  Recommendation: do not block offline draft writes on overlap (it would reject queued uploads). Flag overlaps as warnings in drafts and block only at publish.

### Gaps
- No vendor documentation was found on overlap validation, collision rules or minimum aisle clearance.
- No source compared grid and continuous storage for restaurant plans directly; the trade-offs above are reasoned.
- Odoo 19+ was not checked for an added rotation field.

## 5. How should an editor's data sync across devices with offline support (PowerSync/Supabase patterns, LWW per row vs per field, CRDTs, Figma-style server authority, locking/draft workflows)?

### Takeaway
PowerSync is server-authoritative. Its default is **per-field last-write-wins in server-arrival order** (PATCH carries only changed columns), deletes win, and the backend may validate or reject. That is close to Figma's per-property LWW model, provided each editable property is its own column on its own row. CRDTs (Yjs via PowerSync) work, but PowerSync's own demo is a PoC with unbounded update history and race-prone merging, which is overkill for admin layout config. The robust combination:
- normalized draft rows;
- server-side business-rule validation (reject edits to published or locked versions);
- an optimistic `version` check at publish;
- presence-based soft locking;
- immutable published versions synced read-only to service tablets.

### Cited Findings

**PowerSync write path and conflicts** [doc] — [PowerSync: handling update conflicts](https://docs.powersync.com/usage/lifecycle-maintenance/handling-update-conflicts)
- PowerSync is "unopinionated" about conflicts; the page calls it "server-authoritative reconciliation".
- Client writes go into an "ordered log of mutations" drained in sequence to your backend:
  - PUT = create (all non-null columns);
  - PATCH = update ("Contains the ID and the changed columns");
  - DELETE.
- Default behaviour is "per-field Last-Write-Wins": "the last update the server receives wins for each field".
- Deletes take precedence: later updates to a deleted row are ignored, but the row can be recreated with the same ID.
- Operations must be idempotent; each carries a per-client incrementing operation ID.
- The server can validate (example: reject updates once an order is "completed").

**Custom conflict strategies** [doc] — [PowerSync: custom conflict resolution](https://docs.powersync.com/handling-writes/custom-conflict-resolution):
1. A `modified_at` timestamp (trigger `update_modified_at()`), with the caveat "Timestamps can be unreliable if servers have clock skew".
2. Sequence versioning with `version BIGSERIAL`, returning `conflict: 'version_mismatch'`. It is strict: "You can't merge simultaneous edits to different fields".
3. Field-level LWW with per-field `*_modified_at` columns and client timestamps in `_metadata` (requires `trackMetadata: true`).
4. Business-rule validation (codes like `order_locked`, `invalid_transition`, `approval_required`).
5. A synced `write_conflicts` table (`client_data`/`server_data` JSONB, `resolved`) for "Keep My Version / Keep Server Version" UI.
6. A `field_changes` log with `status` `pending`/`applied`/`failed` written in the same `writeTransaction`.
7. Delta operations for counters.

In the page's complete backend example, a conflict throws and the batch is rolled back (HTTP 500).

**JSON columns and schema options**
- JSON/JSONB/array columns sync as **text** ("PowerSync Service treats JSON and JSONB columns as text"). They can be filtered with `json_extract()` in Sync Streams and are updated by replacing the whole value. With `trackPreviousValues` (JS: `trackPrevious`), `CrudEntry.previousValues` enables "diffing JSON or array fields" in `uploadData`. `ignoreEmptyUpdates` "Skips updates when no data has actually changed". [doc] — [PowerSync: custom types, arrays and JSON](https://docs.powersync.com/client-sdks/advanced/custom-types-arrays-and-json)
- Per the SDK references, these are per-table options; `trackMetadata` adds a hidden `_metadata` column readable via `CrudEntry.metadata`. They first shipped in Dart `powersync_core` 1.4.0, Swift v1.1.0, React Native v1.20.1 and Kotlin v1.1.0. [doc/snippet] — [Kotlin TableOptions](https://powersync-ja.github.io/powersync-kotlin/common/com.powersync.db.schema/-table-options/index.html); [.NET TableOptions](https://powersync-ja.github.io/powersync-dotnet/api/PowerSync.Common.DB.Schema.TableOptions.html)

**Sync Streams (read side)**
- Streams are YAML-defined SQL-like queries. Parameters such as `auth.user_id()` create per-user buckets. "The set of buckets a client receives adjusts as it subscribes to and unsubscribes from streams", and `auto_subscribe: true` syncs on connect. [doc] — [PowerSync: Sync Streams](https://docs.powersync.com/sync/streams)
- Sync Streams "will ultimately replace" Sync Rules, which stay supported meanwhile. [snippet] — [PowerSync usage: sync streams](https://docs.powersync.com/usage/sync-streams)
- Release notes describe a progression: alpha, then Beta (requires `edition: 3` config and PowerSync Service v1.20.0+), then "Generally Available". I could not see the GA date. A migration path exists (dashboard button, `powersync migrate sync-rules`). [snippet] — [PowerSync release announcement A](https://releases.powersync.com/announcements/ann_7UgfQuNwRmpQk); [announcement B](https://releases.powersync.com/announcements/ann_vc4i3noMRt0hJ)
- The 2025 roadmap notes streams still have "limited querying flexibility … e.g. when it comes to multi-level joins and many-to-many relationships". [snippet] — [PowerSync 2025 roadmap](https://powersync.com/blog/2025-powersync-roadmap-update)

**CRDTs through PowerSync**
- PowerSync's CRDT guidance: CRDTs are for cases "where last-write-wins is not sufficient", and "PowerSync becomes the provider for CRDT data — both for local storage and for propagating changes to other clients". [doc] — [PowerSync: CRDTs](https://docs.powersync.com/client-sdks/advanced/crdts)
- The Yjs + Supabase demo [code/README] — [PowerSync Yjs demo](https://github.com/powersync-ja/powersync-js/tree/main/demos/yjs-react-supabase-text-collab):
  - It inserts a `document_updates` row "for every edit/update from the Yjs document".
  - Compaction is a manual `merge-document-updates` Edge Function that "will have race conditions and is only a PoC".
  - "The more edits are made to a document, the longer the Yjs CRDT update history becomes".
  - Per-user scoping and RLS are still to-dos.
- Automerge: concurrent writes to the same property pick a deterministic winner ("'last writer wins' here is based on the internal ID of the operation, not a wall clock time"). Losers are kept and retrievable via `Automerge.getConflicts`. List insertions and deletions are all preserved. [doc] — [Automerge: conflicts](https://automerge.org/docs/reference/documents/conflicts/)

**Figma (server-authoritative, CRDT-inspired)** [doc] — [Figma blog, 2019-10-16](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/)
- "the server is the ultimate authority on what the document looks like"; "Figma isn't using true CRDTs though"; operational transforms are "unnecessarily complex for our problem space".
- Per-property LWW: the winner is "the last value that was sent to the server", so no timestamps are needed.
- Local changes apply immediately. Incoming server values that conflict with unacknowledged local changes are discarded to avoid flicker.
- Offline: "Figma lets you go offline for an arbitrary amount of time and continue editing"; on reconnect it downloads a fresh copy and reapplies offline edits.
- The server rejects reparenting cycles.
- Undo is designed so that undo-then-redo leaves the document unchanged under concurrency.

**Presence / soft locking**
- Supabase Realtime Presence is for "track[ing] state between multiple users". It suits slow-changing state such as "online/offline status, active document, or current page" via `track()`/`untrack()` and `sync`/`join`/`leave` events. Rapid `track()` calls "flood the channel". [doc] — [Supabase: Presence](https://supabase.com/docs/guides/realtime/presence)

### Inferences
**Mapping Overcooked onto these primitives:**
- **Granularity is the conflict policy.** Because PowerSync merges per column per row, split the draft layout into per-element rows (one wall, door, block or placed table per row; client-generated UUIDs, like Figma's offline-safe IDs). Then two tablets editing different elements never conflict, and same-element same-property edits resolve LWW like Figma.
  - Keep a `x`/`y`/`w`/`h`/`rotation` group that must move atomically (e.g. a rotate that also shifts position) either in one JSON `geometry` column or updated in one PATCH. PowerSync's per-field LWW would otherwise interleave two clients' halves (analogous to Figma storing parent+position as one property).
- **Keep the current JSON `content` column with care.** If Overcooked keeps it, enable `trackPrevious` and have `uploadData` send element-level diffs that a Postgres RPC merges into JSONB. Otherwise accept whole-layout LWW (last tablet to sync silently overwrites the other's offline wall edits).
- **Do not use CRDTs for this.** Floor layouts are low-frequency admin config. The PowerSync Yjs demo's caveats (unbounded history, PoC merge, no RLS) and Yjs payloads being opaque to RLS and SQL validation make CRDTs a poor fit. Per-element LWW plus server validation gives Figma-like semantics with plain Postgres rows.
- **Protect live service with server-side business rules** (PowerSync strategy 4):
  - The backend refuses writes to `floor_plan_version` rows (immutable) and to drafts not owned or locked by the writer.
  - It refuses table deletes or seat-count reductions that conflict with open orders (Odoo's open-session guard).
  - Surface refusals through a synced `write_conflicts`/`field_changes` table instead of throwing. In the doc's example a thrown conflict rolls back the whole batch (HTTP 500). That a permanently failing op could stall the ordered upload queue is an inference not stated in the fetched pages.
- **Draft workflow and locking.**
  - Use one draft per floor with an `editing_lock {user_id, device_id, expires_at}` lease row, plus Supabase Presence on a `floor:{id}` channel to show "Chef X is editing on Tablet 2".
  - Treat the lock as advisory offline (presence needs connectivity). Make publish authoritative by checking `draft.version` (PowerSync strategy 2, Wix `revision`).
  - Publish is an online-only RPC: validate (bounds, overlaps, seat coverage, combo membership) → write the immutable version → bump the draft `version`.
- **Sync Streams scoping.**
  - Service tablets subscribe to `published versions for my restaurant` + `today's service state`; these are immutable or service-scoped, with essentially no conflicts.
  - Only admin-role users subscribe to draft streams (`auth.user_id()` / role parameter), with RLS mirroring the stream filters for writes.
  - Avoid many-to-many joins in stream queries given the stated limitations. For example, denormalize `restaurant_id` onto element rows.
- **Service-time mutations are classic per-field LWW or business-rule data.** Joins, table lifecycle state and seat moves happen on many tablets during service. Treat status transitions as state-machine-validated server-side ("invalid_transition" pattern) rather than LWW, so a stale offline "available" cannot overwrite a newer "seated".

### Gaps
- I could not confirm the exact GA date of Sync Streams or which announcement URL is GA vs Beta.
- PowerSync's docs on upload-queue blocking/retry semantics for permanently rejected operations were not fetched.
- Figma's later engineering posts (e.g. on multiplayer reliability) were not reviewed.
- No restaurant vendor documents its own multi-device editor conflict handling.

## 6. Open-source restaurant systems or reference schemas worth learning from

### Takeaway
The two most useful readable references are **Odoo POS Restaurant** and **TastyIgniter's reservation extension**:
- Odoo 18 (`restaurant.floor` / `restaurant.table`): pixel geometry, `parent_id` grouping for joined tables, archive-not-delete, and session-aware edit guards.
- TastyIgniter (`dining_areas` / `dining_sections` / `dining_tables`): capacity ranges, priority, `is_combo` with nested-set hierarchy, JSON floor plan and seat layouts, and a `reservation_tables` join.

### Cited Findings
- **Odoo 18.0 `addons/pos_restaurant/models/pos_restaurant.py`** [code] — [GitHub](https://github.com/odoo/odoo/blob/18.0/addons/pos_restaurant/models/pos_restaurant.py)
  - `restaurant.floor` (`_order = "sequence, name"`): `name` (required), `pos_config_ids` (Many2many → floors can be shared by several POS configs), `background_image`, `background_color` (default `'rgb(249,250,251)'`), `table_ids` (One2many), `sequence`, `active`, `floor_background_image`.
  - `restaurant.table`: `floor_id`, `table_number` (Integer, required, "The number of the table as displayed on the floor plan"), `shape` (`square`/`round`), `position_h`/`position_v` (px to centre), `width`/`height` (px), `seats`, `color`, `parent_id` (group of tables), `active`.
  - `display_name` = `"{floor}, {table_number}"`. Server methods include `sync_from_ui`, `rename_floor` and `deactivate_floor`, plus the session guards listed in §3.
- **TastyIgniter `ti-ext-reservation`** (v4; requires `tastyigniter/core ^v4.0`) [code] — [migration](https://github.com/tastyigniter/ti-ext-reservation/blob/master/database/migrations/2022_09_15_000300_create_dining_areas_sections_tables_add_columns_table.php); [DiningTable model](https://github.com/tastyigniter/ti-ext-reservation/blob/master/src/Models/DiningTable.php); [package](https://root.packagist.org/packages/tastyigniter/ti-ext-reservation)
  - `dining_areas {id, location_id, name, description, floor_plan longText, timestamps}`.
  - `dining_sections {location_id, name, description, color, priority, is_enabled}`.
  - `dining_tables {dining_area_id, dining_section_id?, parent_id?, name, shape?, min_capacity, max_capacity, extra_capacity, is_combo, is_enabled, nest_left, nest_right, priority, seat_layout longText}`.
  - `reservation_tables` gains `dining_table_id` with unique `(reservation_id, dining_table_id)`.
  - Model: `NestedTree` and `Sortable` traits, casts `seat_layout` → array and `is_combo` → boolean; relations `dining_area`, `dining_section`, `reservations` (belongsToMany via `reservation_tables`), `location` (hasOneThrough).
  - Later migrations include "remove_table_id_foreign_key" (2025-03-29) and "add_indexes_to_dining_tables_and_areas" (2025-10-03). File names only seen — [migrations dir](https://github.com/tastyigniter/ti-ext-reservation/tree/master/database/migrations)

### Inferences
- **From Odoo:** the `parent_id` approach (joined tables as a self-reference on the table row) is simple but mixes service-time state into config rows. Overcooked should keep joins in service-scoped rows instead (§2). The guard methods are a good checklist for the publish/edit RPC.
- **From TastyIgniter:**
  - `sections` with `priority`/`color` decoupled from `areas`;
  - `min/max/extra_capacity`;
  - combos as first-class rows flagged `is_combo` (which can be reserved exactly like tables through the same `reservation_tables` join — a neat way to let the availability engine treat "resource = table or combo" uniformly);
  - JSON for presentation-only plan data.

### Gaps
- Floreant POS (ShopFloor/ShopTable) and uniCenta oPOS (floors/places) schemas could not be retrieved in this session; searches returned no primary source.
- No open-source project was found that implements immutable floor-plan versioning or offline multi-device floor editing.
- Odoo branches after 18.0 were not inspected.
