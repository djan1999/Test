-- ── The digestivo service joins the kitchen ticket ──────────────────────────
--
-- A digestivo is ordered like an aperitif (a quick-access button on the seat,
-- backed by a linked catalogue product) but it is SERVED inside the menu, not
-- before it. Until now the kitchen heard nothing about it: service poured a
-- coffee or a grappa and the pass found out when the next course was already
-- plated.
--
-- `digestivo_before` marks the course the digestivo goes out AHEAD of. Admin
-- ticks it on, say, the Buchtel row; every ticket for a table whose guests
-- ordered a digestivo then prints a DIGESTIVO service line directly above
-- that course, in the order the room will actually run it.
--
-- Opt-in and default false, like optional_pairing_enabled: a course that has
-- never said anything about digestivos is not asking to anchor one, and an
-- existing deployment gains no ticket lines from applying this migration.

alter table public.menu_courses
  add column if not exists digestivo_before boolean not null default false;
