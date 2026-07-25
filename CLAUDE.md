# Milka — working notes for Claude Code

A service board for a restaurant. It runs on tablets on the floor and at the
pass, during dinner, sometimes offline. That sentence is the reason for most of
the rules below: a mistake here is not a bad deploy, it is a waiter standing in
front of a guest with the wrong information.

## Commands

```
npm run dev              # local
npm run test:run         # the whole suite — must pass, ~1170 checks
npm run build            # must be clean
npm run check            # both of the above; run before saying you are done
npm run sync:edge-domain # after ANY change under src/domain/reservations/
```

Tests live in `src/__tests__/`, `src/domain/reservations/__tests__/` and
`api/__tests__/` — vitest is configured to look nowhere else, so a test file
put anywhere else silently never runs.

## Visual system

`src/styles/tokens.js` is the single source of truth for colour, type and
spacing. **If you catch yourself typing `#` outside that file, stop.** The same
goes for a raw `px` font size or a one-off letter-spacing: the scale is in the
file.

The grammar, stated plainly so it can be matched without guessing:

- **Documentation, not dashboard.** Warm off-white paper (`ink.bg`), hairline
  rules (`ink[4]`), generous negative space. No shadows, no gradients, no
  rounded corners — `tokens.radius` is `0` and stays `0`.
- **Roboto Mono throughout** (`tokens.font`). Uppercase, letter-spaced labels
  for metadata; sentence case for anything a guest's name or note appears in.
- **Colour communicates state and nothing else.** Gold (`signal.active`) is
  in-progress, red (`signal.alert`) is an allergen or a stop, green
  (`green.text`) is confirmed or done, parchment (`tint.parchment`) is
  historical. A colour used decoratively steals meaning from the same colour
  used as a signal, on a screen someone reads at a glance across a room.
- **Square-bracket notation** for restrictions on any operational surface:
  `[GLUTEN]`, `[NUT]`. It survives a bad printer and a dim room.

Two colour scales coexist. **`ink` + `signal` is the current direction**;
`neutral` / `charcoal` predate it and are kept so old imports keep working.
Write new work against `ink` and `signal`. The `colors` block at the bottom of
the file is legacy aliasing — never add to it.

## The Service Boundary Contract

Reservations and live Service are two systems that must not reach into each
other. The board is Service's from the moment a party is seated.

- Reservation code never writes `service_tables`, `service_settings`, floor
  maps, courses, the KDS, the service clock, or PowerSync sync rules.
- Reservation code never writes the live-service fields on a reservation row:
  `visit_state`, `terrace_table`, `terrace_map_id`, `moved_at`,
  `clearedFromBoard`.
- Service reads reservations. It does not write them back.

The three connections between them are deliberate, one-directional, and each
sits behind its own flag — see `docs/RESERVATIONS_IMPLEMENTATION.md`.

## One copy of every rule

Availability, payload limits and the booking lifecycle live in
`src/domain/reservations/` and are used by the app, the Vercel routes under
`api/resv/`, and the Supabase edge function.

The edge function cannot import from `../../src`, so those modules are **copied**
into `supabase/functions/_shared/reservations/` by `npm run sync:edge-domain`.
Change a rule, run the sync, commit the copies. A test fails if you forget.

Never hand-edit the copies, and never write a second implementation of a rule
inside the edge function. That is exactly how the edge availability engine came
to read a joined party as holding only its first table — handing the second to
the next booking, on a night the staff workspace would have refused.

## New work ships dark

Anything new goes behind a `VITE_*` flag that defaults to `false`, documented in
`env.example`, and the surface it replaces stays in the codebase until the new
one has survived real service. On a system that runs during dinner, the ability
to switch something off in seconds is worth more than the elegance of having
deleted the old path.

Flags are independent. One being on never implies or requires another.

## Things that have gone wrong before

Read these as fixed constraints, not history:

- **The board reconcile can wipe a live service.** Anything that makes the
  board↔reservations reconcile see a change that did not happen is dangerous.
  Return the caller's own array by reference when nothing moved.
- **A mass blank of started tables is refused**, deliberately, by a guard in
  `App.jsx`. If you trip it, the fix is upstream, not the guard.
- **Availability answers with a reason, never a bare boolean.** Every "no" has
  wording a host can repeat to a guest on the telephone.
- **Cancel and no-show require a reason**, and the lifecycle is enforced on the
  write path — not only in the UI, and not only in one of two write paths.
- **Guest-supplied text is bounded** (`src/domain/reservations/validation.js`).
  `/book` and the waitlist are unauthenticated.

## Branch discipline

Reservation work lives on `codex/reservations-v2`. Do not merge it to `main`
and do not modify live Service behaviour from it beyond what the flags gate.
Branch before committing if you are on the default branch.

## Writing

Comments explain **why**, in the restaurant's language, and are worth the space
when the reason is not obvious from the code — most of this codebase is written
that way and new work should match. Name things as the floor names them: a
party, a cover, a seating, the pass. Never write a comment that restates the
line below it.

When something cannot be verified — no Supabase, no browser, no live service —
say so plainly rather than implying it was tested.
