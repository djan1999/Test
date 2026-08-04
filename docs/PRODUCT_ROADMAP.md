# Product Roadmap — Service Board for Tasting‑Menu Restaurants

> Status: draft for review. Target market (decided): **fine‑dining / degustation
> venues and hotel restaurants** — tasting menus, wine pairings, seat‑level
> dietary handling, kitchen fire board. We are **not** generalizing to à‑la‑carte
> / POS. That decision keeps the work to "wrap the existing app as a product"
> rather than a rewrite.

## Pilot-hardening update (04.08.2026)

The controlled-pilot foundation is now implemented on the readiness branch:
neutral runtime restaurant identity and PWA metadata, opt-in catalogue sync,
hotel fields behind workspace configuration, action-specific RLS roles, a
tenant composite FK, PowerSync ownership/queue diagnostics, an idempotent
operator onboarding command, local query indexes, and Admin workspace
export/exact-name guest erasure.

This does **not** make the product self-serve or automatically launch-ready.
Billing, setup wizard, broader localization, legal terms/DPAs, approved
retention periods, proven backup restoration, real-Postgres policy execution,
and physical tablet drills remain open. `PILOT_ROLLOUT.md` is the authoritative
gate; the phases below remain the longer-term product roadmap.

## Where we already are (the good news)

The hard multi‑tenant plumbing exists and looks solid:

- Workspaces, explicit `workspace_members`, and per-tenant **RLS** with a
  security-definer helper in a `private` schema (`schema.sql`). Demo is a
  separate sandbox membership, not a master account.
- `scopedFrom()` scopes every read/write; realtime is workspace‑filtered; the
  offline queue stamps the workspace.
- PowerSync is on app‑wide with per‑workspace sync rules (durable, offline,
  isolated), Supabase realtime as a safety net.
- Bilingual EN/SI, logo per workspace, archive/insights, kitchen board.

What's missing is everything that turns *"the app Milka uses"* into *"a product a
stranger can sign up for and pay for, safely."*

## Effort key

Rough estimates for **one experienced full‑stack dev**. S ≈ ≤3 days,
M ≈ ~1 week, L ≈ 2–3 weeks. Legal items need a lawyer, not just dev time.

---

## Phase 0 — De‑Milka‑ify (foundation; everything depends on this)

The app hardcodes one restaurant in several places. Until these are per‑tenant,
a second customer gets Milka's data and branding.

| # | Task | Where | Effort |
|---|------|-------|--------|
| 0.1 | **Pilot baseline complete; product identity still needs approval.** Neutral shell fallbacks and one generated PWA manifest are in place; restaurant name/subtitle/logo are workspace data. Final product name/colors remain a commercial design decision. | `env.example`, `vite.config.js`, `index.html`, `src/config/product.js` | S remaining |
| 0.2 | **Pilot safety complete; generic import remains later.** Manual catalogues are the default and automation is disabled unless an operator assigns a provider. The Milka scrape remains an explicit Milka-only integration; CSV import is still a product enhancement. | `api/sync-wines.js`, `src/components/admin/DrinksPanel.jsx` | M remaining |
| 0.3 | **Neutral menu defaults.** "Rebuild from courses" now bakes in Milka's layout incl. Milka pairing flags (`crayfish`, `n_a_champagne`, `beer`) in `buildDefaultLong/ShortMenuTemplate`. Make the default a neutral N‑course skeleton (or a setup wizard that asks course count), with Milka's as a selectable template. | `src/utils/menuTemplateSchema.js` | M |
| 0.4 | **Configurable floor plan.** DB hard‑caps tables: `service_tables.table_id CHECK (1..10)`. Make the table set per‑workspace (count + names/zones) stored in workspace settings; relax/replace the constraint. | `schema.sql`, board init in `src/App.jsx` | M |
| 0.5 | **PowerSync instance config.** URL is baked in `config.js`. Confirm one shared instance is acceptable for early tenants (it is — sync rules isolate per workspace) and document capacity triggers for a second instance. | `src/powersync/config.js` | S |

**Exit criteria:** spin up a brand‑new workspace and it shows *its* name, *its*
(empty/imported) wine list, a neutral starter menu, and its own table count — no
Milka strings anywhere.

---

## Phase 1 — Self‑serve onboarding (first "a stranger can become a customer")

Today onboarding is manual SQL (create workspace row → create Auth user → insert
membership). Nobody can self‑serve.

| # | Task | Notes | Effort |
|---|------|-------|--------|
| 1.1 | **Signup + email verification** | Supabase Auth signup UI; verified email required before workspace creation. | M |
| 1.2 | **Secure "create your restaurant" flow** | RLS blocks self‑inserting a workspace + owner membership. Add a **Supabase Edge Function / serverless endpoint (service role)** that validates the authenticated user, creates the workspace, and adds them as `owner`. This is the key technical piece. | M |
| 1.3 | **Setup wizard** | First login → restaurant name, logo, table count, course count → seeds a neutral menu skeleton + sample data toggle. Reuse the `sandbox` workspace kind for trials. | M |
| 1.4 | **Empty‑state guidance** | Checklist + tooltips so a blank board doesn't cause instant churn. | S |

