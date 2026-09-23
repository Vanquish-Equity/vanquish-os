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

The auth gate is intentionally still disabled for now. The temporary anon
policies are marked in the migrations and should be removed once sign-in and
roles are wired up.

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

Open http://localhost:3000. With auth temporarily disabled, the dashboard is
available without enforcing login.

## 6. Verify

```bash
npm run lint
npm test
npm run build
```

For database verification, run `0001` through latest against a fresh local
Supabase project. If the Supabase CLI is unavailable, use a local Postgres
database with minimal `auth.role()` and `storage` schema stubs, then re-run the
new migrations a second time to confirm they are re-runnable.

## 7. Deploy

Import the GitHub repo into Vercel and set the same Supabase env vars before the
first deploy.

## Confidentiality Rule

Portfolio pages are internal. SPV ledgers, cap tables and investor positions
must never be exposed to investors. A future investor portal may only show the
current investor's own positions and Investor -> SPV documents.
