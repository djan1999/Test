# Reservations Lab isolation

The reservation redesign is developed on `codex/reservations-v2`. It must never
use the restaurant production database or PowerSync instance.

## Deployment boundary

- Production: Vercel project `test`, Git branch `main`, production Supabase.
- Lab: a separate Vercel project, Git branch `codex/reservations-v2`, an isolated
  Supabase branch/project, and PowerSync disabled until an isolated instance exists.
- The lab must not be promoted or aliased to `project-sis.com`.

## Required Vercel variables

Copy the names from `.env.staging.example` into the lab project's environment
settings. Use branch-specific Supabase credentials. Staging fails closed before
login if its URL resolves to the known production Supabase project or its
PowerSync URL resolves to the known production instance.

Vercel preview deployments are treated as staging automatically. A new preview
therefore renders only the blocking screen until the acknowledgement and
isolated backend variables are explicitly present.

## Side effects

Do not configure production SMS, email, payment, cron, or service-role secrets.
Use fictional guest data. The lab watermark must be visible throughout testing.

## Release rule

Keep the pull request in draft. No reservation-v2 code or migrations reach
`main` until the restaurant has completed an explicit staged rollout review.
