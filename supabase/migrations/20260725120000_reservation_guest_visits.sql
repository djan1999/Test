-- Loop 2 — Service → guest history.
--
-- reservation_guests already counted visits, but held nothing about them. The
-- Guests tab and GuestMemory are written to show what a returning guest was
-- actually served, and that detail only exists in the service archive.
--
-- One jsonb array per guest, one entry per (party, service instance). The
-- writer is idempotent on `visitId`, so re-archiving a service replaces its own
-- entry instead of adding a second dinner nobody ate.

alter table public.reservation_guests
  add column if not exists visits jsonb not null default '[]'::jsonb;

comment on column public.reservation_guests.visits is
  'Visit summaries folded in from the service archive after a service ends. '
  'Each entry carries a visitId of "<serviceInstanceId>|<party>"; the writer '
  'replaces by that id rather than appending, so a re-archive is a no-op.';

-- visit_count has been maintained by hand on every booking write. Once visits
-- are recorded it is simply their length, and a backfill keeps the two honest
-- for rows written before this migration.
update public.reservation_guests
   set visit_count = greatest(visit_count, jsonb_array_length(visits))
 where jsonb_array_length(visits) > visit_count;
