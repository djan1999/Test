# Fine-dining floor and seating conventions a floor-layout system should encode

Legend used on every finding: **[CODE]** = enforceable code or regulation where adopted · **[STAT. GUIDANCE]** = official guidance that shows one way to comply with a legal requirement (e.g. England's Approved Documents) · **[STD]** = voluntary or professional-body standard · **[CURRICULUM]** = formal training material · **[PRACTICE]** = operator, trade-press or journalist description of common practice · **[VENDOR]** = furniture/design-vendor rule of thumb · **[SOFTWARE]** = behaviour of a named product · **[OPINION]**. "(snippet)" = taken from a search-result excerpt because the page itself could not be fully read; treat as lower confidence. Values in square brackets [ ] are my unit conversions (1 in = 25.4 mm; 1 sq ft = 0.0929 m²) unless the source gives both units.

## 1. How do fine-dining teams number seats and positions, how consistent is it, and what changes when tables are joined or reconfigured?

### Takeaway
The dominant convention is "pivot point" numbering: one fixed reference point per dining room (kitchen door or food window, front door, or host stand) defines seat 1 at every table as the seat nearest that point. The other seats are then numbered in one fixed direction. Clockwise is most common, but the main US hospitality curriculum (NRAEF ProStart) teaches counterclockwise, and booths and banquettes get house-specific rules. Consistency inside one restaurant is the point; the specific choice is not standardised, and no source describes a standard for renumbering joined tables.

### Cited Findings
- [CURRICULUM] NRAEF ProStart, *Foundations of Restaurant Management & Culinary Arts*, 3rd ed., Chapter 5 "Welcome to the Front of the House", Activity 5.1 answer key (© 2010–2025 NRAEF; PDF created 13 Mar 2025): "Each dining room has a pivot point, such as the front door, which establishes the location of seat number one at any table—closest to the pivot point. The numbering of seats continues to the left (counterclockwise). The server approaches each table at the specific place determined by the floor plan." — [NRAEF ProStart Ch.5 Instructor Activity Guide (hosted by NCRLA)](https://www.ncrla.org/wp-content/uploads/2025/10/L1CH05_InstrActivityGuide.pdf)
- [PRACTICE] George Mahe, dining editor at St. Louis Magazine (20 Feb 2015, updated 8 Feb 2025), says the pivot point is usually the kitchen door or the food window. Table numbers increase outward from it by row (one row in the teens, the next in the 20s), so runners can count their way to a table. Seat numbers "also pivot off the same point" and usually run clockwise, and many seating charts mark seat 1 with an X. — [St. Louis Magazine, "Ask George: How do restaurants number their tables and why?"](https://www.stlmag.com/dining/ask-george:-how-do-restaurants-number-their-tables-and-why)
- [PRACTICE] The same article calls the seating chart "the most important organizational tool in a restaurant": one page showing the server stations and every table in every room, used by front desk, bussers, servers and managers. — [St. Louis Magazine](https://www.stlmag.com/dining/ask-george:-how-do-restaurants-number-their-tables-and-why)
- [PRACTICE] A hotel specialty-restaurant SOP (search results attribute it to Westin) says: "Usually, this point of reference is an area of the restaurant easily definable, such as the hostess stand or the kitchen." A trade article attributed to Restaurant Business says: "At each table, the seat closest to the focus point is Seat #1. From there, move clockwise around the table to assign the other seat numbers." (snippets; the SOP page was not read in full, and Restaurant Business returned HTTP 403) — [studfile SOP](https://studfile.net/preview/7123952/page:3/); [Restaurant Business, "Going once, going twice"](https://restaurantbusinessonline.com/going-once-going-twice)
- [PRACTICE/OPINION] A restaurant expert quoted by Yahoo Food explains why clockwise is used: "So if you go clockwise, you can count those seats as you go around to make sure you're in the right place, instead of having to count backwards." (snippet) — [Yahoo Food, "The Secret Waiter Trick You've Never Noticed"](https://www.yahoo.com/food/the-secret-waiter-trick-youve-never-noticed-95391574116.html)
- [PRACTICE] An operator's internal training page, "How to Number Seat – The Vic Way", shows house-specific anchors: "For booths, it's the seat to the left of the server. For tables, it's the point to the west (The TD BANK) or sitting on the banquette." (snippet; the Notion page would not render) — [Notion training page](https://sonyaszabo.notion.site/How-to-Number-Seat-The-Vic-Way-42c4090062794177b3a2c7f2cad368ff)
- [STD] Beverage service also uses a host-relative order alongside the room-relative numbering. The Court of Master Sommeliers Europe *Service Standards* (file "Service-Standards-24.1", uploaded May 2024) say glass placement "starts with the person to the left of the host and continues clockwise to finish with the host", and wine is poured "moving to the left (clockwise) around the table". — [CMS Europe Service Standards 24.1](https://courtofmastersommeliers.org/wp-content/uploads/2024/05/Service-Standards-24.1.pdf)
- [SOFTWARE] Seating-plan software treats direction and starting seat as a setting. PerfectTablePlan lets users change seat numbering, including clockwise or counterclockwise (snippet). — [PerfectTablePlan help: change the seat numbering](https://www.perfecttableplan.com/help/70/mac/html/change_the_seat_numbering.htm)
- [SOFTWARE] Toast POS: "Order by seat" is on by default, and seat numbers can be set as optional or required in both Quick Order and Table Service modes (Toast Web > Front of house > Order screen setup) (snippet). — [Toast Support: Use Order by Seat](https://support.toasttab.com/en/article/Order-by-Seat); [Toast Central: enable seat numbers and party sizes](https://intercom.help/toast-central/en/articles/9308364-enable-seat-numbers-and-party-sizes-for-pos-orders)

### Inferences
- A seat-numbering convention has three parameters: (a) a reference point in the room, (b) seat 1 = the seat nearest that point, and (c) one direction. Sources disagree on direction (clockwise per St. Louis Magazine, the SOP and Yahoo; counterclockwise per ProStart), so Overcooked should store reference point and direction as a restaurant- or room-level setting rather than hard-coding clockwise.
- "To the left" is used for both directions: CMS says "to the left (clockwise)" and ProStart says "to the left (counterclockwise)". The UI should show direction with an arrow on the table glyph, never as words alone.
- **Conflict with Overcooked's invariant.** Overcooked keeps seat numbers identical across alternative floor layouts, but pivot-point numbering depends on where a table sits relative to the landmark. If an alternative layout moves or rotates a table, strict pivot logic would renumber its seats. Two workable designs:
  1. Bind seat numbers to the table's own frame (seat 1 = a specific chair position of that table), use the room rule only as the default when a table is first created, and have the editor warn (not auto-renumber) when a layout makes seat 1 no longer nearest the reference point.
  2. Keep a stable seat ID for guest data and derive a per-layout display label.

  Either way, guest data (menu, language, restrictions, pairing) should attach to a stable seat or guest identity, not to a label computed from geometry.
- Numbering tables in rows of tens outward from the kitchen makes table numbers encode location. Restaurant-wide table numbers that persist across layouts lose this in layouts that move tables far, so a per-layout "where is table 23" view or locator matters.
- Booths, banquettes and counters need explicit seat-1 rules (e.g. a booth's seat 1 is the seat to the server's left; a banquette table's seat 1 is on the banquette side). Table templates should therefore carry their own default seat-1 anchor and direction.
- Wine service order is host-relative, separate from the position numbers (see Q2). The system needs both a "position number" (identity on tickets) and a "service sequence" (derived from which seat is the host).

### Gaps
- CIA *Remarkable Service* and other hospitality textbooks were not accessed. No authoritative text was found on numbering bar or chef's-counter seats. Left-to-right from one fixed end is a plausible default but unverified.
- No source describes how seats are renumbered when tables are joined or the room is reconfigured (see Q6).
- The Restaurant Business article (HTTP 403) and the Notion training page (did not render) were seen only as search snippets.
- No data on how widely clockwise is used compared with counterclockwise.

## 2. How are seat positions used in service (order taking, no auctioning, allergies, wine pairing, ladies-first/host-last), and how do they appear on tickets and kitchen displays?

### Takeaway
Positions mean the person who takes an order does not have to be the one who delivers it. Orders are keyed to table plus position, the expediter calls "Table 33, 1 and 2", runners deliver without "auctioning" plates, and the captain passes allergy information to kitchen and bar, where it is highlighted on tickets. Beverage service follows a host-relative order (CMS: guest of honour first, then ladies, gentlemen, and the host last, moving clockwise; for parties of 8 or more, plain clockwise), and gender-based ordering is increasingly questioned. POS and KDS products show seat numbers next to items but have limits that matter for tasting menus: one seat per item, seat number does not affect sort order, and tickets are split per course.

### Cited Findings
#### Ordering and delivery by position
- [PRACTICE] Expediters call orders by table and seat (e.g. "Table 33, 1 and 2") so runners know where each item goes. Done properly there is no "auctioning of food"; the author blames auctioning on inattentive or lazy staff and says nicer restaurants should never have it. — [St. Louis Magazine](https://www.stlmag.com/dining/ask-george:-how-do-restaurants-number-their-tables-and-why)
- [CURRICULUM] ProStart guidance for order taking:
  - On paper, write orders "in delivery sequence" (drinks, appetizers, soups, salads, entrées and desserts grouped) using house abbreviations.
  - On handhelds, enter guest modifications.
  - Use a script for special requests covering "dietary preferences, food allergies, or sensitivities".
  - Repeat the order back to the guest.
  — [NRAEF ProStart Ch.5 Activity Guide](https://www.ncrla.org/wp-content/uploads/2025/10/L1CH05_InstrActivityGuide.pdf)
- [PRACTICE] For large groups, a consultant notes that ordering from around the table makes splitting checks difficult; seat numbers keep orders and checks from getting tangled (snippet). — [Yahoo Lifestyle, "What You Should and Shouldn't Do When You Go Out to Dinner with a Big Group"](https://www.yahoo.com/lifestyle/shouldnt-dinner-big-group-161423458.html)

#### Who does what in fine-dining service
- [PRACTICE] The captain or lead server is "the point person for each of the tables in their section". They present menus and explain the concept, take beverage and food orders, and "communicate allergy information to the kitchen and bar". Front waiters directly support captains (snippet). — [Institute of Culinary Education, "Front of House Roles in Fine Dining Explained"](https://www.ice.edu/blog/front-of-house-roles-in-fine-dining-explained)
- [PRACTICE] The expediter (expo) reads incoming tickets, calls orders and fire times to stations, checks each plate, and assembles finished dishes into complete courses for runners (snippet). — [Loyalist glossary: Expeditor](https://www.eatloyalist.com/glossary/expeditor/). In many smaller fine-dining restaurants the head chef also serves as expo, and the role can rotate between chef, sous chef and even front-of-house staff (snippet). — [Tasting Table, "What Does 'Expo' Refer To In A Restaurant?"](https://www.tastingtable.com/1910132/what-is-expo-restaurant/)
- [PRACTICE] Expediter job postings at hotels and fine-dining venues describe employer expectations (snippets; quotes are not mapped to individual postings):
  - runners "have memorized table and seat numbers for every dish leaving the kitchen";
  - expo makes sure "allergies and dietary restrictions are highlighted on order tickets";
  - expo checks seat numbers, modifications, allergies and dietary requests on each order;
  - expo manages "pacing for à la carte and tasting menus".
  — e.g. [Hospitality Online expeditor posting](https://hospitalityonline.com/jobs/4222527-restaurant-expeditor); [HHM / The Rittenhouse expeditor posting](https://careers.hhmhotels.com/jobs/4192056-restaurant-expeditor)

#### Wine and beverage service order — CMS Europe *Service Standards* 24.1 (2024) [STD; exam standard, not law]
- "Beverage service is always performed (where possible) to the right of the guest." The sommelier identifies the host and presents the list from the host's right, then stands "to the right of the guest to take the order" and repeats back vintage, producer and vineyard. — [CMS Europe Service Standards 24.1](https://courtofmastersommeliers.org/wp-content/uploads/2024/05/Service-Standards-24.1.pdf)
- Glassware goes to the right of each guest near the tip of the knife, and placement must be "identical for each guest". Placement starts with the person left of the host, continues clockwise and finishes with the host. A glass for each additional new wine goes "diagonally below the original glass, either to the left or right, depending on the house style." — [CMS Europe](https://courtofmastersommeliers.org/wp-content/uploads/2024/05/Service-Standards-24.1.pdf)
- Pouring sequence — [CMS Europe](https://courtofmastersommeliers.org/wp-content/uploads/2024/05/Service-Standards-24.1.pdf):
  - The host tastes about 50 ml [≈1.7 US fl oz].
  - After approval the wine is served "moving to the left (clockwise) around the table, serving the ladies first, gentlemen second and the host last – regardless of gender".
  - "If there is a guest of honour, that person is served before anyone else on the table."
  - "In parties of eight or more it is acceptable to serve everyone in a clockwise direction regardless of gender."
  - Glasses are filled one third to half full, and "Always complete the pours for one guest before moving on to the next."
- For liqueurs and spirits: guest of honour first, "followed by ladies and then gentlemen and finally the host", using 25/50 ml measures. If the sommelier tastes a wine to check it, "around 30ml is suggested", with the guest's permission. — [CMS Europe](https://courtofmastersommeliers.org/wp-content/uploads/2024/05/Service-Standards-24.1.pdf)
- [OPINION] A Restaurant Business advice column notes that formal ladies-first ordering is being lost, "possibly in the interest of efficiency, gender inclusiveness or both" (snippet). — [Restaurant Business, "Is 'ladies first' still best when serving wine?"](https://restaurantbusinessonline.com/advice-guy/ladies-first-still-best-when-serving-wine)

#### Tickets and kitchen displays [SOFTWARE]
- Toast (snippets; which quote sits on which Toast page is not verified):
  - with seat numbers enabled, they "show on the ticket or screen next to the item" but "don't affect sort priority";
  - grid-view KDS shows seat numbers when available;
  - changing a seat number after an item is sent triggers a change notice to the KDS or ticket printer;
  - the POS "allows assigning a menu item to only one seat position", so one plate cannot be marked for two or more seats.
  — [Toast Support: Use Order by Seat](https://support.toasttab.com/en/article/Order-by-Seat?lang=en_US); [Toast Central: kitchen-ticket item sorting](https://intercom.help/toast-central/en/articles/9320673-manage-item-sorting-priority-for-kitchen-tickets); [Toast Community: seat positions](https://community.toasttab.com/t5/restaurant-operations/seat-positions/m-p/13471)
- Toast course pacing (snippets):
  - courses can be set to fire once the previous course has been fulfilled;
  - with course pacing on the KDS, "tickets will always be separated into individual tickets per course";
  - an "Order by Course" setting prompts for a course after the seat.
  — [Toast: Automated and Expediter Course Firing](https://support.toasttab.com/en/article/Automated-and-Expediter-Course-Firing?lang=en_US); [Toast platform guide: KDS workflow using course pacing](https://doc.toasttab.com/doc/platformguide/platformKDSWorkflowUsingCoursePacing.html); [Toast Community: course number modifier](https://community.toasttab.com/t5/restaurant-operations/how-to-move-the-course-number-modifier/m-p/6906)

#### Per-guest menus and restriction records
- [PRACTICE] A Miami Michelin-starred restaurant's own blog says some restaurants add "personalized menu cards bearing the guest's name or event details" (snippet). — [Stubborn Seed](https://www.stubbornseed.com/posts/how-michelin-star-restaurants-in-miami-adapt-to-guest-preferences)
- [VENDOR] A form vendor describes tasting-menu modification requests as becoming "part of your guest's dining record, accessible before service and referenced for future visits" (snippet). — [Paperform tasting-menu modification template](https://paperform.co/templates/tasting-menu-modification-request-form/)
- [PRACTICE] Policies vary: one tasting menu states that dietary restrictions "can not be accommodated" because of the menu's format (snippet). — [Bluebeard chef's tasting menu (Toast booking page)](https://book.toasttab.com/r/bluebeard-653-virginia-avenue/experiences/chef-s-tasting-menu)

### Inferences
- **Two orderings per table.** Position numbers (room-relative identity used on tickets, menus and expo calls) and service sequence (host-relative pour order) are different things. Both can be derived from the same ordered ring of seats once the host's seat is known.
- **Service order as data.** The seat or guest record needs a host flag, a guest-of-honour flag and a house-style service-order mode. Modes: CMS classic (honour, then ladies, then gentlemen, then host), plain clockwise, or plain clockwise automatically at 8+ covers per CMS. Storing a neutral "service priority group" rather than gender keeps the data less sensitive and supports houses that have dropped ladies-first.
- **Wine pairing.** Each pairing course adds a glass, glass placement must be identical for every guest, and pours are completed one guest at a time in sequence. A per-seat pairing choice (full, half, non-alcoholic, none) therefore drives a pour list in service order for the sommelier and a per-seat glass count at the station.
- **Restrictions on tickets.** Allergies are owned by the captain and verified by expo, so tickets and KDS must show the position number and highlight its restriction next to each affected item. If a guest changes chairs, the guest's data must move with them and the kitchen must be re-notified; Toast already sends change notices.
- **Shared items.** Table-shared items (bread, amuse-bouche, shared courses) need multi-seat assignment while keeping per-seat restriction checks. Toast does not allow one item on several seats, which is a gap Overcooked can fill.
- **Pacing.** Toast splits tickets per course. For tasting menus the service board's unit is table × course, with per-seat variants inside a course (e.g. seat 3's shellfish-free version), so expo can see that a course is complete only when every seat's variant is up.

### Gaps
- No primary source was found for **food** service order in fine dining: women or elders first and host last, serve from the left and clear from the right, or synchronised "all plates down at once" service. CIA *Remarkable Service* was not accessed.
- Forbes Travel Guide standards are proprietary, so a "no auctioning" standard could not be verified. FTG says it inspects against "up to 900 standards" (snippet). — [FTG media center](https://forbestravelguide.com/media-center)
- No source was found on kitchen ticket notation conventions (e.g. "P1/P2", allergy symbols, colour codes) or on how tasting-menu restaurants print per-seat menus with names, languages or modifications. Only anecdotal or vendor material turned up.

## 3. What are standard table sizes per cover, recommended space per guest in fine dining, chair clearances and service aisle widths?

### Takeaway
These are vendor and industry rules of thumb, not codes, but they converge:
- **Area:** fine dining needs about 18–20+ sq ft per seat [≈1.7–1.9+ m²], against roughly 15–18 sq ft for casual dining.
- **Width per cover:** 24–30 in [610–760 mm] of table edge.
- **Chair zone:** 18 in [457 mm] from table edge to chair back.
- **Between tables:** 42 in [1,067 mm] baseline, 54 in [1,372 mm] around rounds, and 60–62 in [1,524–1,575 mm] where a service aisle runs between tables.
- **Main aisles:** 48–60 in [1.22–1.52 m].

Vendor capacities are generous; for full-course service the lower end of each table's range applies.

### Cited Findings
#### Area per seat [VENDOR/PRACTICE]
- Oak Street Manufacturing (undated page, © 2026) gives square feet per guest by service style:
  - fine dining: 18–20+ sq ft [≈1.67–1.86+ m²]
  - casual dining: 15–18 [1.39–1.67 m²]
  - fast casual: 11–14 [1.02–1.30 m²]
  - bar/lounge: 12–15 [1.11–1.39 m²]
  - general benchmark: 12–14 for comfortable seating

  — [Oak Street, "The Ultimate Restaurant Seating Layout Guide with Real Numbers"](https://www.oakstreetmfg.com/the-ultimate-restaurant-seating-layout-guide-with-real-numbers/)
- Toast and Designing Buildings also give about 18–20 sq ft per seat for fine dining. Banquet seating is the densest at about 10–12 sq ft (snippet). — [Toast, average restaurant square footage](https://pos.toasttab.com/vi-us/blog/on-the-line/average-restaurant-square-footage); [Designing Buildings Wiki, "Structuring a restaurant floor plan"](https://designingbuildings.co.uk/wiki/Structuring_a_restaurant_floor_plan)
- Restaurant-Furniture.com (© 2008–2026) gives area per person including tables, chairs and aisle:
  - 14 sq ft [1.30 m²] general
  - 12 sq ft [1.11 m²] cafeteria or restaurant-style seating
  - 10 sq ft [0.93 m²] banquet or closed seating
  - 8 sq ft [0.74 m²] for booths where space is limited

  — [Restaurant-Furniture.com seating capacity guide](https://www.restaurant-furniture.com/resources/guides/restaurant-seating-capacity-guide)

#### Table edge per cover
- Oak Street gives 24–30 in [610–762 mm] of lateral dining space per diner. — [Oak Street](https://www.oakstreetmfg.com/the-ultimate-restaurant-seating-layout-guide-with-real-numbers/). Restaurant-Furniture.com gives a minimum width per diner of 24 in [610 mm]. — [Restaurant-Furniture.com](https://www.restaurant-furniture.com/resources/guides/restaurant-seating-capacity-guide)
- A furniture planning sheet describes a 30 in [762 mm] standard table width with 24 in as the minimum per diner (snippet). — [RFP Space Planning PDF](https://cdn.shopify.com/s/files/1/1426/5736/files/RFP-Space-Planning.pdf). RonGroup gives a minimum of 24 in of table width per person including elbow room (snippet). — [RonGroup table sizing guide](https://www.rongroupglobal.com/opening-a-restaurant/blog-restaurant-table-sizing-guide.html)
- Restaurant-Furniture.com sizes tables at about 300 sq in [≈0.19 m²] of top per diner; its example is a 30×42 in top (1,260 sq in) seating about 4. It says a 30×30 in table serves only 2 seated guests for full-course meals, though cafés may seat 4 there. — [Restaurant-Furniture.com](https://www.restaurant-furniture.com/resources/guides/restaurant-seating-capacity-guide)

#### Table sizes and nominal capacity [VENDOR]
Sources: [Oak Street](https://www.oakstreetmfg.com/the-ultimate-restaurant-seating-layout-guide-with-real-numbers/) (OS) and [Restaurant-Furniture.com](https://www.restaurant-furniture.com/resources/guides/restaurant-seating-capacity-guide) (RF). "–" means the size is not listed by that source.

| Shape | Size (in) | ≈ mm | OS seats | RF seats |
|---|---|---|---|---|
| Square | 24×24 | 610×610 | 2 | 2 |
| Square | 30×30 | 762×762 | – | 2–4 (2 for full-course) |
| Square | 36×36 | 914×914 | 4 | 4 |
| Square | 42×42 | 1067×1067 | 4–6 | 4–6 |
| Square | 48×48 | 1219×1219 | up to 8 | 8 |
| Round | Ø24 | Ø610 | 2 | 2 |
| Round | Ø30 | Ø762 | 3–4 | 3–4 |
| Round | Ø36 | Ø914 | 4 | 3–4 |
| Round | Ø42 | Ø1067 | – | 4–5 |
| Round | Ø48 | Ø1219 | 5–6 | 5–6 |
| Round | Ø60 | Ø1524 | 8 | 8–10 |
| Round | Ø72 | Ø1829 | – | 10 |
| Rectangle | 24×30 | 610×762 | 2 | 2 |
| Rectangle | 24×42 | 610×1067 | – | 4 |
| Rectangle | 24×48 | 610×1219 | 4 | 4 |
| Rectangle | 30×42 | 762×1067 | – | 4 |
| Rectangle | 30×60 | 762×1524 | 6 | 6 |
| Rectangle | 30×72 | 762×1829 | 6–8 | 6–8 |
| Rectangle | 36×96 | 914×2438 | 8–10 | – |

#### Chair zone, spacing and aisles [VENDOR]
- Both vendors give 18 in [457 mm] from the table edge to the back of the chair of a seated person. — [Oak Street](https://www.oakstreetmfg.com/the-ultimate-restaurant-seating-layout-guide-with-real-numbers/); [Restaurant-Furniture.com](https://www.restaurant-furniture.com/resources/guides/restaurant-seating-capacity-guide)
- Oak Street, spacing between tables:
  - 42 in [1,067 mm] between table edges for standard full service
  - 60–62 in [1,524–1,575 mm] "with active service aisles" (about 62 in recommended between square tables when a service aisle is needed)
  - bar stool clearance of 42 in or more

  — [Oak Street](https://www.oakstreetmfg.com/the-ultimate-restaurant-seating-layout-guide-with-real-numbers/)
- Restaurant-Furniture.com: minimum 42 in between square tables and chairs, and 54 in [1,372 mm] for round tables and service space. — [Restaurant-Furniture.com](https://www.restaurant-furniture.com/resources/guides/restaurant-seating-capacity-guide)
- Oak Street, aisle widths: main traffic aisles 48–60 in [1,219–1,524 mm]; secondary aisles 36–44 in [914–1,118 mm]; ADA-accessible paths 36 in [914 mm] minimum. — [Oak Street](https://www.oakstreetmfg.com/the-ultimate-restaurant-seating-layout-guide-with-real-numbers/)
- The RFP planning sheet gives wait-staff aisles of 24–30 in [610–762 mm] and main service aisles of 36 in [914 mm] (snippet). — [RFP Space Planning PDF](https://cdn.shopify.com/s/files/1/1426/5736/files/RFP-Space-Planning.pdf). Superior Seating gives a 24 in [610 mm] minimum passing aisle in front of booth seats (snippet). — [Superior Seating Design & Specs Center](https://www.superiorseating.com/design-specs-center)
- Restaurant-Furniture.com sizes wait stations as "small, 6 to 10 feet; larger, up to 40 feet". The units are ambiguous (linear or square feet). — [Restaurant-Furniture.com](https://www.restaurant-furniture.com/resources/guides/restaurant-seating-capacity-guide)
- [CODE cross-reference] For egress, the US IBC measures aisle-accessway width from a line 19 in [483 mm] from the table edge, which matches the vendors' 18 in chair zone (see Q4). — [Minn. R. 1305.1018 (IBC adoption)](https://www.law.cornell.edu/regulations/minnesota/Minn-R-1305-1018)

### Inferences
- **Fine-dining defaults for Overcooked's editor:**
  - 18–20 sq ft [1.7–1.9 m²] of dining-room floor per seat as a density benchmark (a soft warning below 18, not a rule);
  - 30 in [760 mm] per cover rather than 24 in for tasting menus with pairings, because CMS adds a glass per new wine and requires identical glass placement for each guest;
  - the lower end of vendor capacity ranges (Ø48 in round = 5, Ø60 in = 8, 30×30 in = 2 for full-course service).
- **Vendor spacing can fall below code.** Where chairs sit back-to-back between two tables, the IBC needs 19 + 12 + 19 = 50 in [1,270 mm] edge to edge for an aisle accessway up to 12 ft long, and more as it gets longer (a 20 ft accessway needs 12 + 0.5×8 = 16 in, so 54 in [1,372 mm] edge to edge). The only exception is a segment of 6 ft or less serving 4 people or fewer. The vendor rule of 42 in between table edges can therefore fail code in some arrangements, so a layout validator should compute the code width rather than apply the rule of thumb (see Q4).
- **Chair zone in geometry.** The 18–19 in chair zone should be part of each table's footprint, so clearance and route checks are measured from occupied-chair envelopes rather than table edges.

### Gaps
- No authoritative design reference (Neufert, the Metric Handbook, Time-Saver Standards) was accessed for metric per-cover widths or fine-dining spacing.
- No sourced dimensions were found for banquettes and booths (seat depth, width per person, booth lengths), chef's counters and bars (stool spacing, counter heights of 36 vs 42 in), chef's tables, or the space needed for guéridons, ice-bucket stands and trolleys.

## 4. What accessibility requirements (US 2010 ADA; UK/EU equivalents) and fire/occupancy rules affect dining-room layouts?

### Takeaway
**US.** The 2010 ADA Standards are prescriptive:
- At least 5% of seating and standing spaces at dining surfaces must comply with §902: top at 28–34 in [710–865 mm], a 30×48 in [760×1220 mm] forward-approach clear floor space, and knee and toe clearance per §306.
- Accessible seats must be dispersed throughout the space.
- An accessible route at least 36 in [915 mm] wide must reach all dining areas, including raised, sunken and outdoor areas.

**England.** Approved Document M Vol 2 is functional rather than numeric:
- all users must reach all parts of the facility, including terraces and every floor level;
- part of the bar or serving counter must be at 850 mm or lower;
- there must be an accessible threshold to external seating.

It sets no share of accessible tables and no table height.

**EU.** EN 17210:2021 is likewise functional, with technical criteria in CEN/TR 17621:2021.

**Fire and occupancy.** US occupant load is 15 net sq ft [1.4 m²] per person for tables and chairs (IBC Table 1004.5); UK guidance uses 1.0 m² [10.8 sq ft] per person for restaurants. Aisle accessways between tables (IBC) must be 12 in plus 0.5 in per foot beyond 12 ft, measured from a line 19 in from the table edge, with no more than 30 ft of travel to a choice of two exit paths. Several obligations start at 50 occupants.

### Cited Findings
#### US — 2010 ADA Standards for Accessible Design [CODE for ADA-covered public accommodations; state codes such as California CBC 11B or Massachusetts 521 CMR can be stricter]
- **§226.1 Quantity:** where dining surfaces are provided for the consumption of food or drink, "at least five percent (5%) of the seating spaces and standing spaces at the dining surfaces comply with section 902". — [Corada, Guidance on the 2010 ADA Standards: 226 & 902](https://www.corada.com/documents/guidance-on-the-2010-adas/226-and-902-dining-surfaces-and-work-surfaces). Exception: "Sales counters and service counters shall not be required to comply with 902" (snippet). — [Corada: 2012 TAS §226](https://www.corada.com/documents/2012-tas/226-dining-surfaces-and-work-surfaces)
- **Seats, not tables:** the 2010 rules moved from counting fixed tables (1991 Standards) to counting seating and standing spaces, because table sizes vary and counting tables could limit opportunities. — [Corada guidance](https://www.corada.com/documents/guidance-on-the-2010-adas/226-and-902-dining-surfaces-and-work-surfaces). By contrast, Massachusetts 521 CMR 17 still says "At least 5%, but not less than one of the tables provided shall be accessible and be on an accessible route" (snippet). — [Massachusetts 521 CMR 17 Restaurants](https://www.mass.gov/doc/521-cmr-17-restaurants-0/download)
- **§226.2 Dispersion:** compliant surfaces "shall be dispersed throughout the space or facility containing dining surfaces and work surfaces" (snippet). — [Corada: 2012 TAS §226](https://www.corada.com/documents/2012-tas/226-dining-surfaces-and-work-surfaces). The Los Angeles plan-review checklist for California CBC 11B requires dispersion "for each type of seating in a functional area" (snippet). — [LADBS Supplemental Plan Review Checklist No. 3 – Restaurant](https://dbs.lacity.gov/sites/default/files/efs/forms/pc17/supplemental-plan-review-checklist-no-3---restaurant.pdf)
- **§902.2/902.3:** a clear floor space complying with §305, positioned for a forward approach, plus knee and toe clearance complying with §306. "The tops of dining surfaces and work surfaces shall be 28 inches (710 mm) minimum and 34 inches (865 mm) maximum above the finish floor or ground" (snippet). — [US Access Board, ADA Standards Chapter 9](https://www.access-board.gov/ada/chapter/ch09/). For children's dining surfaces, knee clearance of "24 inches (610 mm) minimum above the floor shall be permitted" (snippet, §902.4). — [US Access Board, Chapter 9](https://www.access-board.gov/ada/chapter/ch09/)
- **§305.3 Clear floor space:** 30 in (760 mm) wide by 48 in (1220 mm) long minimum (snippet). — [36 CFR Part 1191 Appendix D (Cornell LII)](https://law.cornell.edu/cfr/text/36/appendix-D_to_part_1191); [US Access Board ABA Chapter 3](https://www.access-board.gov/aba/chapter/ch03/)
- **§306 Knee and toe clearance** (snippet) — [36 CFR Part 1191 Appendix D](https://law.cornell.edu/cfr/text/36/appendix-D_to_part_1191); [Access Board ABA Chapter 3](https://www.access-board.gov/aba/chapter/ch03/):
  - Toe clearance is the space from the floor to 9 in (230 mm). It must be 30 in (760 mm) wide, may extend at most 25 in (635 mm) under the element, and where required must extend at least 17 in (430 mm).
  - Knee clearance is the space between 9 in and 27 in (685 mm) above the floor and must be at least 30 in (760 mm) wide.
  - Knee depth is at most 25 in (635 mm) at 9 in above the floor, at least 11 in (280 mm) at 9 in, and at least 8 in (205 mm) at 27 in; depth may reduce by 1 in for each 6 in of height.
- **Legacy figure still common in practice:** the 1991 ADAAG and Massachusetts rules give knee space of 27 in (685 mm) high, 30 in (760 mm) wide and 19 in (485 mm) deep. Vendors still quote "27 in knee clearance, 19 in depth, 30×48 in clear floor area, 36 in pathways" (snippets/fetched). — [Archived Access Board ADAAG comparison, Ch. 9](https://webarchive.library.unt.edu/eot2008/20080917173655/http:/www.access-board.gov/ada-aba/comparison/chapter9.htm); [Massachusetts 521 CMR 17](https://www.mass.gov/doc/521-cmr-17-restaurants-0/download); [Oak Street](https://www.oakstreetmfg.com/the-ultimate-restaurant-seating-layout-guide-with-real-numbers/)
- **§206.2.5 Restaurants and cafeterias:** an accessible route must be provided to all dining areas, "including raised or sunken dining areas, and outdoor dining areas". Exceptions (snippet):
  - in alterations, no accessible route is required to existing raised or sunken areas, or to all parts of existing outdoor dining areas, where the same services and decor are provided in an accessible space;
  - a mezzanine is exempt when it holds less than 25% of the total dining area and the accessible area offers the same services;
  - the advisory gives bar service, smoking and non-smoking sections, lotto and table games, carry-out and buffet service as examples of "same services".

  — [Corada: 2010 ADA Standards §206.2.5](https://www.corada.com/documents/2010ADAStandards/206-2-5); [Texas TDLR accessible routes presentation](https://license.state.tx.us/ab/ppt/2024/part-5-acc-route-curbs.pdf)
- **§403.5 Route clearances** (snippet) — [Corada: 2010 ADA §403.5](https://www.corada.com/documents/2010ADAStandards/403-5):
  - accessible routes need 36 in (915 mm) clear width minimum;
  - width may reduce to 32 in (815 mm) for no more than 24 in (610 mm) of length, provided reduced segments are separated by segments at least 48 in (1220 mm) long and 36 in wide;
  - at a 180° turn the clear width is 60 in (1525 mm);
  - routes narrower than 60 in need 60×60 in passing spaces at most every 200 ft (61 m) (§403.5.3);
  - turning space (§304.3) is a 60 in (1525 mm) circle or a T-shaped space.
- **Counters over 34 in (864 mm):** Massachusetts requires that where food or drink is served at counters above 34 in, a portion of the counter be accessible or service be available at accessible tables (snippet). — [Massachusetts 521 CMR 17 (PDF)](https://www.mass.gov/doc/521cmr17pdf/download)

#### UK (England) — Approved Document M Vol 2, *Buildings other than dwellings* [STAT. GUIDANCE]
2015 edition, in force 1 Oct 2015, incorporating the 2020 and 2024 amendments (the 2024 changes reference Approved Document T). Source for every point below: [Approved Document M Vol 2 (gov.uk)](https://assets.publishing.service.gov.uk/media/60b0ea89d3bf7f43560e324a/Approved_Document_M_vol_2.pdf).
- 4.3: "In refreshment facilities, bars and counters (or sections of them) should be at a level suitable for wheelchair users. All floor areas, even when located at different levels, should be accessible."
- 4.13–4.15 (design considerations):
  - refreshment facilities should be designed "so that they can be reached and used by all people independently or with companions. Staff areas should also be accessible";
  - "All public areas, including lavatory accommodation, public telephones and external terraces should be accessible. Where premises contain self-service and waiter service, all patrons should have access to both";
  - changes of floor level used to create atmosphere "are acceptable provided the different levels are accessible".
- 4.16 (provisions) — refreshment facilities satisfy Requirement M1 if:
  - (a) "all users have access to all parts of the facility";
  - (b) part of the working surface of a bar or serving counter is "permanently accessible to wheelchair users, and at a level of not more than 850mm [33.5 in] above the floor and, where necessary, part at a higher level for people standing";
  - (c) a shared refreshment facility worktop is at 850 mm with clear space beneath of at least 700 mm [27.6 in];
  - (d) "a wheelchair-accessible threshold … is located at the transition between an external seating area and the interior of the facility".
- 3.14 (corridors and passageways): unobstructed width "of at least 1200mm" [47 in]. Where the width is under 1800 mm [71 in], passing places at least 1800 mm long and 1800 mm wide are needed "at reasonable intervals".
- ADM Vol 2's refreshment section gives no percentage of accessible seats or tables and no table-height range.
- [STAT. GUIDANCE, Scotland — secondary] A Scottish building-standards alternative-compliance decision describes a lower counter section for seated users at about 750 mm [29.5 in], with a knee recess at least 500 mm [19.7 in] deep and 700 mm [27.6 in] high. Where several similar counters are proposed, at least one should be at the lower height (snippet). — [LABSS alternative compliance decision](https://www.labss.org/sites/default/files/stas/20210319/ALTERNATIVE%20COMPLIANCE%20DECISIONS%20STAS%20Approval%20for%20SO140%20Building%20Type%20300818.pdf)

#### EU
- [STD] EN 17210:2021, *Accessibility and usability of the built environment – Functional requirements*, sets minimum functional requirements and recommendations based on Design for All and Universal Design. It was developed by CEN-CLC/JTC 11 under mandate M/420 for public procurement (snippet). — [CEN-CENELEC news, 18 Mar 2021](https://www.cencenelec.eu/news-events/news/2021/eninthespotlight/2021-03-18-en-17210-2021-accessible-and-usable-built-environment/); [EVS: EN 17210:2021](https://www.evs.ee/en/evs-en-17210-2021)
- [STD] CEN/TR 17621:2021, *Technical performance criteria and specifications*, supports EN 17210 with technical criteria and worked examples. National standards or regulations may instead set the technical criteria; CEN/TR 17622:2021 covers conformity assessment (snippet). — [EVS: CEN/TR 17621:2021](https://www.evs.ee/en/cen-tr-17621-2021); [SFS: CEN/TR 17621:2021](https://store.sfs.fi/en/centr-17621-2021)
- [PRACTICE/GUIDANCE] The Vienna tourism board's accessibility guidance suggests wheelchair-accessible tables with knee clearance of at least 60×80 cm [23.6×31.5 in] and a height of 70 cm [27.6 in]; it is unclear whether 70 cm is the top or the clearance height. It also recommends keeping 2–3 tables free of fixed seating in larger venues (snippet). — [Vienna for all: Welcome, arrival & seating](https://b2b.wien.info/en/services/vienna-for-all/food-and-beverage-restaurant-area/welcome-arrival-and-seating-1128528)

#### Fire and occupancy — US [CODE where the IBC is adopted; verify the local edition and amendments]
- **Occupant load factor:** IBC Table 1004.5 (2018–2024 editions; Table 1004.1.2 in 2012) sets "Assembly – Unconcentrated (tables and chairs): 15 net" sq ft per occupant [1.39 m²]. Concentrated chairs only is 7 net and standing space is 5 net. Net, not gross, area is used. — [iDigHardware, "Decoded: Calculating the occupant load" (Apr 2025)](https://idighardware.com/2025/04/decoded-calculating-the-occupant-load-2/); [Open Exam Prep, IBC Table 1004.5](https://open-exam-prep.com/study-guides/are-pa/ch06-egress-life-safety/occupant-load)
- The factor applies to the whole net area potentially occupied by tables and chairs, including the aisles between them. A forum post cites the 2015 IBC Commentary for this, and Bellevue, WA states the same; code officials may approve a lower occupant load if it is shown to be reasonable (snippets). — [Bellevue occupant load interpretation](https://bellevuewa.gov/sites/default/files/media/pdf_document/2021/Office%20Use%20Occupant%20Load%20Calculation.pdf); [Building Code Forum: occupant load for A-2 restaurant](https://www.thebuildingcodeforum.com/forum/goto/post?id=300580)
- **Aisle accessways at tables** (Minnesota's state rules, which adopt and amend the IBC aisle provisions; quoted text, snippet) — [Minn. R. 1305.1018 (Cornell LII)](https://www.law.cornell.edu/regulations/minnesota/Minn-R-1305-1018); [Minn. R. 7511.1018](https://www.law.cornell.edu/regulations/minnesota/Minn-R-7511-1018):
  - width is measured "to a line 19 inches (483 mm) away from and parallel to the edge of the table or counter";
  - aisle accessways not required to be accessible must give "a minimum of 12 inches (305 mm) of width, plus 0.5 inches (12.7 mm) of width for each additional one foot (305 mm), or fraction thereof, beyond 12 feet";
  - exception: "Portions of an aisle accessway having a length not exceeding six feet and used by a total of not more than four persons";
  - "The length of travel along the aisle accessway shall not exceed 30 feet (9144 mm) from any seat to the point where a person has a choice of two or more paths of egress travel to separate exits."
- The same rules contain a general aisle minimum ("not be less than 36 inches (914 mm)", or as required by occupant load). In the base IBC that wording belongs to the general aisle sections, not the assembly-aisle section, so it should be checked before being applied to an A-2 dining room. — [Minn. R. 1305.1018](https://www.law.cornell.edu/regulations/minnesota/Minn-R-1305-1018)
- **Posting:** the IBC requires the occupant load to be posted near the main exit of each assembly room or space. Virginia's version applies where the room's occupant load is 50 or more, and posting a load below the calculated figure is possible only "where approved by the building official" (snippets). — [iDigHardware, "QQ: Posted occupant load"](https://idighardware.com/2018/11/qq-posted-occupant-load); [Prince William County, VA](https://www.pwcva.gov:443/assets/2021-04/005793.pdf)
- [OPINION/PRACTICE] Servers complain that guests who push tables together on their own can block the server's path or a fire exit (snippet). — [Daily Dot](https://www.dailydot.com/irl/restaurant-customers-push-tables-together/)

#### Fire and occupancy — UK [STAT. GUIDANCE]
- Floor space factors reproduced by Northamptonshire Fire and Rescue from Approved Document B list dining room, restaurant, "lounge or bar (other than in (1) above)", meeting room and similar at 1.0 m² per person [10.8 sq ft]. Humberside Fire and Rescue's 2024 occupancy guidance gives "Dining rooms, Seated Lounge/Bar, Restaurants 1.0" m² per person (snippets). Sources disagree on the table number (D1 vs C1). — [Northamptonshire FRS: floor space factors](https://www.northantsfire.gov.uk/floor-space-factors/); [Humberside FRS Occupancy Calculations 2024](https://humbersidefire.gov.uk/uploads/images/HFRS-Occupancy-Calculations-2024.pdf)

### Inferences
- **Accessibility as layout validation.** For every alternative layout Overcooked should:
  - compute accessible seats ≥ ceil(5% × seats + standing spaces at dining surfaces). For example, a 24-seat tasting room needs at least 2, because 5% of 24 is 1.2 and the rule says "at least";
  - check dispersion across each seating type and area (main room, chef's counter, raised area, terrace, private room), which is stricter under California's "each type of seating" reading;
  - confirm each accessible seat sits on a connected route at least 36 in [915 mm] wide.

  Table templates should carry an "accessible-capable" attribute (top 28–34 in; knee clearance free of pedestals and aprons) and seats an "accessible position" flag, so that hosts can assign wheelchair users and the 5% check survives table joins.
- **Joins, raised areas and terraces.** Seasonal terraces and raised or sunken areas fall inside ADA §206.2.5 and ADM 4.14/4.16(d). A summer layout that adds a terrace must keep an accessible route and threshold to it, and its accessible seats count toward that area's dispersion.
- **Occupant load as a cap.** The system can compute the code cap as net area ÷ 15 sq ft (US) or ÷ 1.0 m² (UK) and warn when seats plus standing guests exceed it. Fine-dining density (18–20 sq ft/seat) normally leaves headroom, but standing receptions in a private room use the 5 net sq ft standing factor, so the event's occupant load jumps.
- **Assumed thresholds.** A rule pack should flag 50 occupants as the threshold for posting (confirmed in sources) and probably for a second exit (unverified, see Gaps). This is an assumption to confirm per jurisdiction.
- **Jurisdiction packs.** US rules are numeric (5%, 28–34 in, 36 in routes), while England and the EU are mostly functional (all areas reachable, a counter section at 850 mm or lower). Overcooked should model accessibility as per-jurisdiction rule packs rather than a single global rule.

### Gaps
- BS 8300-2:2018 clauses on restaurants, tables and knee recesses are paywalled and were not verified; ISO 21542:2021 and CEN/TR 17621's table and dining criteria were not seen.
- The base IBC 2021/2024 text and NFPA 101 (2024) Table 7.3.1.2 were not read directly; state adoptions and secondary sources were used instead.
- The following were reported only in search snippets of secondary or forum pages and are unverified:
  - a second exit required once the occupant load exceeds 49 (IBC 1006.2.1);
  - A-2 sprinklers required at 100 or more occupants (2012 IBC 903.2.1.2);
  - assembly rooms under 50 occupants that are accessory to another occupancy classed as Group B.
- I did not confirm whether newer editions (e.g. a 2027 IBC, a revised BS 8300 or Approved Document B) had been published by November 2026, or whether DOJ has changed the 2010 ADA Standards (none known).
- National EU fire rules for dining rooms (e.g. Germany's MVStättV, France's ERP rules) were not researched.
- Not resolved: how ADA route width is measured through a furnished dining room (to the chair backs or to the 19 in line), and whether the 5% applies separately to bar and counter seating under federal (not California) rules.

## 5. How do fine-dining rooms plan sections and stations, server and runner paths, service stations, the pass and expediting, and how do they reconfigure between lunch, dinner, private events and terraces?

### Takeaway
Fine dining uses team service. A captain (*chef de rang*) owns a small section and is responsible for orders and allergy communication, supported by front and back waiters, runners and a sommelier; sections run about 2–3 tables per server. The one-page seating chart showing stations and every table is the central planning tool. At the pass, expo reads tickets, calls fire times, checks plates, dispatches runners by table and seat, and paces tasting menus. Reservation and table-management tools model lunch, dinner and event variants as alternative layouts or table plans assigned to shifts.

### Cited Findings
- [PRACTICE] Roles: the captain is the point person for the tables in a section and communicates allergies to kitchen and bar, and front waiters support captains. — [ICE](https://www.ice.edu/blog/front-of-house-roles-in-fine-dining-explained). The back waiter or back server works under a captain on clearing, resetting, water and bread service. — [Loyalist glossary: Busser (Back Server)](https://www.eatloyalist.com/glossary/busser/). French titles are *chef de rang* for the captain and *commis de rang* for the back waiter (snippets). — [Wikipedia: Waiting staff](https://en.wikipedia.org/wiki/Waiting_staff)
- [PRACTICE/OPINION] Staffing ratios differ by source and are rules of thumb (snippets; quote-to-page mapping not verified):
  - about 1 server per 3 tables, or 1 per 2–3 tables, in fine dining, varying with layout, service model and peak hours;
  - a captain's section of roughly 15–25 guests;
  - a captain leading 3–5 servers.

  — [OysterLink, "How many tables do waiters serve at a time"](https://oysterlink.com/spotlight/how-many-tables-do-waiters-serve-at-a-time); [Loyalist glossary: Captain](https://www.eatloyalist.com/glossary/captain/)
- [PRACTICE] Stations live on the seating chart, a one-page sheet "showing server stations and every table in every room". — [St. Louis Magazine](https://www.stlmag.com/dining/ask-george:-how-do-restaurants-number-their-tables-and-why)
- [VENDOR] Wait stations: "small, 6 to 10 feet; larger, up to 40 feet" (units ambiguous). — [Restaurant-Furniture.com](https://www.restaurant-furniture.com/resources/guides/restaurant-seating-capacity-guide). Service paths: 60–62 in [1.52–1.58 m] between tables where an active service aisle runs. — [Oak Street](https://www.oakstreetmfg.com/the-ultimate-restaurant-seating-layout-guide-with-real-numbers/). Wait-staff aisles: 24–30 in [610–762 mm] (snippet). — [RFP Space Planning PDF](https://cdn.shopify.com/s/files/1/1426/5736/files/RFP-Space-Planning.pdf)
- [STD] Equipment beside the table needs floor space next to particular seats — [CMS Europe Service Standards 24.1](https://courtofmastersommeliers.org/wp-content/uploads/2024/05/Service-Standards-24.1.pdf):
  - bottle and decanter underliners go "on a side station or in a suitable space on the table";
  - ice buckets and stands are placed "close to the table";
  - wines are opened on a guéridon "next to, or close by, the table. Preferably to the host's" right;
  - for decanting, "The guéridon is placed in a position where all guests at the table can see it".
- [PRACTICE] The pass and expo: expo reads tickets, calls orders and fire times, checks plates and assembles courses for runners. — [Loyalist glossary: Expeditor](https://www.eatloyalist.com/glossary/expeditor/). In smaller fine-dining kitchens the head chef often expedites. — [Tasting Table](https://www.tastingtable.com/1910132/what-is-expo-restaurant/). Postings describe expo managing "the flow of dinner service for all tables, including private dining, ala-carte dining, and multiple-course tasting menus" (snippet). — [Hospitality Online expeditor posting](https://hospitalityonline.com/jobs/4222527-restaurant-expeditor)
- [SOFTWARE] Course firing can be automated (fire the next course when the previous one is fulfilled) or expediter-controlled; with KDS course pacing, tickets split per course (snippets). — [Toast: Automated and Expediter Course Firing](https://support.toasttab.com/en/article/Automated-and-Expediter-Course-Firing?lang=en_US); [Toast KDS course pacing](https://doc.toasttab.com/doc/platformguide/platformKDSWorkflowUsingCoursePacing.html)
- [SOFTWARE] Reconfiguration by shift (snippets):
  - Waitlist says different layouts can be saved to "adjust your sections for differing shift needs";
  - Aleno lets you assign a room or table plan to a specific shift and edit it for individual days;
  - Favourite Table documents creating floor-plan layouts;
  - SevenRooms markets "grid view shift planning";
  - OpenTable markets custom floor plans and flexible table inventory.

  — [Waitlist spatial floorplan](https://www.waitlist.me/features/spatial-floorplan); [Aleno knowledge base: rooms](https://knowledge.aleno.me/en/kb/rooms); [Favourite Table: creating floor plan layouts](https://www.favouritetable.com/help/creating-floor-plan-layouts); [SevenRooms Table Management](https://sevenrooms.com/platform/table-management/); [OpenTable restaurant solutions](https://www.opentable.ie/restaurant-solutions/?p=7700)
- [PRACTICE] Private dining is planned as discrete seating plans with fixed totals. Carnegie Hall's private dining PDF shows alternative plans of 30, 34 and 26 seats (snippet). — [Carnegie Hall dining room floor plans](https://carnegiehall.org/uploadedFiles/Resources_and_Components/PDF/Menus/May%20Dining%20Room%20Floor%20Plans.pdf)
- [STAT. GUIDANCE/CODE] Terraces and outdoor dining fall within accessibility scope: ADM 4.14 (external terraces accessible) and 4.16(d) (accessible threshold to external seating), and ADA §206.2.5 (outdoor dining areas). — [Approved Document M Vol 2](https://assets.publishing.service.gov.uk/media/60b0ea89d3bf7f43560e324a/Approved_Document_M_vol_2.pdf); [Corada: ADA §206.2.5](https://www.corada.com/documents/2010ADAStandards/206-2-5)

### Inferences
- **Sections belong to layouts.** Sections and stations should be layout-level (or shift-level) assignments of tables to a captain or team, with service stations, the pass and wine stations as fixed room objects. A lunch layout with fewer covers usually means fewer and larger sections, so sections cannot be a property of the table itself.
- **Equipment footprints.** Guéridons and ice-bucket stands occupy floor next to specific seats (CMS prefers the host's right), so a tasting-menu layout needs "service zones" beside tables that clearance checks treat as obstacles during service.
- **Pacing hierarchy.** The service board should pace at table × course and let expo hold or fire. Tasting-menu kitchens also need a room-level view across tables (expo manages "the flow of dinner service for all tables") to stagger courses between seatings and private dining.
- **Reconfiguration model.** Tools in this market keep one stable inventory of tables and apply alternative layouts or table plans per shift or day. This matches Overcooked's model of restaurant-wide tables plus alternative layouts, with private rooms and seasonal terraces as rooms or areas that are switched on in some layouts.

### Gaps
- No primary source was found on fine-dining runner-path design (e.g. one-way loops, separate in and out doors at the pass), the number of service stations per cover, or sommelier station placement.
- No operator interviews (Eater, Bon Appétit, Fine Dining Lovers) were accessed on how specific restaurants convert between lunch, dinner and events, or how they run seasonal terraces.
- Reservation-tool documentation was seen only via snippets and marketing pages. SevenRooms and OpenTable help-centre articles on per-shift layouts were not found.

## 6. How do large parties and joined tables work in practice (which tables can be joined, resulting seat numbering, minimum/maximum covers)?

### Takeaway
Joins are planned ahead. Managers predefine which tables may be combined and set a minimum and maximum cover count for each combination; reservation tools try a single table first and can keep combinations staff-only. Capacity is not simply the sum of the parts: two 4-tops pushed together usually seat 6, because the seats at the joined edges disappear. Some systems nevertheless default to summing the capacities, with a manual override. No source gives a standard for numbering seats on a joined table.

### Cited Findings
- [SOFTWARE] Combination features (snippets):
  - HostMe: set up combinations manually under the floor plan, choose the tables to join, and set a minimum and maximum covers per combination; automatic combinations pick tables for large parties, and "if there are no suitable combinations, the reservation will be declined" — [HostMe: set up table combinations](https://help.hostmeapp.com/en/articles/5677264-how-to-set-up-table-combinations)
  - Tock: smaller tables can be combined for larger parties, with party minimums and maximums and an option to make a combination in-house only — [Tock help center](https://tock.zendesk.com/hc/en-us/articles/360043858291)
  - Superb: a regular combination "uses predetermined tables that can only be used according to the pax limit set" — [Superb help center](https://helpcenter.superbexperience.com/en/articles/5778682-get-started-set-up-rooms-tables-combinations-and-your-table-plan)
  - easyTable: the system "will try to book a single table before combining tables", and a combination takes the priority of its first table — [easyTable guide](https://help.easytable.com/?p=1040)
- [SOFTWARE] Capacity rules differ (snippets):
  - Access Collins adds up the individual tables' maximums and lets staff override the total when pushed-together tables seat more or fewer;
  - Wowapps' example links two tables for four to seat a group of eight;
  - LS Retail and Webkul POS let staff join tables on request and separate them when the party leaves.

  — [Access Collins: joined tables or areas](https://help-accesscollins.theaccessgroup.com/en/articles/12042286-joined-tables-or-areas); [Wowapps: table joining options](https://support.wowapps.com/hc/en-us/articles/13711437997967-How-to-use-Table-Joining-Options); [LS Retail: joining dining tables](https://help.lsretail.com/lscentral270/Content/LS-Hospitality/Dining-Table-Management/Joining-Tables.htm); [Webkul](https://store.webkul.com/amp/product/view/id/1711/)
- [PRACTICE/geometry] A Virginia Department of Education worksheet uses pushed-together square tables where two tables seat six: seats along the joined edges are lost (snippet). — [Virginia DOE worksheet](https://doe.virginia.gov/home/showpublisheddocument/25872/638045674935200000)
- [PRACTICE] A restaurant consultant advises hosts to plan ahead which tables can be pushed together so the floor can take a big party (snippet). — [Squarespace-hosted article, "How To Successfully Manage Large Parties In Your Restaurant"](https://josh-sapienza-pkfn.squarespace.com/free-preview/2021/6/6/how-to-successfully-manage-large-parties-in-your-restaurant)
- [PRACTICE] Unplanned joins cause problems. Servers report guests pushing tables together without asking, taking a table the host had already held for a waitlisted party, and blocking the server's path or a fire exit (snippet). — [Daily Dot](https://www.dailydot.com/irl/restaurant-customers-push-tables-together/)
- [PRACTICE] For big groups, seat numbers keep orders and checks from getting tangled (snippet). — [Yahoo Lifestyle](https://www.yahoo.com/lifestyle/shouldnt-dinner-big-group-161423458.html)
- [STD] For parties of eight or more, CMS allows wine to be poured plain clockwise regardless of gender, so large joined tables change service order. — [CMS Europe Service Standards 24.1](https://courtofmastersommeliers.org/wp-content/uploads/2024/05/Service-Standards-24.1.pdf)
- [SOFTWARE] Toast allows a menu item on only one seat (snippet), which complicates family-style or shared items on large tables. — [Toast Support: Use Order by Seat](https://support.toasttab.com/en/article/Order-by-Seat?lang=en_US)

### Inferences
- **Combination as an entity.** Model a combination as a first-class object per layout, with its member tables, a minimum and maximum cover count, an allowed-in-online-booking flag, and a priority (single tables first). Seats lost at the joined edges become inactive for that combination, so capacity is not computed as a sum.
- **Numbering a joined table.** To keep numbering intuitive for runners, the combined table should get one continuous ring of positions. Apply the house rule to the combined footprint (seat 1 nearest the reference point, then the house direction), and keep a mapping from each combined position to the stable seat it occupies. Then seat-bound guest data, printed menus and kitchen tickets stay correct, and the join can be undone without losing data. Tickets should show one numbering (e.g. "T12+13 · P7") rather than mixed per-table numbers.
- **Re-validate after a join.** Joins can block service paths and fire exits, so the layout validator should re-run aisle, route and accessible-seat checks for the joined configuration. An accessible seat at a member table may lose knee clearance at a joint or table leg.
- **Party size changes service mode.** At 8 or more covers the pour order switches to plain clockwise (CMS), and large parties are more likely to have shared items. Both should follow automatically from party size or combination.

### Gaps
- No source (training text, operator interview or POS documentation) describes how fine-dining teams renumber positions when tables are joined, whether they keep per-table numbering or renumber continuously.
- No data on typical maximum table party sizes in tasting-menu restaurants, or when a party is pushed to private dining.
- Reservation-tool details came only from search snippets; the Tock, Superb, easyTable and Access Collins pages were not read in full.
