# Reservation & table-management platforms: floor plans, floor-plan editors and live floor views (state as of Nov 2026)

## 1. How does each product's floor-plan editor work in practice (canvas vs list, shapes/sizes, chairs/seats, min/max covers, labels, rotation, walls/décor, background images, rooms/areas, touch/tablet)?

### Takeaway
Every platform reviewed uses a 2D drag-and-drop canvas. You drag tables from a shape palette, then give each one an ID, a min/max cover count and usually a table type or area. Walls and décor are free-floating decorative objects, never structural elements. The more mature systems separate the table record (identity, capacity, area, bookability) from where it sits in one or more layouts: ResDiary, Tablein, Libro and Toast all work this way. Tablet editing ranges from full (Resy, Zenchef, SevenRooms) to web-only (OpenTable, Yelp; a third-party blog also recommends the web for TheFork Manager).

### Cited Findings

#### Tock (Availability Planning; legacy "Blueprints" style) — primary help center, fetched via the Zendesk API
- The floor plan is built inside an Availability Planning **Schedule**: Control Panel → Availability Planning → "+ Add schedule" → name + date range → "Continue to Floor Plan". It has three levels: **Rooms** ("Multiple rooms allow you to switch between floor plans during service"), **Sections** (group tables visually and allow "batch actions such as adding or removing blocks") and **Tables** ("the flexible inventory and individual capacities in which reservations can be booked") — [Tock: Building Floor Plans for Availability Planning](https://tock.zendesk.com/hc/en-us/articles/360043858291-Building-Floor-Plans-for-Availability-Planning) (created 2020, edited Sep 2024, updated Aug 2026).
- **Single table** fields: Name/Number, Minimum and Maximum party size, and Section. **Multiple tables** fields: section, quantity, min/max party size, size and shape, and a naming scheme of "Alphanumeric (B1, B2, B3, etc) or Numeric (1, 2, 3, etc)". "Duplicate table" copies a table but asks for a new name. "Edit multiple tables" lets you resize, drag or delete several tables at once — [same](https://tock.zendesk.com/hc/en-us/articles/360043858291-Building-Floor-Plans-for-Availability-Planning).
- Layout controls: size "Sm, Md, or Lg"; shape "square, round, rectangular, or semi-circle"; "Rotate the table clockwise or counterclockwise" (step size not stated); drag and drop to move — [same](https://tock.zendesk.com/hc/en-us/articles/360043858291-Building-Floor-Plans-for-Availability-Planning).
- Renaming a table after a schedule is published means duplicating it: "Duplicate the table within the Floor plan tab … to adjust the table name" — [Tock: Availability Planning FAQs](https://tock.zendesk.com/hc/en-us/articles/360044451111-Availability-Planning-FAQs) (edited Apr 2025).
- Legacy Blueprints: you create a room by adding a table to a new room, and "Edit Layout" changes size, shape and orientation. Blueprints "isn't available on all dashboards" — [Tock: Arranging Tables and Rooms with Blueprints](https://tock.zendesk.com/hc/en-us/articles/360030883032-Arranging-Tables-and-Rooms-with-Blueprints) (edited Dec 2023).
- Guest-facing **Seating Options** are set per table, with a fixed list of names: "You cannot create custom Seating Option names" — [Tock: Setting Up Seating Options](https://tock.zendesk.com/hc/en-us/articles/19144577993876-Setting-Up-Seating-Options-in-Availability-Planning) (edited Sep 2026).

#### Resy (ResyOS iPad app + Resy Dashboard web) — primary help center (Kustomer KB)
- **Web:** Venue → Floor Plans → New Floor Plan → "Add Table". Fields are Table ID ("must be unique (i.e., you can only have one table 20 on your floor plan)"), Table Type ("Dining, Bar, Patio, High Top"), Min/Max Seats ("capacity for the party size that will be allowed to book and be assigned to this table") and Shape. "Add Decor (shapes)" and "Duplicate" are also available — [Resy: Floor Plan Web Editor](https://helpdesk.resy.com/en_us/floor-plan-on-web-SyTdJuBp9) (Oct 2025); [Resy: Floor Plan Edits in ResyOS and on Web](https://helpdesk.resy.com/how-to-create-and-edit-floor-plans-in-the-resyos-app-Hk16bwXUO) (Sep 2026).
- **iPad:** "Tap and drag the white shapes at the bottom of the floor plan to create a new table … resized by pinching or expanding." "Tap and drag blue dots to resize the shape. Use the orange dot to rotate the shape." A Manage Floor Plans window handles new (+), rename, copy ("for holidays or events") and delete — [Resy: ResyOS Floor Plan Editor](https://helpdesk.resy.com/en_us/floor-plan-editor-SJ5M493VY) (Sep 2026).
- **Identity is tied to the label:** "If you change the Table ID (Table Number) on existing tables, the existing reservations will become unassigned." Changing the ID back reassigns them — [same](https://helpdesk.resy.com/en_us/floor-plan-editor-SJ5M493VY).
- **Tablet editing is fragile:** "If the iPad is locked, rotated, locked by inactivity, or switches apps, all unsaved changes to your floor plan will be lost. Please lock the 'rotate screen' function before making floor plan edits." The Edit Floor Plans menu only appears for users with the right permissions — [Resy: Floor Plan Edits in ResyOS and on Web](https://helpdesk.resy.com/how-to-create-and-edit-floor-plans-in-the-resyos-app-Hk16bwXUO).
- **Printing:** the iPad prints the floor plan in black and white, and "Seating capacity dots will change to numbers to signify the minimum and maximum seating capacity." On screen, then, capacity appears as dots. Printing isn't available on iPhone — [Resy: ResyOS Floor Plan Editor](https://helpdesk.resy.com/en_us/floor-plan-editor-SJ5M493VY).
- New tables and combinations are "in-house by default". Making them online or walk-in means editing shift settings in the web Dashboard, and Resy says to use Chrome — [same](https://helpdesk.resy.com/en_us/floor-plan-editor-SJ5M493VY).

#### SevenRooms — help center is login-gated (HTTP 403); public sources only
- Required go-live setting "Floorplan Settings: Review your Floorplan Layout, edit Rooms, Seating Areas, Tables, and Table Combinations" — [SevenRooms: Getting Started: Account Setup](https://sevenrooms.com/newcustomer/settings/). The detailed article [Configure Floorplan Settings](https://help.sevenrooms.com/hc/en-us/articles/22268257714459-Configure-Floorplan-Settings) returned 403.
- **The vendor builds the floor plan for you:** venues upload a "file, screenshot, or image" showing table numbers and locations, seating areas, rooms and furniture. The "design team" recreates it in the account (about 2 business days) and sets up table capacities and combinations — [SevenRooms: Upload your floorplan](https://go.sevenrooms.com/SendSafely-AE_LPSendSafely.html).
- The onboarding template asks for seating areas/sections, each table number with min & max capacity, the table's seating area, and combos with min & max. Examples include "1 (3-4)", "1+2 (7-8)", "1+2+3 (8-10)" and bar seats as single-cover tables "B1 (1-1)", "B1+B2+B3 (3-3)" — [SevenRooms Floorplan Template (PDF)](https://go.sevenrooms.com/rs/519-YNM-008/images/%28MAKE%20A%20COPY%29%20SevenRooms%20Floorplan%20Template%20-%20Floorplan%20Build.pdf?version=0).
- iPad floor plan editor in Mobile 4.0, **Sept 2018 (possibly outdated)**: "Clone tables", rotate "to the exact degree you want them at", "One-click-align multiple tables at once", rectangular tables and structural elements, change dimensions and colors, add text including emojis, and a grid-mode background. Found under Settings → Layouts on iPad — [SevenRooms blog: Introducing Mobile 4.0](https://sevenrooms.com/blog/mobile-4-0/).
- A 2018 blog says the floor plan shows chair counts and table combinations and has toggles between floor views — [SevenRooms blog: Restaurant Floor Plan](https://sevenrooms.com/blog/restaurant-floor-plan/) (Nov 2018).

#### OpenTable (GuestCenter / OpenTable for restaurants) — support site is a JS-rendered Salesforce community; details below come from search-indexed text of the articles
- Floor plans are customized dining-room layouts made of tables. Each table has a unique table name, accepted party sizes, a table type (Regular, High-Top, Counter, Bar, Outdoor) and a dining area. Floor plans and combinations are only available on Core and Pro. Availability Planning settings, which include the floor plan, are not available on mobile devices, including the OpenTable iPad app (paraphrased by the search tool, not verbatim) — [OpenTable: Availability Planning Glossary](https://support.opentable.com/s/article/apglossary?language=en_US) (seen via search snippets only).
- Official tutorial videos exist with the titles "How to Create a New Floor Plan in OpenTable", "How to Add a Floor Plan to a Schedule in GuestCenter Admin" and "Server Sections" — [YouTube: Create a New Floor Plan](https://www.youtube.com/watch?v=SdHUDqvNX1I); [YouTube: Add a Floor Plan to a Schedule](https://www.youtube.com/watch?v=eMG5IXxJETA); [YouTube: Server Sections](https://www.youtube.com/watch?v=o9w-w4lk0IY).

#### Zenchef — primary help center
- **Web:** Settings → Service & Reservations → Rooms/Areas and tables → Layout → "New room". Then "Add a table", select the table type, and "Adjust the position, table number, number of covers, and rotation" → Confirm → Save. Use "add a decoration" for "the bar, stairs or plants" — [Zenchef: How to create a room?](https://help.zenchef.com/hc/en-gb/articles/211658729-How-to-create-a-room) (edited Apr 2026); [Zenchef: How do I add a table to my room?](https://help.zenchef.com/hc/en-gb/articles/211671989-How-do-I-add-a-table-to-my-room) (Jul 2025).
- The room canvas size is set with Width/Height, and there are undo arrows — [Zenchef: How do I edit the size of an area?](https://help.zenchef.com/hc/en-gb/articles/211671929-How-do-I-edit-the-size-of-an-area). "Only tables in editable rooms can be dragged"; you must click both Confirm and Save — [Zenchef: How do I edit my seating plan?](https://help.zenchef.com/hc/en-gb/articles/211685349-How-do-I-edit-my-seating-plan).
- The iOS app can create rooms and add or edit tables — [Zenchef: Modify a table in iOS](https://help.zenchef.com/hc/en-gb/articles/115000834505-How-to-modify-a-table-in-my-venue-in-IOS). Customizing the seating-plan display is web-only — [Zenchef: Customise the display](https://help.zenchef.com/hc/en-gb/articles/360000256998-How-can-I-customise-the-display-of-my-seating-plan).
- Guests never see layouts. With room choice on, they see only room names — [Zenchef: How to create a room?](https://help.zenchef.com/hc/en-gb/articles/211658729-How-to-create-a-room).

#### Eat App — primary knowledge base
- Floor view → "Floor configuration ⋮" → "Edit layout". Pick a table shape from the selector icons, then either "click and drag a table from the table shape selector or click and drag on the floor to create custom table sizes". You must click "Save Room" — [Eat App: Adding tables](https://restaurant.eatapp.co/knowledge/adding-tables) (Aug 2024).
- Rotate a table by dragging its rotate icon — [Eat App: Rotating tables](https://restaurant.eatapp.co/knowledge/rotating-tables). Each table has "Min. Covers"/"Max Covers" — [Eat App: min/max covers](https://restaurant.eatapp.co/knowledge/setting-minimum/maximum-number-of-covers-per-table). A per-table Online toggle controls web bookability — [Eat App: Allowing a table to be booked online](https://restaurant.eatapp.co/knowledge/allowing-a-table-to-be-booked-online).
- The top of the edit screen shows a room summary: total min/max capacity, number of tables and how many are available online — [Eat App: How to know your room details](https://restaurant.eatapp.co/knowledge/how-to-know-your-room-details).
- **Floor Plan Importer:** View → Import Floor Plan. Upload a PNG, JPG/JPEG or PDF, and Eat App "automatically detects tables, their shapes, and seating capacities". One room per file. Works best with a light background and high-contrast outlines. Staff review the result, delete wrong detections, then click "Create room with X tables" — [Eat App: Floor plan importer](https://restaurant.eatapp.co/knowledge/floor-plan-importer) (screenshots dated 31 Aug 2026).
- The setup guide lists "New Floor Plan Enhancement (with editor for shapes and images)" but gives no details — [Eat App: Floor layout setup guide](https://restaurant.eatapp.co/knowledge/floor-layout-set-up-guide). The widget can embed a Matterport 3D tour, which support has to enable — [Eat App: 3D floor view](https://restaurant.eatapp.co/knowledge/how-to-enable-the-3d-floor-view-in-the-eat-app-widget).

#### Tablein — primary help center
- The editor is at admin.tablein.com/floor-plan/edit. **All tables are listed in a left sidebar, and placed tables show a green checkmark.** Drag a table onto the canvas, then change its shape, rotate it, or switch between small and large. Each table has a number of guests and an online-bookable flag.
- A **red outline means a table is too close to another**, "because reservation cards display on tables during service".
- The Elements tab adds "elements, text, icons, decorations, and furniture", which can be resized, flipped, recolored or duplicated.
- Each area guests can choose online must be its own dining room. Table order sets the priority for automatic allocation.
- Source: [Tablein: Setting up the floor plan](https://help.tablein.com/setting-up-the-floor-plan) (screenshots Jun 2026).

#### ResDiary — help center now lives at help-resdiary.theaccessgroup.com
- **Tables are list records** (Settings → Tables): Type (normal or phantom), Number, Description, Status, Maximum Covers, Area. You can't delete a table that has future bookings; disabling it unallocates those bookings — [ResDiary: Create, edit or delete your table](https://help-resdiary.theaccessgroup.com/en/articles/12080722-create-edit-or-delete-your-table) (Sep 2025).
- **Visual placement is a separate tool, the "Table Plan Editor"**, which supports multiple views per segment. Select a table and a shape from the right-hand panel, click "Add Table", drag it into place, or use "Remove from view". Object categories are "Rooms", "Walls and Pillars", "Objects" and "Sections". Tip: "Enable show grid lines and snap to grid" — [ResDiary: Create and manage your table plan](https://help-resdiary.theaccessgroup.com/en/articles/12080839-create-and-manage-your-table-plan) (Oct 2025).
- From search snippets: areas carry flags for online reservations and for counting toward max covers/bookings, and a table plan image is optional — [ResDiary Account Setup page](https://www.resdiary.com/AccountSetup/84c385b2-6461-4365-8fc6-6f8e15bd14a3).

#### TableCheck (Japan/APAC; strong in hotels and fine dining) — primary help center
- Create a table by dragging a shape from the panel or with "New Table". A grid background appears while moving tables, and you can select several tables to edit at once.
- Table fields: Name, **Seating** (online seating capacity range), Shape, Size, Rotation, **Seat Type**, **Smoking?**, **Tier** ("tie specific tables to specific menu offerings"), **Purposes**, **Roles** (restrict the table to certain user roles), **Online?**, Separator in Timetable, Turnover and Memo. Seat Type, Smoking and Purposes are enabled through support.
- Source: [TableCheck: Create / edit / delete Tables](https://support-restaurants.tablecheck.com/hc/en-us/articles/900000835123-Create-edit-delete-Tables) (edited Jul 2024).
- **Sections** within a floor plan (unlimited; names up to 10 characters) can each have an **optional background image**. Caveats from TableCheck:
  - tables must still be placed manually;
  - "remove the tables from the image" first, or they won't line up;
  - the image hides the sheet and floor-plan names;
  - in dark mode, white table labels are hard to read on light images.
  - Source: [TableCheck: Create / edit / delete Sections](https://support-restaurants.tablecheck.com/hc/en-us/articles/900000840246-Create-edit-delete-Sections).
- A separate List tab orders tables for the Timetable view (manual drag or "Autosort Table") — [TableCheck: Rearranging Tables](https://support-restaurants.tablecheck.com/hc/en-us/articles/900000840286-Rearranging-Tables).
- Zoom in/out on the Floor View was added 2 Jul 2025 "to reduce the risk of selecting the wrong table, especially on tablets" — [TableCheck: Feature Updates (zoom)](https://support-restaurants.tablecheck.com/hc/en-us/articles/48477328268569-Feature-Updates-Zoom-in-out-on-Floor-View-Relocation-of-Language-field-in-Customer-Profile).

#### Toast Tables (Toast's reservation/waitlist product) — primary docs, partly via snippets
- The layout is set up in the POS: "Your table layout (sometimes called a floor plan) is the visual map of tables, barriers, and labels for a service area", edited in Toast Web. The host app imports the floor plan and server roster from Toast POS. Toast creates one dining area per POS service area by default; areas can be combined by drag-and-drop, renamed, reordered or hidden — [Toast: Get Started With Toast Tables](https://support.toasttab.com/en/article/Getting-Started-Toast-Waitlist) (last updated Mar 2026; snippet); [Toast: Create Service Areas and Table Setup](https://support.toasttab.com/en/article/Creating-Service-Areas-and-Table-Setup-1493049150430?lang=en_US) (snippet).

#### Other strong or adjacent examples
- **Libro (Canada; new dashboard 2026):**
  - Right-click to enter "Edit Floor Plan" mode, then "Add Table".
  - Table fields: number, shape (rectangle or round), dimensions, min/max guests, associated experience, internal availability, online availability.
  - **"the maximum number determines the number of chairs at the table"** and you can **"Rotate chairs to set their position around the table"**.
  - Recommended sizes: 22×22 (1 guest or bar seat), 24×24 (2), 24×36 (3–4), 24×38 (5–6). It warns against anything under 18×18 because the times on the table become hard to see.
  - **"using the same table number across different floor plans will link those tables together as a single entity"**: a reservation on one syncs to the same-numbered table in the other plan.
  - Source: [Libro: New Dashboard: Modify the Floor Plan](https://libroreserve.zendesk.com/hc/en-us/articles/47236864860059-New-Dashboard-Modify-the-Floor-Plan) (edited Apr 2026).
- **TheFork Manager** (search snippets of its Salesforce support pages; the index showed the article as about 3.3 years old, i.e. c. mid-2023, so possibly outdated): configure size, shape and covers before cloning a table; tables can be resized, rotated, duplicated or deleted; click "SAVE AREA" when done — [TheFork Manager: How do I create a floor plan?](https://support.theforkmanager.com/s/article/How-do-I-create-a-floor-plan?language=en_US). A third-party French blog recommends the web interface rather than the mobile app for advanced floor-plan setup — [parrainduweb.fr: TheFork Manager](https://parrainduweb.fr/blog/thefork-manager).
- **Yelp Guest Manager:** the "Floormap Editor" is web-only: "you can't customize the Customization tab iPad app – these can only be created on the full site". App Settings separately cover "seating areas and speed keys" — [Yelp: Customization tab](https://biz.yelp.com/support-center/article/What-settings-am-I-able-to-customize-under-the-Customization-tab-in-Yelp-Guest-Manager). A customizable floor plan is on the Plus and Enterprise tiers (snippet) — [Yelp pricing](https://business.yelp.com/restaurants/yelp-restaurants-pricing/). Since Mar 2024, "Owners can control which team members can change floor plans" — [Yelp: Guest Manager product news](https://business.yelp.com/restaurants/products/guest-manager-product-news/).
- **resOS:** décor shapes include doors, stairs and plants (snippet) — [resOS: floor plan setup](https://resos.com/support/floor-plan-setup-and-walkthrough/). Multiple floor plans "such as the main floor, the bar, or a setup for specific events" were added 29 May 2024 — [resOS What's New](https://resos.com/whats-new/create-multiple-floor-areas-in-visual-table-planner/).
- **Carbonara** (vendor marketing, unverified): turns a sketch into an interactive map "in under a minute" and auto-merges tables for larger parties — [Carbonara: Quandoo alternative page](https://quandoo-alternative.carbonaraapp.com/).

#### Market and ownership context (affects how current the sources are)
- In Feb 2026 Amex announced that Resy would absorb Tock. The Tock consumer app and exploretock.com are being decommissioned, while reports say "Tock's restaurant management software is staying and becoming part of Resy's product suite" — [Restaurant Business: Resy, Tock are merging](https://www.restaurantbusinessonline.com/technology/reservation-services-resy-tock-are-merging); [Frequent Miler](https://frequentmiler.com/after-purchasing-tock-amex-to-fold-it-into-resy-in-summer-2026/); [eMarketer](https://www.emarketer.com/content/amex-will-integrate-tock-resy-platform-personalization-experiential-rewards). Tock help articles now send plan questions to "hospitality@resy.com" — [Tock: Table Optimizations](https://tock.zendesk.com/hc/en-us/articles/49500183465236-Table-Optimizations-for-Availability-Planning). A furniture seller's blog (updated May 2026) goes further, saying "Tock as a standalone product will cease to exist" — [Superior Seating](https://www.superiorseating.com/blog/the-8-best-restaurant-reservation-apps). That conflicts with the reports that Tock's restaurant software stays.
- An Entrepreneur headline reports that DoorDash spent $1.2B on a reservation platform to take on OpenTable — [Entrepreneur](https://www.entrepreneur.com/business-news/doordash-buys-12b-reservation-platform-to-battle-opentable/502986). The article was not opened; that it refers to SevenRooms is background knowledge, not verified in this research.
- Carbonara says Quandoo will end its reservation service on 30 Sep 2026 (vendor claim) — [Carbonara](https://quandoo-alternative.carbonaraapp.com/).

### Inferences
- The industry baseline is a canvas editor plus a table record: ID/label, min/max covers, type or area, and an online/in-house flag. Overcooked's model covers this core. Its walls and doors as grid edges are more structured than anything found. Competitors treat walls as décor objects: ResDiary "Walls and Pillars", Resy "decor shapes", Zenchef "decorations", Tablein "Elements", SevenRooms "structural elements".
- Overcooked keeps tables restaurant-wide and places them per layout. ResDiary (table list plus per-segment views), Tablein (sidebar of all tables with a "placed" checkmark) and Libro (same number in two plans links them) all follow the same idea. Tablein's checkmark sidebar is a direct UX pattern for "which tables aren't in this layout yet".
- Resy and Tock tie table identity to the visible ID. In Resy, changing the ID unassigns reservations; in Tock, renaming after publish needs a duplicate. Overcooked should keep immutable internal IDs with freely editable labels, as it appears to already do.
- Free rotation is common (Resy, SevenRooms "exact degree", Eat App, TableCheck, Zenchef). Overcooked's 90° steps fit a grid but can't show angled tables; this matters little for most fine-dining rooms.
- Shapes Overcooked lacks:
  - Tock's semi-circle shape and OpenTable's "Counter" type.
  - SevenRooms' bar seats modelled as 1-cover tables (B1, B2…).
  - Chef's counters and banquettes are common in tasting-menu rooms and may need a counter or booth primitive with a row of seats rather than a single table.
- Seats on the canvas: Libro draws chairs from max covers and lets you rotate chair positions, Resy shows capacity dots, and TableCheck has seat icons. These are the closest analogues to Overcooked's "which side each seat sits on", and none goes further.
- Tablet editing is a selling point but fragile (Resy loses unsaved work on lock or rotation). An offline-first, multi-tablet editor should autosave drafts and survive the app being backgrounded.
- Setup is getting easier through white-glove builds (SevenRooms, about 2 business days) and image-to-layout import (Eat App, Aug 2026; Carbonara claim). A traceable background image (TableCheck, with its caveats) is a cheaper middle ground.
- The live view drives editor constraints: Libro's minimum table sizes, Tablein's spacing rule for reservation cards and TableCheck's zoom all show this. Overcooked's grid cell size and table sizes should be tested against what the Service Board needs to show (seat chips, course state).

### Gaps
- SevenRooms' help center (help.sevenrooms.com) requires login (403 via web fetch and Zendesk API), so its current editor (2024–2026) is unverified. The Mobile 4.0 details date from 2018.
- OpenTable and TheFork Manager help pages are JS-rendered Salesforce communities that couldn't be rendered. Their details come from search-engine snippets, and the current OpenTable editor's shapes, rotation and décor tools remain unknown.
- Yelp's separate "edit your current floor plan" article wasn't found, so its shapes and décor are unknown.
- Toast Web's layout editor (shapes, rotation, barriers) wasn't retrieved beyond the snippet definition.
- No current table-management product called "Tablesavvy" could be identified, so it wasn't researched.
- Background-image underlays are confirmed only for TableCheck (per section) and Eat App (importer, plus "images" in the enhancement label).

## 2. How are multiple floor plans handled (per shift, day, season, events) and how is the active one chosen?

### Takeaway
Floor plans are nearly always tied to a time construct:
- a shift (Resy, OpenTable);
- a schedule or Special Day (Tock, OpenTable);
- a sheet, i.e. a meal period (TableCheck);
- a service (Zenchef rooms);
- a segment (ResDiary);
- a layout's opening hours (Tablein).

The usual one-off pattern is to duplicate the layout, edit the copy and activate it for that day or event. Newer tools add same-day "live" overrides that change what's bookable without touching the layout (Zenchef Live Availability, Tock table optimizations).

### Cited Findings
- **Resy:** floor plans must be activated per shift. In the Dashboard (Chrome): Service → Shift Settings → Edit Shift → "Step 2 Service Settings" → Floor Plans → "Edit" next to "Active Floor Plans" → toggle → "Step 3 Availability" (Online / In-House / Walk-in, or "More Customization") — [Resy: Activating a New Floor Plan](https://helpdesk.resy.com/how-to-activate-floor-plan-and-edit-table-availability-in-dashboard-for-a-shift-BJEnbPXUd) (Oct 2025).
  - For a single day, holiday or event: duplicate the floor plan (two-page icon), rename and edit it, then activate it for that day or shift — [Resy: Single Day Floor Plan Updates](https://helpdesk.resy.com/how-to-update-a-floor-plan-for-a-single-day-H1z3v7Ud) (2023); [Resy: ResyOS Floor Plan Editor](https://helpdesk.resy.com/en_us/floor-plan-editor-SJ5M493VY).
  - Pacing can be set per floor plan ("Customize Pacing by Floorplan… to account for factors such as space constraints, server availability, and customer preference"), or left global — [Resy: Availability and Pacing Updates](https://helpdesk.resy.com/how-to-edit-table-availability-and-pacing-in-a-shift-S1T3bPXLd) (Oct 2025).
- **Tock:** the floor plan lives inside a Schedule.
  - Schedules have a date range of up to 365 days and can't overlap. Special Days handle one-day changes ("How can I make changes to my floor plan … for one day? Special Days…").
  - When a new schedule is published, existing reservations "will be automatically reassigned to a table that fits them", and anything that doesn't fit goes to "Unassigned reservations". Changes apply from the next day unless "Publish to today" is toggled.
  - Source: [Tock: Availability Planning FAQs](https://tock.zendesk.com/hc/en-us/articles/360044451111-Availability-Planning-FAQs).
  - Rooms let staff "switch between floor plans during service" — [Tock: Building Floor Plans](https://tock.zendesk.com/hc/en-us/articles/360043858291-Building-Floor-Plans-for-Availability-Planning).
  - Optimizations carry over when a Schedule or Special Day is duplicated — [Tock: Table Optimizations](https://tock.zendesk.com/hc/en-us/articles/49500183465236-Table-Optimizations-for-Availability-Planning).
- **OpenTable:** floor plans are attached to shifts in the weekly Schedule or on a Special Day (search snippet of the glossary) — [OpenTable: Availability Planning Glossary](https://support.opentable.com/s/article/apglossary?language=en_US); [YouTube: Add a Floor Plan to a Schedule](https://www.youtube.com/watch?v=eMG5IXxJETA).
- **TableCheck:** "You can have multiple table layouts… Each layout created has to be assigned to a sheet (meal period)", and an existing layout can be copied — [TableCheck: Creating a table layout](https://support-restaurants.tablecheck.com/hc/en-us/articles/900000835263-Creating-a-table-layout). Sheets are either Regular (days of the week or a date range) or Irregular (specific days). Each sheet selects its Floor Plan and its Pace Rule — [TableCheck: Creating a New Sheet](https://support-restaurants.tablecheck.com/hc/en-us/articles/900000839786-Creating-a-New-Sheet) (Sep 2024).
- **Zenchef:**
  - Rooms are switched on per service as "activate", "non-bookable" or "disabled" — [Zenchef: Discover the seating plan](https://help.zenchef.com/hc/en-gb/articles/18072176415901-Discover-the-seating-plan-with-Zenchef).
  - For seasonal rooms: "if you just want to close the room for a while (e.g.: your terrace during winter), it is possible to disable a room by dissociating it from your services." Enabling a room only on certain days requires "Table stock" — [Zenchef: How to create a room?](https://help.zenchef.com/hc/en-gb/articles/211658729-How-to-create-a-room).
  - **Live Availability** (created Sep 2026; Manage and Grow plans; web, iOS ≥4.0.71 and Android) lets staff change a single day without touching settings: Mark as full, make an Area unbookable, or adjust Pacing.
    - A warning says how many reservations "will need new table assignments".
    - These changes don't appear in the Exception list; an orange/red indicator shows instead.
    - With concurrent edits "the most recent save is the one that applies".
    - Source: [Zenchef: Live Availability](https://help.zenchef.com/hc/en-gb/articles/39180398112157-Live-Availability-Change-your-dining-room-during-service).
- **ResDiary:**
  - Segments temporarily change parts of the table plan, e.g. opening an extra area at peak times or sports-event segments with auto-joined tables, and then revert (snippets) — [ResDiary: yield management](https://resdiary.com/blog/maximising-yield-using-the-venues-floor-space?region=IN); [ResDiary: sports events](https://resdiary.com/blog/prepare-venue-sports-events).
  - Table Plan Editor views are created per segment — [ResDiary: table plan](https://help-resdiary.theaccessgroup.com/en/articles/12080839-create-and-manage-your-table-plan).
  - The iPhone app can close out one area for a service, an area for a day, one service across areas, or the whole venue (snippet) — [ResDiary Plus mobile update](https://resdiary.com/product-updates/updated-mobile-experience-with-resdiary-plus).
- **Tablein:** each layout needs at least one dining room plus tables and can have its own opening hours. Tablein recommends a single layout because blocking online bookings has to be done per layout — [Tablein: Setting up the floor plan](https://help.tablein.com/setting-up-the-floor-plan). There is also an article on moving a dining room to another layout (title only) — [Tablein: move a dining room](https://help.tablein.com/move-a-dining-room-and-tables-to-another-floor-plan-layout).
- **Toast Tables:** combo tables can be limited to particular Service Periods and flagged as bookable online or not (snippet) — [Toast: Get Started With Toast Tables](https://support.toasttab.com/en/article/Getting-Started-Toast-Waitlist).
- **Libro:** a whole floor plan can be turned off with a toggle in the Back Office — [Libro: Modify the Floor Plan](https://libroreserve.zendesk.com/hc/en-us/articles/47236864860059-New-Dashboard-Modify-the-Floor-Plan). **resOS:** separate floor plans for the main floor, the bar or events — [resOS What's New](https://resos.com/whats-new/create-multiple-floor-areas-in-visual-table-planner/). **Eat App:** staff switch between rooms in the floor view — [Eat App: Floor View](https://restaurant.eatapp.co/knowledge/floor-view).

### Inferences
- Overcooked's model (an Area has several layouts, one is the service's default) matches Resy, OpenTable and TableCheck. The likely gaps are:
  - a per-date override (Tock Special Day, Resy single-day copy, TableCheck irregular sheet);
  - one-tap "duplicate layout";
  - a clear marker of when a non-default layout or live override is active (Zenchef's indicator);
  - defined behaviour for existing reservations when the layout changes (Tock auto-reassigns and shows an Unassigned bucket; Zenchef warns with a count).
- Overcooked tables are restaurant-wide with stable seat numbers, so switching layouts should only move positions and never unassign reservations. Libro gets this through number-linking; Resy and Zenchef can unassign bookings.
- Live, same-day bookability toggles (mark area unbookable, close a slot, release held tables at T-minus) are a separate layer from layout editing and should stay separate in Overcooked. Tock's timed "release in-house tables / raise minimum party size X hours before service" fits fixed-seating tasting menus well.

### Gaps
- SevenRooms' handling of multiple layouts per shift couldn't be verified (gated help center).
- The exact OpenTable UI for choosing floor plans per shift (one or several) is unknown, as is whether its floor plans can differ per seating within a shift.
- Resy's plural "Active Floor Plans" suggests several plans can be active in one shift, but no source confirms how that behaves.

## 3. How do they define table combinations, server sections, blocked tables and accessibility flags, and how do these feed availability and pacing?

### Takeaway
Availability is built from:
- a per-table bookability attribute (online / in-house / walk-in / blocked / inactive), set per service or per 15-minute slot;
- pacing (maximum covers per 15 minutes);
- table priority or ranking;
- combinations, which are either listed one by one (Tock, Resy, ResDiary, Eat App's "old" grouping, Toast) or generated automatically from tables marked joinable (Eat App's "new" grouping; SevenRooms' algorithm claim).

Server sections are a service-time tool (colors, rotation, cover counts) and don't affect online availability. No reviewed product documents a dedicated accessibility flag on tables.

### Cited Findings

#### Combinations / joins
- **Tock:**
  - To create a combination, select at least two tables and set its min/max party size. In each Service, a combination can be toggled online or in-house only, from either the Floor plan or Advanced Grid view.
  - A combination offers an experience only when "all the individual tables that make up the combination offer that same experience".
  - A combination "has a block applied if any number of the individual tables … have a block applied".
  - Source: [Tock: Setting up Table Combinations](https://tock.zendesk.com/hc/en-us/articles/15126385902612-Setting-up-Table-Combinations-for-Availability-Planning) (Apr 2026).
  - A combination's seating options can only be changed by deleting and recreating it — [Tock: Seating Options](https://tock.zendesk.com/hc/en-us/articles/19144577993876-Setting-Up-Seating-Options-in-Availability-Planning).
- **Tock assignment order:** perfect-fit tables (high → low priority), then perfect-fit combinations, then tables that fit a range, then combinations that fit a range. "The rebalancer prefers a perfect fit… to any priority." Blocked and in-house tables can't take a priority. Priority indicators can be shown on the Timeline — [Tock: Table Prioritization](https://tock.zendesk.com/hc/en-us/articles/16885642433172-Using-Table-Prioritization-in-Availability-Planning).
- **Tock Table Optimizations** (new 2026; not on every plan) apply automatically at a set time before service: release blocked or in-house tables online, change the minimum party size, or add/remove Experiences. They are configured per table and per service, affect only future bookings, and optimized tables are "outlined in blue" on the Timeline — [Tock: Table Optimizations](https://tock.zendesk.com/hc/en-us/articles/49500183465236-Table-Optimizations-for-Availability-Planning).
- **Tock multi-experience and communal tables:** a table can carry up to five experiences, but a party books only one — [Tock: Multi-Experience Tables](https://tock.zendesk.com/hc/en-us/articles/22751441190292-Setting-up-Multi-Experience-Tables). Communal tables are sold as tickets, with "Allow stragglers" and "Even party sizes only" options — [Tock: Adding a Communal Table](https://tock.zendesk.com/hc/en-us/articles/360039840152-Adding-a-Communal-Table).
- **Resy combinations and availability:**
  - On the web, Cmd/Ctrl-click tables, then "Create Combo", then set Table Type and Min/Max seats. On iPad: Combinations tab → "Create Combo" → tap the tables. New combinations are in-house by default — [Resy: Create and Add Combination Tables](https://helpdesk.resy.com/en_us/create-and-add-combination-tables-B11ofhdZh) (Oct 2025).
  - Every table carries an "online, in-house, or walk-in" attribute, set per Table Type or per table, and can differ by 15-minute increment ("More Customization"; a table with several attributes shows as "Mixed").
  - Pacing is the maximum covers bookable online per 15 minutes; "Internally, you can make reservations that exceed pacing."
  - Source: [Resy: Availability and Pacing Updates](https://helpdesk.resy.com/how-to-edit-table-availability-and-pacing-in-a-shift-S1T3bPXLd).
  - Resy recommends setting tables Online and "controlling the flow of guests with pacing" — [Resy OS FAQ](https://helpdesk.resy.com/resyos-faq-B1ciD7Uu).
- **OpenTable** (snippets):
  - Combinations are created in Availability Planning and can be customized per shift. Unavailable combinations "will appear on the floor plan and can be assigned or sat, but will not be offered for reservations or considered for the waitlist" — [OpenTable: Advanced availability setup (JA)](https://support.opentable.com/s/article/Advanced-availability-setup-in-GuestCenter?language=ja); [OpenTable: Glossary](https://support.opentable.com/s/article/apglossary?language=en_US).
  - "Turn controls on a combination will override party size controls" — [OpenTable: Turn controls](https://support.opentable.com/s/article/turn-controls?language=en_US).
  - Shift settings define which table types are bookable online, held for in-house bookings, or kept for walk-ins (glossary snippet).
  - "Smart Assign" is on the Core and Pro plans — [OpenTable: Core plan](https://www.opentable.com/restaurant-solutions/plans/core/). Marketing says it lets "the system automatically fill seats while giving you more control over which tables are assigned to regulars or VIPs" and dates it to an Oct 2023 feature drop (marketing snippet) — [OpenTable restaurant solutions page](https://www.opentable.com.au/restaurant-solutions/?p=88284).
- **Eat App:**
  - **Old Table Grouping (Recommended):** every combination is defined by hand ("Tables 1-2-3-4-5, 1-2-3-4, 1-2-3, 3-4-5…"), and if any table in a group is booked, that combination becomes unavailable.
  - **New Table Grouping:** "simply select the tables that are allowed to be grouped. The system will then automatically create and assign the best table combinations."
  - The largest party size offered in the widget depends on max covers and the per-reservation limit.
  - Source: [Eat App: Table Grouping](https://restaurant.eatapp.co/knowledge/table-grouping) (Feb 2026).
- **ResDiary:**
  - "Table Joins" are created as a chain of tables with a capacity ("Add New Chain"). ResDiary advises adding every combination, and joins can be ranked per capacity by drag-and-drop ("the join on top… will be the first to be sold") — [ResDiary: Create your table joins](https://help-resdiary.theaccessgroup.com/en/articles/12082484-create-your-table-joins).
  - **Temporary joins** are made from the booking form, apply to a single booking and show a broken-link icon — [ResDiary: temporary table join](https://help-resdiary.theaccessgroup.com/en/articles/12304448-create-your-temporary-table-join).
  - **Phantom tables** are "a spare manager table… ready to be used when needed", for example when a booked 4 arrives as 6. They are "never booked on their own", aren't shown in the grid, aren't bookable online unless support enables it, and can be restricted by user permission — [ResDiary: phantom tables](https://help-resdiary.theaccessgroup.com/en/articles/12310736-create-your-phantom-tables) (Jul 2026).
  - **Table rankings** are set per service and party size, can disable a table on particular weekdays, and can be copied across services — [ResDiary: table rankings](https://help-resdiary.theaccessgroup.com/en/articles/12082639-create-your-table-rankings) (Jan 2026).
- **Zenchef:**
  - Table groups, an assignment-preference order (drag tables into order, leftmost = highest priority) and Auto-Assign — [Zenchef: Discover the seating plan](https://help.zenchef.com/hc/en-gb/articles/18072176415901-Discover-the-seating-plan-with-Zenchef).
  - Room selection depends on accurate min/max covers, table groups and assignment preferences — [Zenchef: Room selection](https://help.zenchef.com/hc/en-gb/articles/5277296302877-How-to-set-up-the-room-selection).
  - **Table Reassignment** setting (Oct 2026): "Auto re-assign" (default) or "Keep manual + warn", where staff see a "missing X seats" warning. "Tables you've locked are never affected" — [Zenchef: Table Reassignment](https://help.zenchef.com/hc/en-gb/articles/38989458015645-Table-Reassignment-Choose-how-tables-adapt-to-booking-changes).
- **Toast Tables:** "+ Create Combo Tables" from two or more tables, with a Service Period and an online-bookable flag. Toast recommends at least one combination "for parties larger than your largest table" (snippet) — [Toast: Get Started](https://support.toasttab.com/en/article/Getting-Started-Toast-Waitlist). In service, combos are marked with a blue clip icon and "can't be moved" — [Toast: Use Toast Tables](https://intercom.help/toast-central/en/articles/9326547-use-toast-tables).
- **TheFork Manager** (snippet): "Combinations are created by clicking on the tables you want to combine… click on Combine to confirm", and the "Seating Capacity is automatically calculated" — [TheFork Manager: create a floor plan](https://support.theforkmanager.com/s/article/How-do-I-create-a-floor-plan?language=en_US).
- **SevenRooms:** combinations with min/max are defined at onboarding — [SevenRooms Floorplan Template](https://go.sevenrooms.com/rs/519-YNM-008/images/%28MAKE%20A%20COPY%29%20SevenRooms%20Floorplan%20Template%20-%20Floorplan%20Build.pdf?version=0). Marketing claims an "AI-driven seating algorithm" that "considers 10,000+ combinations every second" (unverified) — [SevenRooms: Table Management](https://sevenrooms.com/platform/table-management/).
- **Libro:** table priorities settle ties when several combinations fit a party equally (snippet) — [Libro: Configure Table Priorities](https://libroreserve.zendesk.com/hc/en-us/articles/47402052589979-How-to-Configure-Table-Priorities).

#### Server sections and stations
- **Tock:**
  - The server panel adds servers with a name and color and assigns them tables.
  - Rotation is ordered by "Last seating" (default), "Total covers" or "Current covers". Panels show "Section full", servers can be excluded from rotation, and an optional "Pre" count shows pre-assigned covers — [Tock: Using the Server Panel](https://tock.zendesk.com/hc/en-us/articles/28563384467732-Using-the-Server-Panel).
  - With Toast, "Servers must be assigned to tables in Tock prior to seating in order to open under the correct server in Toast" — [Tock: Toast FOH Operations](https://tock.zendesk.com/hc/en-us/articles/360047598591-Integrating-with-Toast-FOH-Operations).
- **Resy:** server sections are opened from the server hand icon on the floor plan. Features include choosing a "Closer", real-time Active/Future/Done covers and tables, and "Next to Seat" — [Resy: Manage Server Sections](https://helpdesk.resy.com/how-to-manage-server-sections-in-resyos-ByWfwQ8_) (Oct 2023).
- **Eat App Round Robin** (Desktop and iPad; screenshots Aug 2026):
  - servers are split into "Servers on shift" and "Unavailable";
  - selecting a server dims tables already assigned to others;
  - rotation can prioritize by tables, reservations or covers;
  - "Unassign all" clears the day at shift change;
  - assignments are kept per date.
  - Source: [Eat App: Server Rotation](https://restaurant.eatapp.co/knowledge/server-rotation).
  - Server metrics: guests currently served, guests served today, and time of last seating — [Eat App: Managing your servers](https://restaurant.eatapp.co/knowledge/managing-your-servers-with-eat-app).
- **Toast Tables:** a server's color appears on the border of each table's progress bar. Hosts can select all tables in a service area for one server and use "Swap Server and Seat". Roster changes sync overnight — [Toast: Use Toast Tables](https://intercom.help/toast-central/en/articles/9326547-use-toast-tables).
- **Yelp** added "Assign Server to Multiple Sections" in Apr 2025 — [Yelp product news](https://business.yelp.com/restaurants/products/guest-manager-product-news/). **SevenRooms** (2018) tagged tables with server initials and colored them by section — [SevenRooms blog](https://sevenrooms.com/blog/restaurant-floor-plan/). **TableCheck** sections are physical areas or levels shown as tabs, and the reservation list filters by section — [TableCheck: Floor Legend](https://support-restaurants.tablecheck.com/hc/en-us/articles/900001286866-Floor-Legend). **Tock** sections are internal and invisible to guests — [Tock: Seating Options](https://tock.zendesk.com/hc/en-us/articles/19144577993876-Setting-Up-Seating-Options-in-Availability-Planning).

#### Blocked, held and inactive tables
- **Resy:** press and hold a table, then slide to "Block", for the entire shift or a time range, with an optional note. "Diagonal lines are visible on the table for the duration of the block" — [Resy: Block and Unblock a Table](https://helpdesk.resy.com/en_us/how-to-block-a-table-for-a-shift-in-resyos-HJQxMw78u) (2023).
- **Tock:**
  - Per-service table settings: Experience, Available online, In-house only, Block, Optimize, Priority and **Inactive**. An inactive table is hidden from the Timeline but can still be seated from Service.
  - Icons: house = in-house; blocker icon = blocked or partially blocked; blue background = optimized; arrows = priority; greyed out = inactive.
  - "Blocked tables are bookable by booking directly on the Timeline."
  - Source: [Tock: Editing Table Availability](https://tock.zendesk.com/hc/en-us/articles/360048245832-Editing-Table-Availability-for-Availability-Planning) (Jul 2026).
  - A passcode can be required before Hosts overbook or book a blocked time — [Tock: Overbooking a Table](https://tock.zendesk.com/hc/en-us/articles/18099821607700-Overbooking-a-Table).
- **Zenchef:**
  - A table can be blocked for one service (with a reason; it shows "greyed out on the floor plan, and a tooltip will display the reason") or long-term by unticking "Open to online reservations".
  - Staff can still add manual bookings on a blocked table. Blocking only changes availability if Table inventory is enabled, and tables must be blocked one by one.
  - Source: [Zenchef: How to block a table](https://help.zenchef.com/hc/en-gb/articles/27585297804317-How-to-block-a-table-for-a-specific-service-or-long-term).
- **Toast:** "Block Table" applies to a specific date — [Toast: Use Toast Tables](https://intercom.help/toast-central/en/articles/9326547-use-toast-tables). **Libro:** separate "Available Online" and "Available Internally" checkboxes; a table that is internally unavailable "will stay red at all times" — [Libro](https://libroreserve.zendesk.com/hc/en-us/articles/47236864860059-New-Dashboard-Modify-the-Floor-Plan). **TableCheck:** an "Online?" checkbox and per-table Roles restrictions — [TableCheck: Tables](https://support-restaurants.tablecheck.com/hc/en-us/articles/900000835123-Create-edit-delete-Tables).
- An operator feature request asks Toast for "Configure Tables to be for Walk In's Only (not reservable)", suggesting this is missing there — [Toast Tables Canny](https://toasttables.canny.io/feature-requests/p/configure-tables-to-be-for-walk-ins-only-not-reservable).

#### Accessibility flags
- None of the reviewed platforms' documentation shows a dedicated wheelchair or accessible-table attribute. The nearest equivalents:
  - OpenTable table types (Regular, High-Top, Counter, Bar, Outdoor) — [OpenTable Glossary](https://support.opentable.com/s/article/apglossary?language=en_US);
  - Resy Table Type (e.g. "High Top") — [Resy](https://helpdesk.resy.com/en_us/floor-plan-on-web-SyTdJuBp9);
  - TableCheck "Seat Type", "Smoking?" and "Purposes" (enabled by support) — [TableCheck](https://support-restaurants.tablecheck.com/hc/en-us/articles/900000835123-Create-edit-delete-Tables);
  - Tock's fixed-name Seating Options — [Tock](https://tock.zendesk.com/hc/en-us/articles/19144577993876-Setting-Up-Seating-Options-in-Availability-Planning).
- Adjacent restaurant software uses free-form table attributes, with accessibility as one example, to filter tables at booking: LS Central — [LS Central: Assigning Attributes to Dining Tables](https://help.lsretail.com/lscentral250/Content/LS-Retail/Bookings/Assigning-Attributes-To-Dining-Tables.htm) (snippet); Reservit — [Reservit: table characteristics](https://help.reservit.com/EN/how-to-apply-characteristics-to-tables-customize-table-layout-in-reservit-restaurant) (snippet).

### Inferences
- The common availability formula is per-table bookability × time slot × pacing × priority, with combinations as extra bookable inventory. Combinations inherit restrictions from their member tables: Tock blocks the combination if any member is blocked, and Eat App makes it unavailable if any member is booked.
- Hand-listed combinations dominate. Eat App still labels its manual mode "Recommended" over auto-grouping, which suggests operators want predictable combinations. Overcooked could store explicit joinable groups per layout, since adjacency on the grid is known, and let staff make ad-hoc joins in service (ResDiary temporary joins and phantom tables).
- Combined tables need their own min/max (all vendors). For Overcooked they also need a seat numbering and service order across the joined tables, which no competitor models.
- For fixed-seating tasting menus, the controls that matter are:
  - Tock-style experience-per-table (e.g. a chef's-counter menu versus the dining-room menu);
  - in-house-only large combinations;
  - timed release of held inventory.
- Ordinary per-slot pacing matters less there.
- Server sections are almost always a per-service or per-day overlay (Eat App assignments by date; Tock and Resy live panels). Overcooked could store default sections per layout and allow per-service overrides, with rotation metrics as an optional extra.
- Accessibility is an industry gap and a low-cost differentiator. Table attributes such as step-free access, wheelchair clearance or "not high-top" could be matched automatically against guest needs, alongside the dietary, language and occasion data Overcooked already holds.

### Gaps
- SevenRooms' seating areas, access rules and auto-assign logic couldn't be checked against documentation (gated).
- OpenTable's Smart Assign algorithm isn't publicly documented.
- No primary source confirms an accessibility flag in any reviewed product. The snippets for LS Central and Reservit are secondary-level.

## 4. What does the live floor view show during service, and how do staff seat, move, swap, join and split parties on the map?

### Takeaway
Live views pair the floor plan with a list or timeline. A table's color shows either the reservation or party status, or upcoming occupancy (TableCheck's white/yellow/red for later bookings; Tablein's "Next" tag and countdown; Toast's next three reservations). Elapsed-time bars and timers are common. Course stage comes from the POS as coarse statuses (Appetizer/Entrée/Dessert/Paid), with a lag. Guest tags appear only as small icons (VIP ★, flags, note icons). Seating is drag-and-drop or a status change, and multi-table joins are made by multi-selecting tables. Conflicts are flagged in red or orange, and Zenchef offers one-tap fixes.

### Cited Findings
- **Tock:**
  - The Service view is the floor plan plus a Guests list. The Timeline is a grid of tables against time: available slots are square tiles, blocks have diagonal stripes and unavailable time is blank. Each tile's color is the party status.
  - "Overbooked reservations are outlined in red" (the table name too). Unassigned reservations sit at the top with a red "!".
  - Pacing is shown as "5/10" (covers booked out of the maximum per 15 minutes), plus occupancy.
  - Source: [Tock: Understanding Timeline](https://tock.zendesk.com/hc/en-us/articles/21837347541652-Understanding-Timeline-with-Availability-Planning).
- **Tock party statuses** (update rolling out Oct 2026): statuses fall into Expected and Seated groups and are customizable by label, color, **icon** and **dashed border**. Staff change them from the guest list, the Timeline, or the floor plan's quick-action menu ("Right click on a table, or on Touch devices, long press"). Fixed system statuses: Expected, Partially arrived, Arrived, Partially seated, Seated, Finished, Cancelled, No-show — [Tock: Configuring Party Statuses Update](https://tock.zendesk.com/hc/en-us/articles/54149626634260-Configuring-Party-Statuses-Update).
- **Tock POS automation:**
  - Supported: Micros Simphony, Micros 3700, Square.
  - Mapped menu categories move the party to Appetizer, Entree or Dessert "within ~3 minutes" of an item being fired, and to "Paid" when the check closes. If several courses fire together, the latest course wins.
  - For changing menus Tock recommends a "$0 universal course item" such as "Fire Appetizer Course" — [Tock: POS Automated Party Status Updates](https://tock.zendesk.com/hc/en-us/articles/23958900436628-POS-Integrations-Automated-Party-Status-Updates) (Oct 2026).
- **Tock with Toast:**
  - Seating a party in Tock opens a Toast check with guest name, party size, table number, server name and the prepayment as tender.
  - Items pre-ordered in Tock "need to manually ring those items into the Toast check in order to fire the order to your bar/kitchen".
  - Moving the party to another table after seating does **not** update the Toast check.
  - Source: [Tock: Integrating with Toast: FOH Operations](https://tock.zendesk.com/hc/en-us/articles/360047598591-Integrating-with-Toast-FOH-Operations).
- **Tock seating actions:**
  - Seat by dragging the reservation to a table, or by right-click/long-press → "Seat"; move a seated party by dragging it to another table; "Batch pre-assign" reassigns several at once — [Tock: Re-Assigning and Seating Parties](https://tock.zendesk.com/hc/en-us/articles/360030920112-Re-Assigning-and-Seating-Parties).
  - When assigning to several tables, a status bar shows combined capacity: orange (below party size), green (equal), blue (above) — [Tock: Large Parties to Multiple Tables](https://tock.zendesk.com/hc/en-us/articles/15186343990420-Assigning-and-Seating-Large-Parties-to-Multiple-Tables).
  - Moving a booking out of its booked Seating Option triggers a warning that can be overridden — [Tock: Seating Options](https://tock.zendesk.com/hc/en-us/articles/19144577993876-Setting-Up-Seating-Options-in-Availability-Planning).
- **Resy:**
  - "Dragging and dropping reservations from the floor plan view will now assign and seat the reservation in one move"; this default can be switched off. Staff can also tap the table → status → "Seated" — [Resy: Drag and Drop to Seat](https://helpdesk.resy.com/en_us/how-to-drag-and-drop-to-seat-in-resyos-SkTCbwQ8O).
  - Settings include:
    - "Show duration of seated reservations" on the floor plan;
    - VIP tag next to names;
    - Visit Notes on the list;
    - "Alert when reservations overlap";
    - "Prompt table assignment after booking unassigned reservation".
    - Source: [Resy: ResyOS App Settings](https://helpdesk.resy.com/en_us/resyos-app-settings-r1dXii2Gs) (Sep 2026).
  - The turn-time icon plots reservation times onto each table; chits can print automatically on seating — [Resy OS FAQ](https://helpdesk.resy.com/resyos-faq-B1ciD7Uu).
- **OpenTable:**
  - POS integration moves a table through Appetizer, Entrée, Dessert and Paid; a Paid table "turns light green" (snippet) — [OpenTable: POS integration](https://support.opentable.com/s/article/GuestCenter-POS-Integration?language=en_US).
  - The iPhone app lets managers update table status — [OpenTable for Restaurants iPhone app](https://www.opentable.com/restaurant-solutions/resources/nowserving-iphone-app/).
  - OpenTable's own 2019 design research found that "Opening the guest card obscures the floor plan, feels heavy, and takes us out of the context of the shift". The redesign brought larger indicators, accessible status colors and a dark UI that "more discreetly blends into a restaurant setting" — [OpenTable Design: Designing for hospitality and performance](https://www.opentable.design/article/designing-for-hospitality-and-performance) (Jul 2019).
- **SevenRooms:**
  - Marketing: "Real-time table status and spend"; a customer testimonial mentions custom table statuses such as "Last Round" — [SevenRooms: Table Management](https://sevenrooms.com/platform/table-management/).
  - A 2018 blog describes a "$" spend view from the POS — [SevenRooms blog](https://sevenrooms.com/blog/restaurant-floor-plan/).
  - Mobile 4.0 (2018): tapping an empty table shows "the two most likely party size options" to seat a walk-in in two taps — [SevenRooms: Mobile 4.0](https://sevenrooms.com/blog/mobile-4-0/).
- **xnPOS integration with SevenRooms** (third-party guide, Sep 2025):
  - "The Course Status and Check Status update will be done during the life cycle of the check… This enables the Host/hostess to view the overvall status of the floor plan".
  - Status labels: Fire Starter, 1st Course, Fire Main, 2nd Course, Fire Dessert, Dessert, Print Bill, Check Dropped, Check Closed, Paid, Clean Table, Left.
  - With the interface on, "the POS is not longer the owner of the tables", and "Table Move… needs to be initiated from the TMS".
  - Source: [xnPOS: SevenRooms user guide](https://xnpos.helpjuice.com/en_US/user-guide/sevenrooms-user-guide).
- **Toast Tables** (doc dated 28 Sep 2026):
  - Views: Table View (default), where each table card shows "the next three reservations due on that table"; Flow View; and a Timeline with a "bench" for unassigned parties.
  - Statuses: Available, Seated, Ordered and Paid (set automatically from the POS), Dirty, Blocked. Manual status changes can be undone for 30 seconds.
  - Progress bars show elapsed turn time. Waitlist quote timers turn yellow within 5 minutes of the quoted wait and red once it is exceeded.
  - With a kitchen display, item icons on a seated table show coursing: yellow = sent, blue = fulfilled.
  - Overlapping reservations both turn red. A party can't be dropped on a Seated or Ordered table, or on a combo unless it was pre-assigned there.
  - Source: [Toast: Use Toast Tables](https://intercom.help/toast-central/en/articles/9326547-use-toast-tables).
- **TableCheck:**
  - The floor plan sits on the left and the reservation list on the right. Table colors: **White** (nothing assigned later), **Yellow** (one reservation later), **Red** (several later); otherwise the color is the reservation status.
  - Display toggles control what's drawn on tables:
    - table name and start times (up to 3 reservations);
    - flags of the next reservation;
    - memo (hover, or press-and-hold on iPad);
    - online-disabled icon;
    - next guest's last name;
    - seated time;
    - block start time;
    - restrictions;
    - next party size;
    - remaining time;
    - table lock;
    - "individual seat icons".
  - Search covers "preordered menu name, flag name and customer tags".
  - Source: [TableCheck: Floor Legend](https://support-restaurants.tablecheck.com/hc/en-us/articles/900001286866-Floor-Legend).
- **TableCheck statuses and drag-and-drop:**
  - Statuses include First Drink, Main and Dessert. Check Requested is set when the POS prints the check and Check Paid when it is paid. "Turnover" shortens the booking to leave 15 minutes, and "Ready" frees the table at once — [TableCheck: Reservation Statuses](https://support-restaurants.tablecheck.com/hc/en-us/articles/900001299983-Reservation-Statuses).
  - While dragging, colors show available / warning (can be overridden) / restricted — [TableCheck: Drag & Drop](https://support-restaurants.tablecheck.com/hc/en-us/articles/33178505727513-Assigning-Un-Assigning-Reservations-via-Drag-Drop).
- **Tablein:**
  - Card colors: Blue = Confirmed, Green = Seated, Purple = Walk-in, Red = Blocked or No-show, Yellow = Pending.
  - Cards show guest initials, party size, table, start–end time and icons for notes, VIP and important reservations.
  - A free table shows the time of its next reservation, a blue "Next" tag, and a "Red countdown timer" counting down to when it becomes occupied.
  - Selecting several tables lists their reservations.
  - Source: [Tablein: Understanding the Floor Plan](https://help.tablein.com/floor-plan).
- **Zenchef:**
  - Display options control which guest information shows, a "★ icon on the table if a guest is VIP", and a color per time slot (status colors can't be changed). There is also a night view. If too much is enabled the plan becomes "hard to read" — [Zenchef: Customise the display](https://help.zenchef.com/hc/en-gb/articles/360000256998-How-can-I-customise-the-display-of-my-seating-plan).
  - Drag-and-drop assignment, multi-table assignment and "Lock reservation" — [Zenchef: Assign tables](https://help.zenchef.com/hc/en-gb/articles/211826109-How-do-I-assign-tables-to-customers).
  - In the timeline, conflicts get an orange indicator and a menu with **Swap table / Auto assign / Squeeze / Undo**. Squeeze is hidden when a booking would end up shorter than 15 minutes — [Zenchef: Resolve table conflicts](https://help.zenchef.com/hc/en-gb/articles/37052183692957-How-to-resolve-table-conflicts-from-your-planning-timeline) (Jun 2026).
- **Eat App:**
  - The floor view handles waitlists, walk-ins, servers, "table timers and table capacity", room switching and zoom — [Eat App: Floor View](https://restaurant.eatapp.co/knowledge/floor-view).
  - Seating: drag the reservation to a table, then "Seat guest"; for walk-ins, pick a party size with the Walk-In selector and click an empty table — [Eat App: Seating guests](https://restaurant.eatapp.co/knowledge/seating-guests).
  - Custom statuses have a label, icon, category, hex color and "Recommended Next Statuses" — [Eat App: Creating custom statuses](https://restaurant.eatapp.co/knowledge/creating-custom-statuses).
  - The POS can auto-create tickets, set "finished" when the cheque closes and "cheque dropped" when it's paid — [Eat App: July 2025 release](https://restaurant.eatapp.co/knowledge/release-announcement).
- **ResDiary:** the table plan shows bookings at one moment (move the time cursor). The interval bar shows covers arriving per interval, with yellow marking the current time. Clicking a table creates a walk-in. Press "L" for the status and color legend — [ResDiary: Manage your table plan view](https://help-resdiary.theaccessgroup.com/en/articles/12428428-manage-your-table-plan-view).
- **TheFork Manager** (snippet): staff "can change the occupation and table icons on the digital plan in real time, by merging or separating them". Using the floor plan in service requires linking it to a service and is "only available on our Performance and Enterprise plans" — [TheFork Manager: How do I use my floor plan during a service?](https://support.theforkmanager.com/s/article/How-do-I-use-my-floor-plan-during-a-service?language=en_US).
- **Yelp Guest Manager:**
  - Product news: table statuses for appetizer, entrée, dessert and check dropped (Jun 2024); "Table Usage" insights (Apr 2024); editing table assignments from any device (Jan 2024) — [Yelp product news](https://business.yelp.com/restaurants/products/guest-manager-product-news/).
  - POS integrations update table statuses automatically (App Store listing, snippet) — [Yelp Guest Manager App Store](https://apps.apple.com/us/app/yelp-guest-manager/id404226510).
  - Drag and drop to seat, combine or change tables (2022, snippet) — [Restaurant Technology News](https://restauranttechnologynews.com/2022/04/how-yelp-guest-manager-combines-all-front-of-house-features-into-a-single-comprehensive-restaurant-platform/).
- **Allergies and tags:** SevenRooms "auto-tags" allergies into guest profiles that are visible from the host stand, but the page doesn't say they appear on the floor plan — [SevenRooms: Table Management](https://sevenrooms.com/platform/table-management/). On the floor itself, tags show only as icons: Tablein note/VIP icons, TableCheck flags, Zenchef VIP ★ (sources above).

### Inferences
- Course stage in every reservation platform comes from the POS, is coarse (3–4 stages), lags (Tock ~3 minutes) and needs workarounds ($0 "fire course" items). Seated-table moves often don't carry through to the POS (Tock/Toast). Overcooked creates the kitchen tickets and fires courses per seat itself, so its Service Board can show the exact course and pacing per table and per seat with no lag. This is a clear advantage over the whole category.
- Patterns worth copying:
  - future-occupancy cues on free tables (TableCheck white/yellow/red; Tablein "Next" tag and countdown; Toast next three reservations);
  - elapsed-time bars (Toast, Resy);
  - conflict highlighting with one-tap fixes (Zenchef Swap/Auto/Squeeze/Undo);
  - a short undo window (Toast, 30 s);
  - capacity-fit color feedback while assigning (Tock orange/green/blue; TableCheck available/warning/restricted);
  - per-user display toggles to control density (TableCheck, Zenchef).
- Guest detail (dietary needs, allergies, language, occasion) should open in a side panel without covering the floor, as OpenTable's research found. On the floor, use compact per-seat icons, since no competitor shows allergies on the map.
- Turnover states matter for second seatings: Toast "Dirty", xnPOS/SevenRooms "Clean Table", TableCheck "Turnover"/"Ready". A tasting-menu room with two seatings needs an explicit reset state.

### Gaps
- No source documents allergies drawn directly on map tables for any product. OpenTable's full status color legend wasn't found.
- SevenRooms' native (non-POS) live status set and timers are undocumented publicly.

## 5. Do any of them model seats/positions (seat numbers, pivot point), and does anything flow from seats into orders, menus or kitchen tickets?

### Takeaway
None of the reservation or table-management platforms reviewed models individually numbered seats that carry into orders, printed menus or kitchen tickets. They model tables with a capacity, sometimes drawn as chairs, dots or seat icons. Seat numbering by pivot point lives in POS systems. The nearest reservation-side features are cosmetic chair placement (Libro), seat icons (TableCheck), guest seat selection with premium pricing (Eat App), ticketed communal tables (Tock) and tying tables to menus (TableCheck Tiers, Tock experiences per table).

### Cited Findings
- **Libro:** max guests "determines the number of chairs at the table", and "Rotate chairs to set their position around the table" — [Libro: Modify the Floor Plan](https://libroreserve.zendesk.com/hc/en-us/articles/47236864860059-New-Dashboard-Modify-the-Floor-Plan).
- **TableCheck:** a display option "Shows the individual seat icons on a table based on table's maximum capacity" — [TableCheck: Floor Legend](https://support-restaurants.tablecheck.com/hc/en-us/articles/900001286866-Floor-Legend). Table **Tier** ties tables to specific menu offerings — [TableCheck: Tables](https://support-restaurants.tablecheck.com/hc/en-us/articles/900000835123-Create-edit-delete-Tables). The customer's Language field was moved to the profile's Info tab in Jul 2025 so it's visible at a glance — [TableCheck: Feature Updates](https://support-restaurants.tablecheck.com/hc/en-us/articles/48477328268569-Feature-Updates-Zoom-in-out-on-Floor-View-Relocation-of-Language-field-in-Customer-Profile).
- **Resy:** seating capacity appears as dots on tables (printing turns the dots into min/max numbers) — [Resy: ResyOS Floor Plan Editor](https://helpdesk.resy.com/en_us/floor-plan-editor-SJ5M493VY). **SevenRooms** (2018): the floor plan shows chair counts — [SevenRooms blog](https://sevenrooms.com/blog/restaurant-floor-plan/).
- **Eat App** (Jul 2026): "Guest Table Selection: Let guests choose their preferred table or seat and charge extra for premium locations" — [Eat App: July 2026 Product Releases](https://restaurant.eatapp.co/knowledge/july-2026-product-releases). Granularity and data model aren't documented.
- **Tock:**
  - Communal tables are sold as tickets (table size = total tickets), with straggler rules — [Tock: Communal Table](https://tock.zendesk.com/hc/en-us/articles/360039840152-Adding-a-Communal-Table).
  - A table can offer up to five experiences, but "Can guests book different experiences within a single party? No" — [Tock: Multi-Experience Tables](https://tock.zendesk.com/hc/en-us/articles/22751441190292-Setting-up-Multi-Experience-Tables).
  - Items pre-ordered in Tock have to be re-entered by hand in Toast to reach the kitchen — [Tock: Toast FOH](https://tock.zendesk.com/hc/en-us/articles/360047598591-Integrating-with-Toast-FOH-Operations).
- **Toast Tables plus a kitchen display:** coursing icons are per seated table (yellow = sent, blue = fulfilled), not per seat — [Toast: Use Toast Tables](https://intercom.help/toast-central/en/articles/9326547-use-toast-tables). **xnPOS/SevenRooms:** course and check statuses are per table or check — [xnPOS guide](https://xnpos.helpjuice.com/en_US/user-guide/sevenrooms-user-guide).
- **POS-side seat conventions** (secondary sources, snippets):
  - Pivot-point seating picks a reference point (front door, kitchen, host stand). The seat closest to it is Seat 1, and numbering runs clockwise — [St. Louis Magazine: How do restaurants number their tables](https://www.stlmag.com/dining/ask-george:-how-do-restaurants-number-their-tables-and-why).
  - NCR Aloha's course-entry screen "sorts the items by seat number, if pivot seating is in use" and labels items "Sn" — [NCR Aloha: Assigning course numbers to items](https://docs.ncrvoyix.com/restaurant/aloha-pos/implementing/course_ordering/assigning_course_numbers_to_items).
  - Lightspeed K-Series has you set a number of seats per table in Back Office in order to split checks by seat — [Lightspeed K-Series support](https://k-series-support.lightspeedhq.com/hc/articles/1260804656689).

### Inferences
- Overcooked's per-seat model has no equivalent among the reservation platforms reviewed. That model covers which side each seat sits on, seat service order, seat numbers that stay the same across layouts, and per-seat menu choice, dietary needs and language driving printed menus and kitchen tickets. This is a real differentiator, but there is also no established reservation-side UX to copy. The best references are Libro's chair-rotation editing (for seat sides) and the POS pivot-point convention (seat 1 nearest a reference point, clockwise) for default numbering and service order.
- Competitors keep guest-level menu data at the party level: Tock allows one experience per party, and others use pre-orders or notes. Overcooked's per-guest menu choice therefore needs its own seat-assignment step (guest → seat) somewhere in the flow. No competitor offers a precedent for where that step should happen.
- Combined tables and layout switches are where seat models break. Overcooked will need rules for seat numbering and service order across joined tables, and for keeping seat numbers stable when a table moves or rotates between layouts. Every competitor sidesteps this by not having seats.

### Gaps
- It wasn't verified whether the SevenRooms, OpenTable or Resy POS integrations pass seat numbers either way.
- Eat App's seat selection wasn't examined in detail (per-seat inventory or table-level only).
- No reservation product with chef's-counter per-seat maps was found and verified. Tock's counter or communal handling is ticket-count based.

## 6. What do operators praise and complain about, and which product is considered best-in-class for setup and for live service, especially for fine dining?

### Takeaway
Operator feedback that specifically concerns floor plans is thin and anecdotal. The recurring complaints are setup effort, uneven features between web and iPad, browser constraints, and clunky or unintuitive interfaces (SevenRooms, OpenTable/Safari). No independent ranking of floor-plan editors exists. Comparison pages, all of them vendor- or affiliate-linked, converge on Resy for fine dining and rate OpenTable's floor tools as "solid". Judged on documentation depth, Toast Tables, TableCheck and Tock have the richest live-service tooling, and Tock's Availability Planning is the most tasting-menu-specific. Tock, however, is being folded into Resy.

### Cited Findings
- **SevenRooms:**
  - On G2 the vendor replied that "the interface is sometimes a bit clunky, and some cool features are only implemented in one of the versions (ipad or desktop), but not both". One reviewer notes "you will need to purchase an iPad to set up the floor plan" — [G2: SevenRooms reviews](https://g2.com/products/sevenrooms/reviews_and_filters?page=4) (snippets, single reviews).
  - Capterra snippets say floor-plan setup requires "real time investment before going live", "making new shifts can be tricky" (shifts overlap or conflict), and a Tripleseat integration forced table locks. On the positive side, "super-easy to train floor staff" and "great metrics for assigning tables" — [Capterra: SevenRooms reviews](https://www.capterra.com/p/165480/SevenRooms/reviews/) (snippets).
  - Rated 4.4/5 from 24 reviews — [Capterra.ca](https://www.capterra.ca/reviews/165480/sevenrooms).
  - An affiliate-linked comparison says "The interface is powerful but not intuitive", the host app is "functional but not as polished as OpenTable's or Resy's", and it advises 2–4 weeks for setup and training — [Smart Restaurant Owner](https://smartrestaurantowner.com/blog/restaurant-reservation-systems) (Jun 2026).
- **OpenTable:**
  - "OpenTable's floor management is solid" — [Smart Restaurant Owner](https://smartrestaurantowner.com/blog/restaurant-reservation-systems).
  - An app-store review reports trouble "making floor plans via OpenTable and safari… won't allow me to copy or create a new floor plan". A hostess wants the floor plan in the phone app — [Justuseapp: OpenTable for Restaurants reviews](https://justuseapp.com/en/app/766049754/opentable-for-restaurants/reviews) (anecdotal).
  - OpenTable's own research quoted hosts saying "Our staff spends too much time at the host stand" — [OpenTable Design](https://www.opentable.design/article/designing-for-hospitality-and-performance) (2019).
- **Resy:**
  - G2: 4.1/5 from 7 reviews; the main complaint is bugs, especially with Resy Notify — [G2: ResyOS reviews](https://www.g2.com/products/resyos/reviews) (snippet). Capterra: 4.5 from 20 reviews — [Capterra: OpenTable vs ResyOS](https://www.capterra.com/compare/17313-197806/OpenTable-for-Restaurants-vs-ResyOS) (snippet).
  - Described as having a "cleaner" interface, and recommended: "If you're a chef-driven or fine dining restaurant that already has demand, use Resy" — [Smart Restaurant Owner](https://smartrestaurantowner.com/blog/restaurant-reservation-systems).
  - Ranked best for "Fine dining and upscale casual restaurants" by a site the article itself says "is operated by Resos" — [restaurantbookingsystem.com](https://restaurantbookingsystem.com/best/table-management-software/) (updated Sep 2026).
  - "Urban full-service and fine dining operators" — [Superior Seating](https://www.superiorseating.com/blog/the-8-best-restaurant-reservation-apps) (furniture seller, May 2026).
- **Tock:**
  - Capterra: 3.4 from 17 reviews, with customer service scored 2.3 — [Capterra: OpenTable vs Tock](https://www.capterra.com/compare/17313-157947/OpenTable-for-Restaurants-vs-Tock) (snippet).
  - G2: 4.2 from 96 reviews, with Table Management scored 8.8 — [G2: Tock reviews](https://www.g2.com/products/tock/reviews) (snippet).
  - An App Store review complains the mobile app "can't look at service/floor plan" and was "basically just the desktop website on the phone" — [App Store: Tock Dashboard](https://apps.apple.com/us/app/tock-dashboard/id1272762298) (snippet).
  - Merger coverage describes Tock as bringing "many fine dining restaurants" and over 1,200 wineries into Resy, and its tiered and prepaid experiences moving into Resy — [Restaurant Business](https://www.restaurantbusinessonline.com/technology/reservation-services-resy-tock-are-merging); [Frequent Miler](https://frequentmiler.com/after-purchasing-tock-amex-to-fold-it-into-resy-in-summer-2026/).
- **SevenRooms in fine dining:** recommended for "high-volume fine dining concepts where guest CRM and marketing automation are strategic priorities" — [Superior Seating](https://www.superiorseating.com/blog/the-8-best-restaurant-reservation-apps).
- **resOS** promotes itself as having a "Simple interface requiring minimal training" and credits OpenTable with "Sophisticated pacing and section tools" (biased publisher) — [restaurantbookingsystem.com](https://restaurantbookingsystem.com/best/table-management-software/).
- **Toast Tables:** operator feature requests include "Configure Tables to be for Walk In's Only (not reservable)" and "Seating more then one party at a table" — [Canny: walk-in only](https://toasttables.canny.io/feature-requests/p/configure-tables-to-be-for-walk-ins-only-not-reservable); [Canny: more than one party](https://toasttables.canny.io/feature-requests/p/seating-more-then-one-party-at-a-table).
- **Vendors' own warnings:**
  - Zenchef: too much information on the seating plan "makes it hard to read" — [Zenchef](https://help.zenchef.com/hc/en-gb/articles/360000256998-How-can-I-customise-the-display-of-my-seating-plan).
  - Resy: unsaved iPad edits are lost when the screen rotates or locks — [Resy](https://helpdesk.resy.com/how-to-create-and-edit-floor-plans-in-the-resyos-app-Hk16bwXUO).
  - Resy: renaming a table ID unassigns its reservations — [Resy](https://helpdesk.resy.com/en_us/floor-plan-editor-SJ5M493VY).

### Inferences
- Best-in-class for **setup** (my judgment from documentation, not a cited ranking):
  - Resy has the most capable self-serve editor on both iPad and web, with copy-a-plan for events.
  - Eat App has the fastest bootstrap through image import.
  - SevenRooms is white-glove, with the vendor building the plan from your drawing.
  - TableCheck offers the richest table attributes (tiers, roles, seat icons).
- Best-in-class for **live service** (also my judgment):
  - Toast Tables integrates POS and KDS status most tightly (Ordered/Paid/Dirty, coursing icons, timers, 30-second undo).
  - TableCheck has course-stage statuses plus very configurable table overlays.
  - Tock has configurable status icons, POS-automated course statuses and server rotation.
  - Zenchef's conflict-resolution menu is the most refined single interaction found.
- For **fine dining and tasting menus**, Tock's model is the closest in spirit to Overcooked: experiences per table, prepaid tickets, timed release of held tables, communal or counter tickets. With Tock now part of Resy, Resy's roadmap is the one to watch. No competitor does seat-level, course-paced service, so Overcooked's Service Board and Kitchen Display link has no direct rival here.
- The complaints point to design priorities for Overcooked:
  - identical features on every device, including full editing on tablet;
  - no dependency on a particular browser;
  - edits that survive interruption (autosave, offline);
  - stable identity under renames;
  - fast setup (templates or image tracing);
  - readable live density.

### Gaps
- Reddit (r/restaurateur, r/KitchenConfidential, r/restaurantowners) couldn't be searched; the search tool returned "domains are not accessible to our user agent".
- G2 and Capterra pages weren't fetched directly. Ratings and quotes come from search snippets, which may be truncated or lack context, and sample sizes are small (7–96 reviews).
- No independent, floor-plan-specific comparison across vendors was found. All comparison articles found carry vendor, affiliate or retailer bias: the resOS-operated site, Smart Restaurant Owner's affiliate links, and the furniture seller.
