# Floor-plan, event-diagramming and canvas editors: interaction, visual design and architecture lessons for Overcooked's restaurant floor-layout editor

Research date: 4 Nov 2026. Product behaviour comes mostly from vendor manuals and help centres. Architecture comes from engineering blogs and SDK docs. Some help centres could not be fetched directly: help.socialtables.com is blocked by this session's network, and the Prismm and RoomSketcher Zendesk pages returned HTTP 403. Findings from those pages, and from any page known only through search-result text, are marked "(search excerpt)": the wording is the search tool's summary, not a verified page read. Vendor marketing claims are marked "(vendor claim)". The Floorplanner Editor Manual cited throughout is the official PDF (59 pages, PDF creation date 10 Nov 2022), so the current UI may differ in detail.

## 1. How do these tools model and draw walls and rooms, and how do users draw or reshape them?

### Takeaway
Every serious interior planner models walls as vector segments with real thickness that join at shared corners. A closed loop of walls automatically becomes a room with a floor surface, dimensions and a label. Doors and windows are objects hosted by a wall, which cut it automatically. Users get two ways to create walls: a fast "drag a rectangular room" and a flexible "wall-by-wall" polyline. They then reshape by dragging corners or segments, splitting walls, curving them and typing exact lengths. None of the tools studied stores walls as grid edges.

