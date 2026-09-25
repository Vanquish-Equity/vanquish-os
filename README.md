# Vanquish OS - M1 Core CRM, Pipeline and Portfolio Foundation

Vanquish's internal deal-flow operating system. A company persists as a durable
identity; each investment round is its own deal; stage history, activity,
documents, tasks and portfolio legal structure build on that source of truth.

Stack: Next.js 16 App Router, Supabase Postgres/Auth/Storage and Tailwind v4.

## 1. GitHub

`origin` points at `github.com/Vanquish-Equity/vanquish-os`.

```bash
git push -u origin main
```

## 2. Supabase Migrations

Run the migration files in order in the Supabase SQL Editor:

1. `0001_core_schema.sql` - core CRM, companies, deals, pipeline, people,
   tasks, interactions, activity and stage-change trigger.
2. `0002_seed_tracker.sql` - 123 tracker rows as 106 companies and 123 deals.
3. `0003` through `0007` - temporary anon write policies, document uploads,
   company trash, tasks and people writes.
4. `0008_taxonomy_activity_closeout.sql` - outcome and relationship
   taxonomies, tracker-fidelity columns, review queue, archive fields and
   append-only status history.
5. `0009_document_governance.sql` - document categories, types, templates,
   requirements and document metadata.
6. `0010_portfolio_vehicles.sql` - legal vehicles, investors, investments,
   positions and capital events.
7. `0011` and `0012` - tracker date corrections and performance indexes.
8. `0013_review_resolution_and_document_consistency.sql` - atomic duplicate
   decisions and checklist updates when linked documents are archived.
9. `0014_deal_rounds.sql` - configurable round list used by the Round
   selector on deals (`deals.round` stores the chosen name).
10. `0015_auth_members_and_rls.sql` - authorized members, explicit
    Portfolio / Documents permissions, member-scoped RLS for every table and
    the documents bucket, and removal of all anonymous access.

Sign-in (Google, email link) and member-scoped RLS are enforced from `0015`
on; the temporary anon policies of `0003`-`0014` are dropped there. See
[`docs/authentication.md`](docs/authentication.md) for the member list,
permissions, required Google Cloud / Supabase / Vercel settings and the
activation order.

## 3. Environment Variables

Copy `.env.local.example` to `.env.local` and fill in your Supabase project URL
and anon public key.

```bash
cp .env.local.example .env.local
```

## 4. Private Seeds

Private audit CSVs must live in `data/private/`, which is gitignored. Generated
SQL under `supabase/private_seed/` is also gitignored.

Never commit investor ledgers, audit CSVs, private Drive links, or SQL generated
from those files.

Expected private files:

- `Company_Tracker_2025.csv`
- `audit_investment_register.csv`
- `audit_investor_relationships.csv`
- `audit_document_checklist.csv`
- `audit_findings.csv`

Generate local SQL:

```bash
python scripts/generate_tracker_backfill.py
python scripts/generate_portfolio_seed.py
```

Apply the generated SQL manually, in order:

1. `supabase/private_seed/tracker_backfill.sql`
2. `supabase/private_seed/portfolio_seed.sql`

The scripts update `docs/migration-report.md` with non-confidential counts.

## 5. Run

```bash
npm install
npm run dev
```

Open http://localhost:3000 and sign in. Add
`http://localhost:3000/auth/callback**` to the Supabase Redirect URLs, and use
an email listed in `app_members`.

## 6. Verify

```bash
npm run lint
npm test
npm run build
```

For database verification, run `0001` through latest against a fresh local
Supabase project, then run `supabase/tests/access_control.sql` (never against
production). If the Supabase CLI is unavailable, use a local Postgres
database with minimal `auth.role()` and `storage` schema stubs, then re-run the
new migrations a second time to confirm they are re-runnable.

## 7. Deploy

Import the GitHub repo into Vercel and set the same Supabase env vars before the
first deploy.

Vercel functions are pinned to `pdx1` in `vercel.json` to stay close to the
Supabase project in `us-west-2`. Keep those regions aligned when moving either
service; cross-region database round trips make every dashboard navigation feel
slower.

## Confidentiality Rule

Portfolio pages are internal. SPV ledgers, cap tables and investor positions
must never be exposed to investors. A future investor portal may only show the
current investor's own positions and Investor -> SPV documents.
