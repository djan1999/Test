# Digestivo-related service fixes — 18 September 2026

Base: origin/main at f507d39, merge #226. Branch: codex/digestivo-review-fixes.

The original local review was based on stale history at #215. Refreshing origin revealed the digestivo changes through #226. The reported apéritif incident matches the repaired `catalogs` scope error: clicking an empty-seat shortcut threw in its event handler, and reopening quick access with a recorded apéritif threw while determining the active button. That repair is retained and its tests pass.

## Changes

- Regrouping moves the canonical party intact, preserving empty seats, sparse guest IDs, digestivos, dietary positions, sharing references, floor assignments and kitchen snapshots. It no longer persists the lossy display projection. Multiple live owners are refused before the reservation write, since their guest identities cannot safely be inferred. Join/split feedback shows the refusal rather than claiming success.
- Kitchen extra alerts carry an explicit seat-assignment warning for unassigned or orphaned dietary restrictions. The warning includes configured dish modifications, appears once per dish, participates in send deltas, and clears when the restriction is assigned. It does not claim that every seat has the allergy. Digestivos still remain on the kitchen ticket without generating their own popup.
- Both apéritif and digestivo quick search preserve bottle semantics: bottles append to the table's bottleWines list; individual drinks keep their existing per-seat destination.

No schema migration or catalogue data rewrite is required. No live data or deployment was changed. Existing changes in the original checkout are untouched.

## Validation

- Full test suite: 118 files, 1,751 tests passed.
- Two further regression tests were then added; their two affected files passed all 95 tests. Total covered tests after these additions: 1,753.
- Production build passed, including PWA generation. Existing warnings concern the mixed static/dynamic archiveStore import and stale Browserslist data.
- New coverage includes split/rejoin with blank and sparse seats, conflicting live owners, unassigned and orphaned allergies through alert rendering, assignment after sending, bottle destinations in both phases, refused-split feedback, and details → JSON round trip → quick access with both an apéritif and digestivo already recorded.
- Existing digestivo tests cover category/subcategory selection, product resolution, tea/coffee support, guest menu versus kitchen naming, ticket placement, quantities and BTG/BTB behavior. These were included in the full passing suite.
- No browser or live-service deployment verification was performed.

The next maintenance improvement is consolidating duplicate optional-extra builders, but that refactor is not necessary for these fixes and was left out of this patch.
