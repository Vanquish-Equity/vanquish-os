# Vanquish OS — M1 (Core CRM + Pipeline)

Vanquish's internal deal-flow operating system. This is the first vertical
slice: a company enters, becomes a deal, moves through the pipeline with
real status history, and the team can see it — no spreadsheet.

Stack: Next.js 16 (App Router) + Supabase (Postgres, Auth) + Tailwind v4.

## 1. Push this to GitHub

The git history is already committed and `origin` already points at
`github.com/Vanquish-Equity/vanquish-os`. From this folder:

```bash
git push -u origin main
```

## 2. Set up Supabase

In your Supabase project's SQL Editor, run the two migration files **in order**:

1. `supabase/migrations/0001_core_schema.sql` — creates all tables, the
   pipeline stages/priorities taxonomies, RLS policies and the trigger that
   automatically logs every stage change into `deal_status_history`.
2. `supabase/migrations/0002_seed_tracker.sql` — the real 123 rows from
   `Company_Tracker.xlsx`, migrated into 106 companies + 123 deals with
   seeded status history. (Regenerate it any time with
   `python3 scripts/generate_seed.py` if the source tracker changes.)

Then go to **Authentication → Providers** and make sure Email (magic link)
is enabled — that's how Scott, Francis, Pedro and you sign in. No signup
form; anyone with a `@vanquish` (or whichever domain you want) email can
request a link. Add an allow-list later if you want to lock that down.

## 3. Environment variables

Copy `.env.local.example` to `.env.local` and fill in your project's
**Project URL** and **anon public key** (Project Settings → API — both are
safe to expose client-side, that's what "anon public" means).

```bash
cp .env.local.example .env.local
```

## 4. Run it

```bash
npm install
npm run dev
```

Open http://localhost:3000 — it redirects to `/login`, sends a magic link,
then drops you into `/pipeline`.

## 5. Deploy

Once it's on GitHub, tell Claude (or go to vercel.com/new) to import the
repo — the Vercel account is already connected. Set the same two env vars
there before the first deploy.

## What's here vs. what's next

This is Milestone 1 from the Technical Blueprint: Companies, Deals, People,
activity history, real auth. It deliberately does **not** include Gmail
sync, document governance, chat, comments or the Review Queue — those are
milestones 2+, and they get built on top of this same schema rather than
a rewrite. See `supabase/migrations/0001_core_schema.sql` for the full
data model and its comments.
