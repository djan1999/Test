# Rollbacks — NOT migrations

Scripts here undo a migration. They live outside `supabase/migrations/` on
purpose: the CLI applies everything in that folder in version order, so a
rollback filed alongside the migration it reverses gets run by the next
`supabase db push` and drops the very schema that was just created.

Run one by hand, against a named project, when you actually mean to.
