-- ── Trim the realtime publication to tables something actually listens to ────
--
-- The app subscribes to realtime on: service_tables, reservations, services,
-- service_settings, beverages, wines, menu_courses. Nothing subscribes to
-- service_events (the logbook is append-only via REST and read back via REST;
-- Phase 4 down-sync was cancelled 12.08) or service_archive (archive reads
-- are on-demand). Yet both sat in the supabase_realtime publication, so the
-- realtime decoder chewed through every logbook fact — the highest-frequency
-- write stream during service — for zero subscribers, on the smallest
-- compute tier. Measured context (13.08): sustained ~69% compute baseline
-- since the logbook shipped, and a mid-day instance freeze.
--
-- The powersync publication is deliberately untouched: its deployed sync
-- streams require their source tables present, and the (auto_subscribe:
-- false) service_events stream can only be retired together with a
-- sync-rules deploy in the PowerSync dashboard.
--
-- Reversible any time with: alter publication supabase_realtime add table …
alter publication supabase_realtime drop table public.service_events;
alter publication supabase_realtime drop table public.service_archive;
