<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Vanquish OS project guide

Read this file and the relevant page in [`docs/README.md`](docs/README.md)
before changing code. Keep the documentation and tests in the same change when
the product contract, permissions, or migration behavior changes. `CLAUDE.md`
points here so both entry points use one set of project instructions.

## Product and code map

- Company is a durable identity; a Deal is a separate investment opportunity
  or round. The Investment Pipeline edits `deals.stage_id` and records stage
  history. A custom board has its own lists and cards; moving a linked Deal
  there must not change its investment stage. See
  [`docs/crm-workspace.md`](docs/crm-workspace.md).
- `src/app/(dashboard)` contains server-rendered routes, `src/components`
  contains client UI, `src/lib` contains server actions, queries and domain
  logic, `supabase/migrations` contains schema changes, and `supabase/tests`
  contains database access and behavior checks.
- Members and permissions are enforced in the dashboard and by Postgres RLS.
  Never substitute a hidden UI control for a permission check. Portfolio and
  Documents have additional restrictions; investor positions and private
  files must stay internal. See [`docs/authentication.md`](docs/authentication.md).

## Change workflow

1. Start from current `main` on a focused branch. Read the affected feature
   document and the existing query/action and migration before editing.
2. Reuse `SelectMenu`, `Checkbox`, and the `vq-card` / `vq-card-static` styles
   where they fit. Check keyboard, touch and narrow layouts for board changes.
   Record known design exceptions in [`docs/design-system.md`](docs/design-system.md).
3. For a database change, add a migration and a meaningful SQL test; preserve
   existing data and RLS. Follow the repository's migration naming convention
   and verify against a disposable database. Never apply test scripts to the
   preview or production database.
4. Run `npm run lint`, `npx tsc --noEmit`, `npm test`, and `npm run build` for
   application changes. CI runs them on PRs. Check schema readiness after CI
   before treating a preview as ready; it currently detects drift but does not
   block a Vercel deployment. See [`docs/ci-and-schema.md`](docs/ci-and-schema.md).

Do not commit `.env*` secrets, investor ledgers, private CSVs, private Drive
links or generated private seed SQL. Never print database connection strings
or raw connection errors in public CI logs.
