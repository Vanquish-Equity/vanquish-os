# Application CI and schema readiness

Every pull request runs `.github/workflows/app-ci.yml`: clean install, ESLint,
TypeScript, Vitest and a production Next.js build. It does not require a
Supabase credential. SQL migrations have a separate disposable Postgres job in
`.github/workflows/contextual-comments.yml`.

The schema readiness workflow compares the SQL migration filenames required
by a commit with the `name` values in the connected database's
`supabase_migrations.schema_migrations`. It runs from trusted `main` code
after successful application CI (and can be dispatched manually). It fetches
only the candidate commit's GitHub tree. No code from a PR is executed with a
database credential.

## One-time setup

Create the repository Actions secret `SUPABASE_SCHEMA_READONLY_URL` for the
database used by the preview. It must be a TLS connection URL for a database
user with only CONNECT, USAGE on `supabase_migrations` and SELECT on
`supabase_migrations.schema_migrations`. Do not use the service role key or
commit a database URL. The workflow fails clearly if the secret is missing.
Use a dedicated login role and the Supabase Session pooler host on port 5432;
the username for a custom role has the form `role.project-ref`. Replace the
`[YOUR-PASSWORD]` placeholder *including its brackets*. Percent-encode
reserved characters in a password used in a URI (or generate a long random
alphanumeric password). Include `?sslmode=require` in the URL.

The workflow keeps raw `psql` errors out of public logs because a malformed
connection URI can cause libpq to print part of the password. It reports only
the error category. If a credential ever appears in a log, rotate the affected
role's password, update this secret and delete the exposed run logs.

The first ten migrations predate recorded Supabase migration history. The
checker deliberately starts with `0011`. Migration files named with a
14-digit timestamp are recorded under their descriptive suffix because those
files were previously applied through the management API. It reports missing
migrations; it ignores extra entries such as historical backups and repair
operations. Any change to this convention requires updating the checker.

The SQL job proves that migrations apply to a clean disposable database. The
readiness job proves that the connected preview database has the required
recorded migrations. Vercel can start a preview build in parallel with these
GitHub workflows, so a red readiness result does not itself prevent a preview
from becoming available. Before treating a preview as ready for review, check
both CI and schema readiness. A hard pre-deploy gate would additionally need
the preview hosting pipeline to wait for the schema check.
