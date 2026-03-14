# Milka Service Board

## What changed
This version stops using one shared `board_state` blob for all reservations.
It now syncs each restaurant table separately through `public.service_tables`.
That prevents one device from overwriting the whole board when another device edits a different table.

## Required Supabase setup
1. Open Supabase SQL editor.
2. Run `supabase/schema.sql`.
3. Put your Supabase URL and anon key into `.env`.
4. Start the app with `npm install` and `npm run dev`.

## Notes
- Live menu data still comes from your Google Sheet.
- Wines and beverages still use their existing Supabase tables.
- Old `board_state` data is ignored by this build.