### Cited Findings
**Floorplanner (manual, PDF created Nov 2022; help centre)**
- Two creation modes: "In floorplanner you can draw your floorplan by drawing room by room, or wall by wall. You can draw quicker room by room." — [Floorplanner Editor Manual](https://cdn.floorplanner.com/static/brochures/FloorplannerManualEN.pdf)
- **Draw Room** works like this:
  - Set wall thickness and height in the sidebar or by typing, then click-drag the room.
  - On release "You'll get automatic dimensions showing the interior room dimensions and exterior dimensions."
  - Clicking an inner dimension lets you type the exact room size, and arrow buttons choose which wall moves.
  - Source: [Floorplanner Editor Manual](https://cdn.floorplanner.com/static/brochures/FloorplannerManualEN.pdf)
- **Draw Wall** works like this:
  - "Release where you want your wall to end or type in your desired length and press Enter."
  - "the blue circle indicates your wall thickness."
  - "guidelines will help you find the end of a room or vertical or horizontal direction."
  - Closing on the starting point makes a room surface appear: "A space enclosed by walls becomes a room, and is given a floor and ceiling surface automatically."
  - The manual warns that "wall thickness affects the wall length when going around a corner."
  - Source: [Floorplanner Editor Manual](https://cdn.floorplanner.com/static/brochures/FloorplannerManualEN.pdf)
- Help centre: both modes "require a closed circuit of walls to achieve the automated creation of a floor and ceiling". Esc or the back button stops wall drawing — [How to draw a room?](https://help.floorplanner.com/en/articles/2405826); [How to draw a wall? (and how to stop drawing)](https://help.floorplanner.com/en/articles/8426766-how-to-draw-a-wall-and-how-to-stop-drawing) (search excerpts)
- Reshaping:
  - Split a wall segment twice and drag the middle piece out to make an alcove.
  - Drag a corner to angle a wall.
  - Curve a wall with the curve icon. Un-curving snaps it back to straight.
  - "Draw wall from point" starts a new wall from a point on an existing wall.
  - While dragging, a blue arrow shows the distance to the opposite wall, and "you can type in the size this distance should have, and confirm by ENTER."
  - Source: [Floorplanner Editor Manual](https://cdn.floorplanner.com/static/brochures/FloorplannerManualEN.pdf)
- Topology rules: removing a segment so a space is no longer enclosed makes "the floor … disappear", and if two rooms become connected "the two separate floors merge into one" — [Floorplanner Editor Manual](https://cdn.floorplanner.com/static/brochures/FloorplannerManualEN.pdf)
- Thickness mismatches: where a thick and a thin wall meet, the inner face "jumps". A "move wall across axis" stepper shifts the thick wall perpendicular to its axis to line the faces up — [Floorplanner Editor Manual](https://cdn.floorplanner.com/static/brochures/FloorplannerManualEN.pdf)
- Zero-thickness "invisible walls" split an open-plan space (example: a living room with an open kitchen) into two rooms that can each have a room type and area. They "show neither in 2D nor in 3D" but stay selectable in 2D, and the auto-furnish feature treats them as an open side — [Floorplanner Editor Manual](https://cdn.floorplanner.com/static/brochures/FloorplannerManualEN.pdf)
- Doors and windows are "placed on a wall" by drag and drop. Clicking one sets "wall side, hinge side", duplicate and remove. The sidebar sets width, height, raise from the floor and frame colours — [Floorplanner Editor Manual](https://cdn.floorplanner.com/static/brochures/FloorplannerManualEN.pdf)
- Multi-select walls and rooms with Shift + drag-rectangle to remove, duplicate, rotate or mirror. When dropping, "Use the snapping guidelines to connect the walls properly and avoid errors" — [Floorplanner Editor Manual](https://cdn.floorplanner.com/static/brochures/FloorplannerManualEN.pdf)

**Sweet Home 3D (open source; current online user guide)**
- Walls:
  - Click the start point, then click or double-click the end point.
  - You can enter a wall's length and angle after pressing Enter. This is not available in the Online and Mobile versions.
  - Thickness and height are set via double-click → Modify walls, with defaults in Preferences.
  - Source: [Sweet Home 3D User's Guide](https://www.sweethome3d.com/userGuide.jsp)
- Rooms are auto-detected: you "double-click anywhere inside an existing closed surface" surrounded by walls. Such a room "will include the half doorstep of each door placed on its walls". Floor and ceiling colour or texture is set per room — [Sweet Home 3D User's Guide](https://www.sweethome3d.com/userGuide.jsp)
- Openings: walls are cut automatically where doors and windows are placed, and "a door or a window dropped upon a wall is automatically oriented and resized depending on the orientation and the thickness of that wall" — [Sweet Home 3D User's Guide](https://www.sweethome3d.com/userGuide.jsp)

**SmartDraw**
- Drawing:
  - "Just click and drag."
  - "Walls will automatically connect and close your outline."
  - For exact dimensions, "Type them directly into the wall label."
  - "Drag the middle arrows to adjust walls inward or outward". Corner controls move corners diagonally.
  - Plans can also start from drag-and-drop "ready-made room and building outlines".
  - Source: [SmartDraw: Draw a Floor Plan](https://waz.smartdraw.com/floor-plan/draw-floor-plans.htm)
- "Doors and windows will automatically snap and rotate with walls." The cursor changes to an anchor when the item will attach. Once attached, you "resize the opening and move it around on the wall" — [SmartDraw: Draw a Floor Plan](https://waz.smartdraw.com/floor-plan/draw-floor-plans.htm)
- Wall measurement defaults to "From Interior". Switching to exterior changes the room figures — [SmartDraw support: Measuring Walls from the Interior or Exterior](https://smartdraw.zendesk.com/hc/en-us/articles/37823811597844-Measuring-Walls-from-the-Interior-or-Exterior) (search excerpt)

**RoomSketcher**
- There are separate Exterior and Interior Wall tools. You click to start and move the cursor in the wall's direction, setting exact lengths while drawing or afterwards with Select. Thickness is set in the Draw Exterior/Interior Walls tool before drawing — [RoomSketcher help: thick and thin walls](https://help.roomsketcher.com/hc/en-us/articles/360000827249) (search excerpt; direct fetch returned 403)
- There are two kinds of dimension. Wall measurements give the length of individual walls, inside or outside. Room dimensions give total length × width, usually shown in the room centre. The "Measurement Wizards" that add them automatically are Pro/Team features — [RoomSketcher help: Wizard tool](https://help.roomsketcher.com/hc/en-us/articles/115005898829) (search excerpt)

**Capture-first and event tools**
- magicplan Auto-Scan uses Apple's RoomPlan API. "Walls, windows, and doorways will be detected automatically", several rooms can be captured in one session, and stairs must be added afterwards — [magicplan help: Auto-scan your floor plan](https://help.magicplan.app/auto-scan-your-floor-plan) (search excerpt)
- Prismm (formerly AllSeated): most venue floor plans are pre-loaded. A new venue is set up by entering its address, space dimensions and perimeter walls — [Prismm: event floor plan software](https://prismm.com/events/event-floor-plan-software)
- Cvent Event Diagramming (formerly Social Tables) builds on "scaled architectural files such as CAD, DWG, or PDF plans" (FAQ) — [Cvent Event Diagramming](https://www.cvent.com/en/event-diagramming-and-seating)

### Inferences
- The shared model across Floorplanner, Sweet Home 3D, SmartDraw and RoomSketcher has three layers: a **wall graph** (corner nodes plus segments with thickness, and optionally curvature and height), **rooms derived from closed loops** (floor polygon, area, label, type), and **openings hosted by walls** (offset along the wall, width, hinge side, swing side). Overcooked's grid-edge walls cannot show thickness, angled or curved walls, real door widths or hinge sides. That is a likely technical root of "doesn't show the actual layout of a room".
- Floorplanner's zero-thickness "invisible wall" maps directly onto restaurant sections (bar vs dining room vs terrace vs private dining) that need their own label, area and colour without a physical wall.
- Migration path: keep the grid as a snapping lattice rather than the storage model. Convert each straight run of grid-edge walls into a segment, and convert grid-edge doors into wall-hosted openings with a default width.
- Offer both creation modes, Room (rectangle) and Wall (polyline). Add "split wall", "drag segment" and "drag corner" so admins can capture bump-outs, alcoves and angled storefronts.

### Gaps
- No vendor documents how wall joins are computed (miter vs butt, T-junctions of unequal thickness) beyond Floorplanner's "move wall across axis" workaround.
- Planner 5D's wall and room tools were not researched in depth. AutoCAD and SketchUp wall conventions were not covered beyond the Revit line-weight notes in §4.
- RoomSketcher's room auto-detection and area calculation could not be verified, because its help centre returned 403.

## 2. What snapping, alignment and measurement aids do they use, and how do they balance precision vs speed?

### Takeaway
Pro editors stack several aids:
- angle snapping in 15° steps
- snapping to other objects and walls, with visible guide lines
- live distance readouts to the nearest wall or object
- automatic dimension lines that can be clicked to edit
- equal-spacing handles

There is always a quick way out (hold a key to suspend snapping) and typed numeric entry during a drag for exact values. Snapping gives speed; typed values give precision. The event tools add rule-based checks for spacing and capacity.

### Cited Findings
- Floorplanner: "When drawing or dragging items you will often snap to other items in your canvas. Hold S to temporarily disable snap." The canvas also has a tape-measure tool (M) and a metre/foot units toggle — [Floorplanner Editor Manual](https://cdn.floorplanner.com/static/brochures/FloorplannerManualEN.pdf)
- Floorplanner dimensions:
  - Floorplanner "generates automatic dimensions around your walls" (inner and exterior).
  - "You can change the room size by clicking on a dimension line and typing the size you need".
  - Generated dimensions can be converted into editable custom ones.
  - A custom dimension tool (D) accepts a typed length while dragging, confirmed with Enter.
  - Source: [Floorplanner Editor Manual](https://cdn.floorplanner.com/static/brochures/FloorplannerManualEN.pdf)
- Floorplanner rotation shortcuts for a selected item: 5° steps (r / l) and 15° steps (R / L). Guidelines also help "find the centre of a wall" — [Floorplanner Editor Manual](https://cdn.floorplanner.com/static/brochures/FloorplannerManualEN.pdf)
- Floorplanner speed advice: "typing in values is usually quicker than using the sliders", and "hold 1 hand on your mouse, keep the other on your keyboard" — [Floorplanner Editor Manual](https://cdn.floorplanner.com/static/brochures/FloorplannerManualEN.pdf)
- Sweet Home 3D "magnetism":
  - "the angle of the walls on the floor is a multiple of 15° by default."
  - Hold Alt (Windows), cmd (macOS) or Shift+Alt (Linux) while drawing to toggle it. The same toggle controls 15° steps when rotating furniture.
  - With magnetism on, furniture is "automatically rotated so its back face lies along the wall".
  - Arrow keys move the selection.
  - Source: [Sweet Home 3D User's Guide](https://www.sweethome3d.com/userGuide.jsp)
- Sweet Home 3D dimension tool: click the start, click the end, then a third click sets the extension-line offset. You can also hover a wall side or furniture edge and double-click to accept an auto-measured temporary dimension — [Sweet Home 3D User's Guide](https://www.sweethome3d.com/userGuide.jsp)
- SmartDraw: "The blue guidelines will show the distance to the nearest wall or nearest object to help you position it", and furniture sizes can be typed exactly — [SmartDraw: Draw a Floor Plan](https://waz.smartdraw.com/floor-plan/draw-floor-plans.htm)
- SmartDraw dimension visibility can be set to Never, Only When Selected or Always. By default dimensions are always on, with extension lines — [SmartDraw help: Use Measurements](https://www.smartdraw.com/support/smarthelp/content/measure.html); [Adjust the Walls of Your Floor Plan](https://www.smartdraw.com/support/smarthelp/floor%20plans/adjustfloorplan.html) (search excerpts; which of the two pages holds the wording was not verified)
- Figma measuring:
  - Select a layer, hold Option/Alt and hover another layer to see "a red line between the two objects, as well as horizontal and vertical measurements".
  - Measurements go to bounding boxes, not to the outer edge of a stroke.
  - These temporary Alt measurements are not saved. Measurements made with the Measure tool (Shift+M) persist for collaborators.
  - Sources: [Figma Help: Measure distances between layers](https://help.figma.com/hc/en-us/articles/360039956974-Measure-distances-between-layers); [Figma Help: Add measurements and annotate designs](https://help.figma.com/hc/en-us/articles/20774752502935-Add-measurements-and-annotate-designs) (search excerpts)
- Figma Smart Selection: for evenly spaced layers, pink handles between them adjust the spacing of all layers at once. It applies to three or more equally spaced items, and "Tidy up" makes messy layouts eligible — [Figma Help: Arrange layers with Smart selection](https://help.figma.com/hc/en-us/articles/360040450233-Arrange-layers-with-Smart-selection); [Figma: Introducing Smart Selection](https://medium.com/figma-design/introducing-smart-selection-51f6ca7a817b) (search excerpts)
- tldraw:
  - The editor has a SnapManager for snapping during transforms.
  - In the custom-snapping example, "snap mode is off by default; the user can still snap by holding cmd/ctrl while dragging".
  - Shapes snap to nearby shapes' bounding boxes, and a custom shape can override `getBoundsSnapGeometry` to supply its own snap points.
  - Sources: [tldraw: Custom snapping example](https://tldraw.dev/examples/bounds-snapping-shape); [tldraw: Editor](https://tldraw.dev/sdk-features/editor) (search excerpts)
- Planning Pod: multi-selected items get Align Left/Right/Top/Bottom, Align Horizontal/Vertical Center, and Distribute Horizontally/Vertically — [Planning Pod: Using chairs and chair rows](https://planningpod.com/help-center/using-chairs-and-chair-rows)
- Social Tables "Diagram Check" lets users "set standards within their diagrams such as distance between chairs, distance between tables and maximum capacity", and flags problems in red — [Social Tables: Diagram Check](https://help.socialtables.com/new-user-interface/diagramcheck) (search excerpt)
- A G2 reviewer of SmartDraw said "sometimes the walls don't snap at the exact point that I would like", while allowing it might be user error. This is evidence that snapping must be predictable and easy to override — [G2: SmartDraw](https://g2.com/products/smartdraw/pricing) (search excerpt)

### Inferences
- A snapping stack for Overcooked:
  - **Grid:** e.g. 5 or 10 cm (3 or 6 in), used as the lattice rather than the model.
  - **15° angles** for walls and for table and furniture rotation, replacing 90°-only rotation.
  - **Object snapping** to wall faces, table edges and centres, and equal gaps (Figma Smart Selection pattern).
  - **Live distance labels** to the nearest wall or table while dragging (SmartDraw's blue guides). Aisle and chair-back clearance is what a restaurant admin actually cares about.
- A "Diagram Check" equivalent would turn spacing standards into visible warnings in a restaurant context: minimum aisle width, chair-back clearance, and blocked doors or exits.
- Tablets have no modifier keys. They need an on-screen snap toggle, and a numeric-entry popover when a dimension label is tapped. Sweet Home 3D drops Enter-to-type in its Online and Mobile versions, a sign that typed entry needs a different affordance on touch devices.
- Show dimensions "only when selected" by default (a SmartDraw option) so the plan stays clean, and hide them entirely in the service view.

### Gaps
- No vendor documents snap tolerances (pixel thresholds) or how they scale with zoom.
- No usability study comparing precision and speed across these tools was found.

## 3. How do furniture libraries and parametric objects work (tables that auto-arrange chairs, seat counts, rows or rounds of tables, grouping, duplication, arrays)?

### Takeaway
Event tools treat "table + chairs" as one parametric object. It carries shape and size, chair count per side, spacing, distance from the table, rotation, and removal of individual chairs. On top of that they add:
- bulk generators: templates that auto-fill banquet, classroom, theatre, staggered or chevron layouts and curved chair rows, driven by attendee or seat count, spacing and aisles
- validation of spacing and capacity
- automatic table numbering
- table joining

Interior planners lean on large symbol libraries with typed sizes, automatic alignment to walls, and auto-furnish features. Simple multi-select is used for grouping and duplication.

### Cited Findings
- Amadeus Hospitality diagramming has a per-table chair arrangement tool:
  - Path: Settings → Chair Arrangement → Customize.
  - All four sides are selected by default. Pick Top, Bottom, Left or Right to edit one side.
  - Each side has steppers for **Count, Position (slide side to side), Spacing, Distance from Table, Rotation**.
  - Chair size, type, 3D model, colour and fill pattern are also set here.
  - The dialog has its own Undo, Redo and Reset.
  - Use cases given: "place chairs on only three sides of a table, or to add a seat to a table that is already at capacity."
  - Source: [Amadeus Hospitality: Chair arrangement tool](https://help.amadeus-hospitality.com/sales-and-event-management/diagramming/Content/chair-arrangement.html)
- Social Tables templates and auto-fill: you pick a template style and set a seat count, and tables and chairs fill the diagram automatically. "The total table and chair count appears in the lower corner." The template is then adjusted via the editing panel and by resizing it — [Social Tables: Templates and Auto-Fill Diagram](https://help.socialtables.com/templates-and-auto-fill-diagram) (search excerpt)
- The Social Tables Layout Automation API exposes the parametric model behind those templates:

  | Parameter | Values or meaning |
  |---|---|
  | `setup` | aligned, staggered, classroom, conference-table, keynote, u-shape, hollow-square, reception, theatre, registration |
  | Table `type` | circle, square, rectangle, theatre, crescent, oval, serpentine, high-boy, chair |
  | `chairs` | number of chairs per table |
  | `size` | radius **or** width + length, not both |
  | `spacing` | x / y, in inches |
  | `position` | n, s, e, w, ne, nw, se, sw |
  | Other table fields | `removedChairs`, `cullAdditionalTables`, `rotateCrescent` |
  | Wizard fields | `attendees`, `chevronAngle`, `rotation` |
  | `aisles` | horizontal / vertical, each with `floorElementsBetween` and `width` |

  Constraints: aisles apply only to aligned, classroom and theatre; theatre rotation works only in 90° steps. Source: [Social Tables Developer: Layout Automation](https://developer.socialtables.com/docs/api-usage/layout-automation)
- Cvent Event Diagramming (vendor page, current):
  - A "Diagram Assistant" creates to-scale layouts and "automates diagrams, table numbering, and seating".
  - "Interactive floor plans with 700+ objects".
  - A setup template menu (staggered, classroom, …).
  - Customisable table linen colours, and duplicating or cloning past diagrams.
  - Bulk seat assignment with sections, filters, and VIP and meal tracking.
  - Source: [Cvent Event Diagramming](https://www.cvent.com/en/event-diagramming-and-seating) (vendor claim)
- Planning Pod chair rows:
  - Drag "Chair Row - Straight" or "Chair Row - Curved" from the library.
  - A setup form sets number of chairs, chair type, spacing, clear area (which also sets the gap between multiple rows) and number of rows.
  - "Chair Row Curve Editing" sets a curve percentage.
  - Clicking a row opens Edit, Rotate (to 360°), Chairs (add or remove, change type), Duplicate, Color, Delete, Bring to Front, Send to Back, and Favorite (save to library).
  - Source: [Planning Pod: Using chairs and chair rows](https://planningpod.com/help-center/using-chairs-and-chair-rows)
- Tripleseat Floorplans (originally Merri, now part of Tripleseat):
  - A 50,000+ item catalogue.
  - Support articles "How Do I Combine Tables Into One Long Table", "How Do I Resize One Table" and "How Do I Change Table Numbers".
  - Colour coding for seating categories or meal choices, and markers for power outlets and emergency exits.
  - Staff open the approved floor plan from the event record.
  - Sources: [Tripleseat: Floor Plans](https://tripleseat.com/features/floor-plans/); [Tripleseat support: Floor Plans](https://support.tripleseat.com/hc/en-us/categories/24112408730391-Floor-Plans); [Floorplans by Tripleseat](https://floorplans.tripleseat.com/); launch coverage Jan 2026: [Meetings Today: Tripleseat Floorplans debuts](https://meetingsmags.com/national/ntl_blogs/tripleseat-floorplans-debuts/) (search excerpts; vendor claims)
- Prismm: add tables and chairs, adjust spacing, join tables and remove chairs. A 3D tabletop designer applies changes to one table or all tables at once, and the 3D object library has 10,000+ items — [Prismm: design table settings fast](https://prismm.com/solutions/event-design-software/design-table-settings-fast) (search excerpt; vendor claims). Help articles titled "Floorplan Layouts: Add Tables with Chairs", "Edit Tables with Chairs" and "Add Ceremony Chairs" exist but returned 403 — [Prismm support: Add Tables with Chairs](https://support.prismm.com/hc/en-us/articles/10241921731740-Floorplan-Layouts-Add-Tables-with-Chairs)
- An AllSeated user review says the tool "can take patience to work with objects other than chairs and tables". Event tools are tuned for table-and-chair objects and are weaker for architecture — [GetApp: AllSeated reviews](https://www.getapp.de/reviews/112971/allseated) (search excerpt)
- Social Tables sizing guidance:
  - Banquet tables "usually accommodate between 8-10 people".
  - Rectangular banquet tables: 60" seats 6, 72" seats 6–8, 96" seats 8–10.
  - "each 72 banquet round in a row needs 11 feet" centre to centre.
  - Source: [Social Tables blog: banquet table layout ideas](https://www.socialtables.com/blog/meeting-event-design/banquet-table-layout-ideas/) (search excerpt)
- Floorplanner:
  - "Magic Layout" suggests a furnished layout for a room from its room type and a chosen style. "Restyle" keeps the layout but swaps furniture and materials.
  - Group selection works by clicking several items one after another (a temporary group) or by Shift + drag. Groups can be deleted, duplicated, moved, rotated or given a relative raise.
  - Copy/paste of walls and of furniture is drag-into-position.
  - Source: [Floorplanner Editor Manual](https://cdn.floorplanner.com/static/brochures/FloorplannerManualEN.pdf)
- SmartDraw: "thousands of ready-made symbols for furniture"; sizes can be typed exactly. Elements can carry model numbers, costs and descriptions, and you can "export the number of chairs of a certain model" — [SmartDraw: Draw a Floor Plan](https://waz.smartdraw.com/floor-plan/draw-floor-plans.htm)
- Sweet Home 3D furniture: dragged from a catalogue and auto-aligned so its back lies along a wall. A corner size indicator drags width and depth, other corner indicators handle rotation, elevation and height, and a double-click dialog takes exact values — [Sweet Home 3D User's Guide](https://www.sweethome3d.com/userGuide.jsp)

### Inferences
- Overcooked's current "seat sides" covers part of the Amadeus model. Moving to per-side **count + spacing + offset + chair style**, with chairs drawn as real top-down chair symbols, would make tables read as furniture rather than tokens. Seat positions should keep stable IDs (seat 1…n) so service features (orders by seat, allergies) stay attached when a table is edited.
- Restaurant equivalents of the event bulk tools:
  - "combine tables" or joinable table groups for large parties (Tripleseat, Prismm)
  - duplicate-with-offset arrays, e.g. a row of 2-tops along a banquette
  - automatic table numbering (Cvent)
  - a live total of tables and seats per room or section (Social Tables' count display)
- Wall alignment for furniture (Sweet Home 3D) suits banquettes, booths, bar counters and wall-mounted stations.
- The GetApp complaint about AllSeated is a caution: a restaurant editor must be good at architecture (walls, bar, kitchen pass) as well as tables. Event tools optimise for tables and pre-loaded venue shells.

### Gaps
- The exact chair-per-side UI in Prismm and Social Tables could not be verified, because their help centres were inaccessible.
- No source explains how automatic table numbering orders tables (row-major, by section, and so on).
- No library sizes were found for restaurant-specific symbols (bar stools, booths, POS stations, kitchen pass).

## 4. What visual styles do they use for 2D plans, and what makes a plan read as a real room?

### Takeaway
The main interior planners ship several 2D render styles:
- monochrome/architectural: white surfaces, black outlines, optional grid
- colour-coded by room type
- blueprint
- full material rendering, with floor textures, real furniture materials and soft drop shadows

Drafting convention supplies the cues that make a plan read as a building rather than a diagram:
- solid-filled ("poché") cut walls, with doors and windows as gaps in the fill
- a clear line-weight hierarchy: cut elements heaviest, door swings and annotation lightest
- a door leaf drawn with its swing arc
- glazing lines drawn inside the wall for windows

### Cited Findings
- Floorplanner 2D view settings:
  - "Black and white — All surfaces appear in white. All furniture as black and white outlines. Shows the grid by default, but you can turn that off."
  - "Colored outline — All surfaces appear in plain color. All furniture as black and white outlines."
  - "Material and shadows — All surfaces appear in selected materials. All furniture in their real materials. Walls and furniture have a light drop-shadow. Lights cast light."
  - "Blueprint mode" draws "white outlines on top of a blue background", with the colour changeable in a Pro template.
  - "Toggle any elements on or off."
  - Source: [Floorplanner Editor Manual](https://cdn.floorplanner.com/static/brochures/FloorplannerManualEN.pdf)
- Floorplanner examples page:
  - Three styles: monochrome, colour-coded and full colour.
  - "Black & White floorplans are still in high demand."
  - Templates let "you set your own color for walls in 2D", and custom "roomtypesets" give companies a consistent colour scheme.
  - In full colour, products and floors get textures and shadows, and lighting has a subtle effect on the floor.
  - Source: [Floorplanner: 2D floorplan examples](https://floorplanner.com/2d-floorplan-examples)
- RoomSketcher (blog published 6 Jan 2022, updated 18 Aug 2026):
  - Per-room floor colours, and floor materials (hardwood, carpet, tile, deck) in light or dark schemes.
  - Furniture can be shown in full, as fixed installations and appliances only, or not at all. "You can set a fill color or outline color for the furniture", and kitchen items can take a different colour.
  - A black-and-white version can be "just containing room names and sizes".
  - Measurement options cover room areas, wall lengths and total area, in metric or imperial.
  - Extras: compass, entrance arrow, logo, disclaimer text, custom colours, and transparency for rooms, furniture or background.
  - Source: [RoomSketcher: Customize your 2D floor plans](https://www.roomsketcher.com/blog/customize-your-2d-floor-plans/)
- RoomSketcher settings:
  - Colours are set in "2D Floor Plan Profile Settings" (Pro/Team).
  - The furniture outline colour also drives the black electrical symbols.
  - Floor colours and materials need each room to have a room type.
  - Templates set colours and materials together as a starting point.
  - Sources: [RoomSketcher help: choose colors](https://help.roomsketcher.com/hc/en-us/articles/360014145197); [assign room types](https://help.roomsketcher.com/hc/en-us/articles/360014255818-2D-Floor-Plans-Assign-Room-Types-to-Rooms); [templates](https://help.roomsketcher.com/hc/en-us/articles/35046800066077) (search excerpts)
- Drafting conventions (Studio Matrx design-drawing lesson, Oct 2026):
  - A plan is a horizontal cut where "An imaginary plane cuts at roughly window height; we look straight down on what remains."
  - Cut walls are filled solid (poché), and filled walls reveal rooms as shapes. A "solid opening = gap in poché".
  - "Cut elements heaviest; swings and annotation lightest." Seen elements below the cut are medium weight; elements above the cut are dashed.
  - A door is a leaf plus a swing arc. A window is glazing lines within the cut wall.
  - Drafting order: setup lines → walls → openings → fixtures → poché → annotation. "Work light-to-heavy … Poché and labels come last."
  - The lesson works at 1:100 and 1:50.
  - Source: [Studio Matrx: Orthographic views and floor plans](https://www.studiomatrx.org/students/design-drawing/orthographic-views-and-floor-plans)
- Revit gives every category separate cut and projection line weights: "A cut line weight is applied to an object if it intersects the cut plane for the view. If an object is not cut, the projected line weight will be used." Line weights are pen numbers whose thickness is mapped per view scale — [Autodesk Revit Help: Control Line Weights](https://help.autodesk.com/cloudhelp/2024/ENU/Revit-Customize/files/GUID-050DA470-B116-4A60-92E3-8099C30B0BA2.htm) (search excerpt)
- Door-swing practice varies; some practitioners draw swings as hidden (dashed) lines — [AUGI forum: door swings on floor plans](https://forums.augi.com/archive/index.php/t-63372.html?pda=1) (forum opinion)
- Event tools pair a 2D editing view with 3D previews:
  - Cvent advertises photo-realistic 3D renderings shared by link, and AI-assisted 3D diagram edits through CventIQ — [Cvent Event Diagramming](https://www.cvent.com/en/event-diagramming-and-seating) (vendor claim)
  - Prismm says "Flip between 2D and 3D views at will" — [Prismm](https://prismm.com/events/event-floor-plan-software) (vendor claim)
  - An older review says the Social Tables 3D model "will automatically update every time you make a change to the corresponding 2D diagram" — [Skift Meetings: Cvent Social Tables review](https://meetings.skift.com/cvent-social-tables-review) (search excerpt; older review)

### Inferences
- The owner's "abstract diagram / cheap" critique lines up with missing drafting cues:
  - uniform thin strokes
  - walls drawn as grid lines rather than thick poché
  - labelled rectangles where symbols belong
  - no door swing arcs or window glazing
  - no floor materials and no depth cues

  Applying the conventions above should make the plan read as an interior-designer plan:
  - true-thickness poché walls with gaps at openings
  - door leaves with arcs, and windows as glazing lines in the wall
  - three or four line weights
  - recognisable top-down furniture symbols: chairs with backs, bar stools, banquette cushions, a bar counter with a back bar
  - optional floor materials per zone (oak, terrazzo, tile)
  - faint drop shadows under furniture
- Copy the multi-style approach. A monochrome architectural "Plan" style and a "Presentation" style with materials and shadows cover the admin's two needs. A third "Service" style for tablets would mute the architecture to low contrast so table status colours dominate while the room stays legible.
- Floorplanner's roomtypesets and RoomSketcher's room types translate to restaurant zone types (dining, bar, lounge, terrace, private dining, kitchen, back-of-house), each with a colour or material.

### Gaps
- No authoritative drafting standard (US National CAD Standard, AIA CAD Layer Guidelines) was fetched, so no pen widths in mm are sourced. The line-weight hierarchy rests on a course lesson and Revit's cut/projection model.
- No user research was found on what makes a plan read as "real" rather than "diagram". That point is inferred from conventions.

## 5. What interaction patterns make editors feel professional?

### Takeaway
The professional feel comes from a small set of patterns:
- modal tools with single-key shortcuts
- click-to-select with on-canvas handles and contextual buttons
- an inspector sidebar for exact values
- marquee multi-select
- undo and redo everywhere
- locking by category
- spacebar or empty-canvas panning, a minimap, and wheel or pinch zoom
- deliberate pen and touch handling

Architecturally, tldraw builds tools as a hierarchical state machine.

### Cited Findings
- Floorplanner keyboard map:

  | Key | Action |
  |---|---|
  | W | draw wall |
  | R | draw room |
  | F | draw surface |
  | T | text |
  | D | dimension |
  | L | line |
  | M | tape measure |
  | B | hide/show background while tracing |
  | ` | minimap |
  | < > | switch floors |
  | Esc | exit mode |
  | Del | delete |
  | hold S | disable snap |
  | Shift + drag | rectangle select |
  | Spacebar | pan |
  | Cmd+Z / Cmd+Y | undo / redo |
  | ? | show all shortcuts in the sidebar |

  The manual notes: "if there is furniture in the rectangle, only furniture will be selected". Source: [Floorplanner Editor Manual](https://cdn.floorplanner.com/static/brochures/FloorplannerManualEN.pdf)
- Floorplanner canvas behaviour:
  - Dragging on an empty spot pans. Clicking an object selects it, which "will activate the sidebar, and give some handlers and buttons and info in the canvas".
  - Click on empty canvas or press Esc to deselect.
  - Items can be locked by category: "Lock structurals, information or furniture".
  - Source: [Floorplanner Editor Manual](https://cdn.floorplanner.com/static/brochures/FloorplannerManualEN.pdf)
- tldraw's editor runs a hierarchical state machine ("state chart"). Tools are state nodes. The select tool has child states such as idle, pointing, brushing and translating, and each state handles pointer and keyboard events — [tldraw: Editor](https://tldraw.dev/sdk-features/editor) (search excerpt)
- Planning Pod: clicking a row opens a contextual menu (Edit, Rotate, Chairs, Duplicate, Color, Delete, Bring to Front, Send to Back, Favorite). Multi-select is by Shift-click or drag-box, and adds align/distribute — [Planning Pod: Using chairs and chair rows](https://planningpod.com/help-center/using-chairs-and-chair-rows)
- Sweet Home 3D: "All modifications done in the home plan are undoable/redoable". Shift-click or rectangle multi-select, arrow-key moves, Esc to end drawing, and double-click for an exact-value dialog — [Sweet Home 3D User's Guide](https://www.sweethome3d.com/userGuide.jsp)
- Figma's undo rule for multiplayer: "if a user undoes many steps, copies something, and redoes back to the present, the document should not change". An undo rewrites the redo history and a redo rewrites the undo history, so redo does not overwrite other users' later edits — [Figma: How Figma's multiplayer technology works](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/)
- Excalidraw pen mode:
  - It is enabled when a pen is first detected, and most touch events are then prevented.
  - Two-finger pan still works. Touch-zoom was disabled in pen mode because palm contact triggered accidental zooms.
  - Users objected in GitHub PR #4725, some saying pinch zoom while drawing is very valuable.
  - Sources: [Excalidraw blog: Three for three](https://plus.excalidraw.com/blog/year-three); [excalidraw PR #4725](https://github.com/excalidraw/excalidraw/pull/4725) (search excerpts)
- SmartDraw: "Layers let you separate your floor plan into distinct views and focus on the system you're working on" — [SmartDraw: Draw a Floor Plan](https://waz.smartdraw.com/floor-plan/draw-floor-plans.htm)
- The Amadeus chair dialog has its own Undo, Redo and Reset, a scoped history for a sub-editor — [Amadeus Hospitality: Chair arrangement tool](https://help.amadeus-hospitality.com/sales-and-event-management/diagramming/Content/chair-arrangement.html)
- Permissions as interaction:
  - tldraw sync supports per-session `objectAccess` 'read' or 'write', so a user can comment without editing — [tldraw sync](https://tldraw.dev/docs/sync)
  - Cvent advertises role-based view/edit permissions and real-time comments — [Cvent Event Diagramming](https://www.cvent.com/en/event-diagramming-and-seating) (vendor claim)

### Inferences
- For Overcooked on desktop:
  - Explicit tools (Select, Wall, Room, Door/Window, Table, Fixture, Text, Measure), with single-letter shortcuts and a visible list behind "?".
  - A floating contextual toolbar on the selected object (rotate ±15°, duplicate, add or remove seat, combine, lock).
  - A right-hand inspector for exact numbers.
  - Universal undo/redo, with Esc always returning to Select.
- Category locks (Floorplanner) fit the restaurant workflow: lock architecture while arranging tables, and lock everything on the published layout used in service.
- For tablets:
  - Two-finger pan and pinch.
  - Single-finger drag on empty canvas should pan, as in Floorplanner, with marquee as an explicit mode.
  - Long-press for the context menu, and larger handles.
  - Apple Pencil support with palm rejection, given Excalidraw's experience that palm contact causes accidental zooms.
- Use the same renderer for the read-only service view with editing gestures switched off. Taps there open table details instead of selecting geometry.

### Gaps
- Figma's iPad or touch editing support was not verified, and Miro's touch patterns were not researched.
- No quantitative data was found on touch-target sizes or gesture conventions in these tools.

## 6. What rendering and state architectures are used, and how do multi-user tools sync?

### Takeaway
No single rendering stack wins:
- Figma runs a custom C++/WebAssembly GPU renderer. It used WebGL from 2015 and completed a move to WebGPU in 2025.
- Excalidraw, Konva, MURAL and Miro draw to Canvas 2D.
- tldraw and draw.io render shapes as DOM/SVG. tldraw moved selection indicators to canvas for speed.

What they share is a document model kept separate from rendering: a map or tree of objects with properties. For sync, the production leaders Figma and tldraw use a server-authoritative design with per-property last-writer-wins and optimistic local edits, not full CRDTs. Excalidraw uses element version numbers over an end-to-end-encrypted relay. Yjs is the off-the-shelf CRDT option.

### Cited Findings
**Figma**
- Renderer (blog post 18 Sep 2025):
  - C++ compiled to WebAssembly with Emscripten, plus a native x64/arm64 build for server-side rendering and testing.
  - WebGL since the 2015 launch: "Betting on WebGL—a browser graphics API originally designed for 3D applications—was a bold move."
  - WebGPU through Dawn, with GLSL shaders translated to WGSL using naga.
  - A dynamic mid-session fallback from WebGPU to WebGL, and device blocklisting based on fallback rates.
  - Results: "a performance improvement when using WebGPU on some classes of devices", neutral on others. The rollout is complete.
  - Source: [Figma: Figma rendering: Powered by WebGPU](https://www.figma.com/blog/figma-rendering-powered-by-webgpu/)
- Multiplayer (Evan Wallace, Oct 2019):
  - **Transport:** clients talk over WebSockets to a per-document server process. They download the full file, then sync changes.
  - **Model:** a document is a tree of objects "similar to the HTML DOM", conceptually `Map<ObjectID, Map<Property, Value>>`.
  - **Conflicts:** the server keeps the latest value per property, so conflicts arise only when two people edit the same property of the same object, and the last value the server receives wins.
  - **Why not OT or CRDTs:** OT is "overkill" for a design tool, and true CRDTs are unnecessary because a central server is the authority.
  - **Local edits:** they apply immediately. The client discards incoming server changes that conflict with its unacknowledged edits, to avoid flicker.
  - **Create and delete:** these are explicit actions. A deleted object's properties live in the deleting client's undo buffer.
  - **IDs:** clients generate unique IDs that embed a client ID, so objects can be created offline.
  - **Tree structure:** the parent link is a property, and the server rejects cycles.
  - **Ordering:** children are ordered by a fractional index in (0, 1), and inserting between two siblings takes the midpoint. Parent and position are stored as one atomic property.
  - **Reconnect:** fetch a fresh copy and reapply offline edits.
  - Source: [Figma: How Figma's multiplayer technology works](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/)

**tldraw (SDK 4.x)**
- Rendering and performance (performance page last edited 31 Jan 2026):
  - Shapes are DOM/SVG elements. Culled shapes stay in the DOM with display: none, found through a spatial index (an R-tree, per the culling docs).
  - "a canvas with 10,000 shapes might only render 50 if the rest are out of view." Selected shapes and the shape being edited are never culled.
  - `getEfficientZoomLevel()` stays stable during camera movement above 500 shapes. The default `maxShapesPerPage` is 4000.
  - Geometry is cached and invalidated only when props change. Images load lower resolutions by power-of-two screen scale.
  - Level-of-detail simplifications: sticky-note shadows are dropped, dashed strokes render solid, and text outlines are off below 0.35 zoom.
  - `editor.performance` emits fps and p95 frame time.
  - Sources: [tldraw: Performance](https://tldraw.dev/sdk-features/performance); [tldraw: Culling](https://tldraw.dev/sdk-features/culling) (culling page via search excerpt)
- tldraw 4.4 moved selection outlines and hover indicators to 2D canvas, "up to 25x faster rendering in some scenarios" — [tldraw SDK 4.4](https://tldraw.dev/blog/tldraw-sdk-4.4) (search excerpt)
- State updates: reactive signals update only the UI that depends on changed data. The store batches changes, so multi-shape updates produce one notification and `editor.run()` groups calls so "listeners notified once" — [tldraw: Performance](https://tldraw.dev/sdk-features/performance)
- Sync:
  - `TLSocketRoom` "stores the authoritative copy of the document, relays changes between sync clients over WebSockets". Only one room instance may exist globally.
  - The production template runs one Cloudflare Durable Object per room, with R2 for assets and SQLite storage recommended.
  - The client uses the `useSync` hook.
  - The server needs the schema, with props validation and migrations: "If you omit migrations, clients on different versions won't be able to collaborate without errors". Client and server versions must match.
  - Source: [tldraw sync](https://tldraw.dev/docs/sync)
- A third-party analysis describes tldraw sync as server-authoritative optimistic rebase rather than a CRDT — [Grida research note on tldraw sync](https://grida.co/docs/wg/research/crdt/tldraw) (third-party)
- In the reference implementation, the Durable Object applies edits in memory, rebroadcasts them, writes to R2 on a schedule and shuts down when the last client leaves. A figure of about 50 simultaneous collaborators per room comes from a mirror and is unverified — [tldraw-sync-cloudflare](https://github.com/tldraw/tldraw-sync-cloudflare) (search excerpt)

**Excalidraw**
- Collaboration design (29 Mar 2020):
  - "a central server relays end-to-end encrypted messages to all the peers in the room, but does no centralized coordination". The server stores nothing, and Socket.IO was chosen over Firebase.
  - Per-user state (selection, cached canvases) was pulled out of the shared element array.
  - Merging takes the union of element IDs. Each element has a `version` incremented on every change, and the higher version wins. Ties are broken by a random `versionNonce`, lower wins.
  - Deletions are `isDeleted` tombstones, stripped on save.
  - The undo/redo stack is cleared when an update arrives from a new peer, which the authors called "subpar".
  - Source: [Excalidraw: Building Excalidraw's P2P Collaboration Feature](https://plus.excalidraw.com/blog/building-excalidraw-p2p-collaboration-feature)
- Current code, per a third-party source tour: an element being edited locally wins, otherwise the higher version, then the lowest versionNonce. The reconciled set is re-sorted by fractional index so z-order survives concurrent edits — [PyShine: Excalidraw source tour](https://pyshine.com/Excalidraw-Virtual-Whiteboard-Source-Tour/) (search excerpt; unverified third-party)

**Konva (Canvas 2D scene-graph library) and Yjs**
- Konva:
  - Each layer has a visible scene canvas and a hidden "hit graph" canvas "used for high performance event detection". Because each layer costs two canvases, use few layers.
  - `listening(false)` skips hit detection for static shapes or layers.
  - Hit detection doesn't run while a node is dragged.
  - Fewer combined custom shapes are cheaper than many nodes.
  - Sources: [Konva: How it works](https://konvajs.org/docs/how_it_works.html); [Konva: performance tips](https://konvajs.org/docs/performance/All_Performance_Tips.html); [Konva.Layer API](https://konvajs.org/api/Konva.Layer.html) (search excerpts)
- Konva + Yjs multiplayer whiteboard demo:
  - Shared state lives in a Yjs document and the canvas is a local view of it. Records sit in a Y.Map keyed by ID, and Konva nodes are not stored in the shared document.
  - Nested Y.Maps work better when users edit different properties at once.
  - Positions are stored in whiteboard coordinates, and drag updates are throttled.
  - Source: [Konva: Multiplayer Whiteboard](https://konvajs.org/docs/sandbox/Multiplayer_Whiteboard.html) (search excerpt)
- Caveat: each Y.Map `set` leaves a tombstone of the previous value, so frequent position updates grow the document — [mcp.directory: Yjs](https://mcp.directory/skills/yjs) (low-quality source; verify)

**MURAL, Miro, draw.io**
- MURAL (17 Mar 2021) moved from DOM to HTML5 canvas because "the DOM was not designed to support dynamically changing interfaces" with thousands of elements.
  - **Split:** an app engine turns domain objects into graphical primitives (ASTs), and a separate renderer draws them to Canvas, to PDF/SVG for export, and later WebGL.
  - **Result:** "Performance, measured as the percentage of frames at 30fps or higher, improved by 80%."
  - **Costs:** no built-in accessibility on canvas, inconsistent text line-breaking across browsers, and Safari canvas limits.
  - Source: [MURAL: Performant Paintings](https://dev.to/mural/performant-paintings-building-a-canvas-render-engine-4506)
- Miro engineering built its own text rendering on HTML5 Canvas (2020), because rasterised `fillText` must be redrawn on every zoom change — [Miro Engineering: How we learned to draw text on HTML5 Canvas](https://medium.com/miro-engineering/how-we-learned-to-draw-text-on-html5-canvas-9f5613e64f5) (search excerpt)
- draw.io extends mxGraph, a client-side JavaScript diagramming library that draws with SVG and HTML — [mxGraph README (mirror)](https://github.com/shizhaojingszj/mxgraph/blob/master/README.md) (search excerpt; mirror of the jgraph repo)

### Inferences
- A restaurant room holds tens to a few hundred objects (walls, openings, tables, seats, fixtures). tldraw handles thousands of DOM/SVG shapes with culling, so **SVG is a sound choice** for Overcooked:
  - crisp vector output at any zoom
  - CSS theming for the Plan, Presentation and Service styles
  - SVG patterns for floor textures and filters or pre-baked shapes for soft shadows
  - native DOM hit-testing and accessibility
  - a print/PDF export path

  Canvas or WebGL is justified only at thousands of animated objects. If hover or selection of many objects becomes slow, follow tldraw 4.4 and draw indicators on a canvas overlay.
- Keep the layout model renderer-agnostic, like Figma's object/property map and MURAL's split between primitives and renderer. The same model can then drive the admin editor, the tablet service view and print or PDF output.
- For sync: editing is admin-centric while tablets mostly read. A server-authoritative, per-property last-writer-wins model (Figma, tldraw) is enough and much simpler than a CRDT. Use client-generated IDs and fractional indices for z-order. Yjs or other CRDTs only pay off if several people must edit offline at the same time.
- A "draft vs published" layout version, so service tablets see only the published layout while admins edit, is not documented in these sources. It follows from Overcooked's split between design time and service time.
- Migrating from the grid model to a wall graph needs schema versioning and migrations, given tldraw's warning that mismatched schemas break collaboration.

### Gaps
- No primary source was found for Miro's current renderer (Canvas 2D vs WebGL) or for Excalidraw's present canvas architecture (for example a static/interactive canvas split).
- No benchmark compares SVG, Canvas and WebGL at restaurant-plan scale (100–500 objects) on mid-range tablets.

## 7. Can users import an existing plan (photo, PDF, CAD) to trace, set the scale, or generate a plan from measurements?

### Takeaway
The near-universal pattern is underlay, calibrate, trace:
1. Upload an image or PDF.
2. Rotate or crop it.
3. Set the scale by marking two points a known distance apart.
4. Trace walls at the matching thickness, toggling the underlay on and off.

Beyond that, there are four other routes:
- AI recognition of plan images (Planner 5D), with slow and uneven turnaround.
- LiDAR room scanning on iPhone or iPad Pro (magicplan via Apple RoomPlan), which detects walls, doors and windows.
- Starting from CAD, DWG or PDF (event venues).
- Building the plan from a typed sequence of measured walls and openings (SmartDraw).

### Cited Findings
- Floorplanner tracing:
  - Background settings take PNG, JPG or PDF.
  - Rotate the image "so most of the walls are horizontal and vertical", and set units.
  - "Set scale": click both ends of something of known length, enter the distance and press OK.
  - Trace room by room at the interior wall thickness, then set the exterior wall thickness. Press B to hide or show the drawing while tracing.
  - Source: [Floorplanner Editor Manual](https://cdn.floorplanner.com/static/brochures/FloorplannerManualEN.pdf)
- Sweet Home 3D: Plan > Import background image (BMP, JPEG, GIF, PNG). "Define the scale of the image by moving the end points of the colored line drawn in the image", then enter the real length and match a point to the plan origin. The guide advises against large files because the image is only a helper — [Sweet Home 3D User's Guide](https://www.sweethome3d.com/userGuide.jsp)
- SmartDraw:
  - "If you have an existing floor plan as an image or PDF file, you can import it into SmartDraw, scale it, and draw your new designs or plan right on top."
  - "To use Floor Plan Notation, you simply describe a room as a sequence of walls and openings you measured."
  - Scale can be changed at any time, and print scale is independent of drawing scale.
  - Source: [SmartDraw: Draw a Floor Plan](https://waz.smartdraw.com/floor-plan/draw-floor-plans.htm)
- Planner 5D AI recognition:
  - Accepts JPG, PNG, PDF or DWG. It works best on clean images and poorly on blurry or shadowed photos, hand sketches and ornate plans.
  - Turnaround conflicts between sources: "10 minutes to 24 hours" in the support article, versus 1–3 minutes plus a designer review on the B2B page.
  - Also offered through a REST API.
  - Sources: [Planner 5D support: How to upload a floor plan](https://support.planner5d.com/en/articles/14434484-how-to-upload-a-floor-plan); contradicted on timing by [Planner 5D: B2B floor plan recognition](https://tool.planner5d.com/b2b-floor-plan-recognition); [Planner 5D API](https://tool.planner5d.com/api) (search excerpts)
- magicplan:
  - Auto-Scan (Apple RoomPlan) runs only on LiDAR devices (iPhone 12 Pro / Pro Max, iPad Pro and newer). It detects walls, windows and doorways, then shows a configuration screen before producing an editable plan.
  - Manual-Scan captures one room at a time in Wall Mode or Corner Mode. Corner Mode also works on older devices without LiDAR.
  - Sources: [magicplan help: Auto-scan your floor plan](https://help.magicplan.app/auto-scan-your-floor-plan); [magicplan help: Manual-Scan](https://help.magicplan.app/scan-a-room-in-seconds-using-lidar) (search excerpts)
- LiDAR scanning in general has trouble detecting glass walls or doors — [MAVRiC Research (2020)](https://mavricresearch.com/2020/11/10/magicplan-now-with-added-lidar-%F0%9F%A7%82) (search excerpt; predates Auto-Scan)
- ArchiSketch: image upload with optional auto-detection that uses the plan's dimension labels, or a manually entered scale. Accepts jpg/jpeg/png/gif up to 10 MB — [ArchiSketch: floor plan image upload](https://docs.archisketch.com/guide/user-guide/make-project/floor-plan-image-upload) (search excerpt)
- Two-point or known-wall calibration is the norm outside floor planners too:
  - Juniper Mist: "click set scale and drag between two points" — [Juniper Mist: Floorplan setup](https://www.juniper.net/documentation/us/en/software/mist/location-services/topics/concept/floorplan-setup.html)
  - Spoak: stretch a line along a wall of known length — [Spoak: Can I upload an existing floor plan?](https://help.spoak.com/article/284-upload-floor-plan)
  - Both via search excerpts.
- Event venues:
  - Cvent works from scaled CAD, DWG or PDF plans — [Cvent Event Diagramming](https://www.cvent.com/en/event-diagramming-and-seating)
  - Prismm pre-loads venue plans, or takes address, dimensions and perimeter walls. Its spatial commenting and 3D tours need a venue 3D-scanned by Prismm — [Prismm: event floor plan software](https://prismm.com/events/event-floor-plan-software); [Prismm platform pages](https://prismm.com/solutions/event-design-software/dynamic-3d-event-diagramming) (search excerpt; vendor claims)

### Inferences
- For Overcooked, the minimum viable import is:
  - a PDF or image underlay with two-point scale calibration
  - rotation, an opacity slider and a one-key or one-tap toggle
  - tracing with the wall tool at a chosen thickness

  This copies Floorplanner and Sweet Home 3D closely and covers the common case of an architect's or landlord's PDF.
- A typed perimeter ("wall 6.2 m, door 0.9 m, wall 3.1 m …", as in SmartDraw notation or Prismm's perimeter walls) is a cheap fallback for owners with only a tape measure.
- iPad Pro LiDAR capture via RoomPlan (magicplan) could set Overcooked apart later. But glass storefronts, common in restaurants, are a documented weakness of LiDAR, and the feature is limited to Pro devices.

### Gaps
- No public accuracy figures were found for RoomPlan, magicplan or Planner 5D recognition.
- It is unclear whether Cvent Event Diagramming users import DWG themselves or Cvent's team prepares venue plans, since the FAQ wording is ambiguous.
- Whether Floorplanner or RoomSketcher import DWG/DXF directly was not checked.
