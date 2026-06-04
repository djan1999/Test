# Milka Service Board

## What changed
Menu data is now managed directly inside the app via the Admin panel.
Google Sheets is no longer used as a data source for menu courses.
Each restaurant table syncs separately through `public.service_tables`.

## Required Supabase setup
1. Open Supabase SQL editor.
2. Run `schema.sql`.
3. Put your Supabase URL and anon key into `.env`.
4. Start the app with `npm install` and `npm run dev`.

## Notes
- Menu courses are edited and saved directly via Admin > Menu Layout.
- Wines and beverages sync nightly from the hotel website (or manually via Admin > Sync).
- Drinks (cocktails, spirits, beers) can also be edited manually in Admin > Drinks.