**Exit criteria:** a new user signs up, verifies email, creates a restaurant, and
runs a service — with zero manual SQL from us.

---

## Phase 2 — Billing (turn usage into revenue)

Pointless before Phase 1 exists; straightforward after.

| # | Task | Notes | Effort |
|---|------|-------|--------|
| 2.1 | **Stripe Checkout + Customer Portal** | Plans (e.g. per‑restaurant monthly), free trial. | M |
| 2.2 | **Subscription state on workspace** | Add `stripe_customer_id`, `plan`, `status`, `trial_ends_at` to `workspaces`; **Stripe webhook** keeps them current. | M |
| 2.3 | **Access gating** | Block/limit the app on `past_due` / `canceled` / expired trial, with a clear in‑app upsell. | S |

**Exit criteria:** a customer subscribes, gets access; lapse → graceful lockout.

---

## Phase 3 — Security & GDPR (must land before real customer data does)

You store **guest allergy/dietary data tied to named reservations** (plus Guest
Memory history). Under EU/GDPR that's **special‑category (Art. 9) health data** —
this is sharper than typical SaaS compliance. Supabase is already EU (`eu‑central‑1`), which helps.

| # | Task | Notes | Effort |
|---|------|-------|--------|
| 3.1 | **Formal security review** | Run `/security-review`; audit RLS on every table for cross‑tenant leaks. | M |
| 3.2 | **Remove client‑exposed secrets — COMPLETE** | Manual catalog sync now verifies the signed-in owner server-side; cron secrets never enter the browser bundle. | S |
| 3.3 | **Legal docs** | Privacy Policy, Terms, and a **DPA** (you're a *processor*; the restaurant is *controller*). Needs a lawyer. | M (+legal) |
| 3.4 | **Data lifecycle** | Admin workspace export and exact-name guest erasure are implemented for the pilot. Controller-approved retention periods, scheduled lifecycle, broader request workflow, and breach process remain. | M |
| 3.5 | **Backups** | Supabase PITR (paid tier) + a tested restore runbook. | S |

**Exit criteria:** RLS audited clean, no secrets in the bundle, legal pages live,
data export/delete works, backups verified.

---

## Phase 4 — Team & account management (self‑serve, no more SQL)

| # | Task | Notes | Effort |
|---|------|-------|--------|
| 4.1 | **Invite / remove staff** | Email invite → accept → membership; remove member; transfer ownership. | M |
| 4.2 | **Password reset UI** | Wire Supabase reset flow. | S |
| 4.3 | **Roles → permissions — pilot complete** | `admin`, `service`, and `kitchen` are enforced in UI and Postgres RLS; executable pgTAP coverage is included. Future products may add manager/owner variants. | S future |

---

## Phase 5 — Ops, observability, support (run it like a service)

| # | Task | Notes | Effort |
|---|------|-------|--------|
| 5.1 | **Error tracking** | Sentry (frontend + serverless); you have `ErrorBoundary` as a start. | S |
| 5.2 | **Uptime + status page** | Monitoring + public status. | S |
| 5.3 | **Audit log** | Record admin actions (menu edits, member changes) per workspace. | M |
| 5.4 | **Support** | Help docs + support inbox; in‑app changelog. | S→ongoing |

---

## Phase 6 — Go‑to‑market & polish

- Marketing site + pricing page.
- Trial/demo via the existing `sandbox` workspace kind, pre‑seeded.
- Owner analytics (covers, popular pairings) — you already have `ServiceBreakdown` + archive insights to build on.
- Language expansion beyond EN/SI as markets require.

---

## Suggested sequence & "minimum sellable"

```
Phase 0 ─► Phase 1 ─► Phase 2 ─► (first paying customer)
              └─► Phase 3 runs in parallel from the start (legal has lead time)
Phases 4–6 follow / overlap once the core loop sells.
```

**Minimum sellable product (MSP)** = Phase 0 + Phase 1 + Phase 2 + the legal/
security essentials of Phase 3 (3.1, 3.2, 3.3, 3.5) + basic ops (5.1, 5.2).

**Rough timeline:** ~**3–4 months solo** to MSP, faster with help. Caveats: the
wine‑import rework (0.2) and onboarding (1.1–1.3) are the biggest single chunks;
legal (3.3) is calendar‑bound on an external lawyer, so start it early.

## De‑Milka hardcoding checklist (quick reference)

- [x] `api/sync-wines.js` — Milka source is opt-in and cron-only; new tenants are inert
- [x] `src/utils/menuTemplateSchema.js` — new/rebuilt defaults contain no Milka pairing flags
- [ ] `src/powersync/config.js` — baked instance URL (acceptable, document it)
- [x] `env.example` — neutral app defaults; hotel fields off unless configured
- [x] `vite.config.js`, `index.html` — single neutral generated manifest and shell title
- [ ] `schema.sql` — `service_tables.table_id` 1..10 constraint
- [x] `README.md` — controlled onboarding command and pilot gate documented
