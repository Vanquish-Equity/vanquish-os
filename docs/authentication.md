# Authentication and access control

Vanquish OS requires a Supabase Auth session **and** an active row in
`public.app_members` for the account's email. Portfolio and Documents also
require an explicit row in `public.member_permissions`. Signing in with
Google, receiving an email link, or having an `@vanquishequity.com` address
does **not** grant access by itself.

## How it is enforced

| Layer | What it does |
| --- | --- |
| `src/proxy.ts` → `src/lib/supabase/middleware.ts` | Verifies the session (`getClaims`) on every request. No session → `/login?next=…` (GET) or `401` (server actions and other non-GET calls). Only `/login` and `/auth/*` are public. |
| `src/app/(dashboard)/layout.tsx` | `requireMember()`: non-members go to `/access-denied`, which names the signed-in account and offers sign out. |
| Pages | Portfolio pages render “You do not have access to Portfolio” without the `portfolio` permission. Company and deal pages do not query or render documents, diligence checklists or investments without the matching permission. The sidebar hides Portfolio. |
| Server actions | Document, checklist and portfolio actions return an error without the permission (`actionAccessError`). |
| Database (migration `0015`) | Every policy on `public` tables was replaced. `anon` has no table privileges. Members read and write CRM tables; `documents`, `document_requirements`, document and portfolio activity, and all portfolio tables require the permission. Members can read only their own membership rows and cannot write them. |
| Storage | The private `documents` bucket follows the `documents` permission for select (download / signed URLs), insert, update and delete. |

Helper functions live in the `private` schema, which the Data API does not
expose. They are `SECURITY DEFINER` with an empty `search_path` and only
answer for the calling user, so policies never query `app_members` under
RLS (no recursion).

Audit fields (`activity_events.actor`, `deal_status_history.changed_by`)
come from the verified JWT email, not from the client.

### What counts as Portfolio and Documents

- **Portfolio**: `legal_entities`, `legal_entity_aliases`, `investors`,
  `investor_aliases`, `investments`, `investment_vehicles`,
  `investor_positions` and `capital_events`, plus portfolio activity.
- **Documents**: `documents`, the `documents` Storage bucket,
  `document_requirements` (including deal due-diligence checklists, which
  hold file names and links) and document activity.
- SPV and investor checklists, and documents linked to a vehicle,
  investment or investor, require **both** permissions.

## Managing members (Supabase → SQL Editor or Table Editor)

```sql
-- Authorize a member (no Portfolio or Documents by default)
insert into public.app_members (email, display_name)
values ('pedro@vanquishequity.com', 'Pedro');

-- Grant an area explicitly
insert into public.member_permissions (email, permission)
values ('pedro@vanquishequity.com', 'portfolio');   -- or 'documents'

-- Remove an area
delete from public.member_permissions
where email = 'pedro@vanquishequity.com' and permission = 'portfolio';

-- Suspend a member without deleting the row
update public.app_members set is_active = false
where email = 'pedro@vanquishequity.com';
```

Emails are stored in lowercase. Migration `0015` authorizes
`marios@vanquishequity.com` with both permissions.

## The two URLs (do not mix them up)

| URL | Where it is registered |
| --- | --- |
| `https://<project-ref>.supabase.co/auth/v1/callback` | **Google Cloud** → OAuth client → *Authorized redirect URIs*. Google returns to Supabase here. |
| `https://<production-domain>/auth/callback` (and the preview / local variants below) | **Supabase** → Authentication → URL Configuration → *Redirect URLs*. Supabase returns to Vanquish OS here. |

`/auth/callback` only redirects to same-site paths from `next`; external or
malformed values fall back to `/overview`.

## Setup steps

### Google Cloud (existing project)

1. APIs & Services → OAuth consent screen: user type **Internal** if
   `vanquishequity.com` is a Google Workspace domain (optional extra layer;
   the member list is still required). Scopes: `openid`, `email`, `profile`.
2. Credentials → Create OAuth client ID → *Web application*.
3. Authorized redirect URIs: `https://<project-ref>.supabase.co/auth/v1/callback`.
   No JavaScript origins are needed.
4. Keep the Client ID and Secret for Supabase. Do not put them in the repo
   or in Vercel.

### Supabase

1. Authentication → Sign In / Providers → **Google**: enable it and paste
   the Client ID and Secret.
2. Authentication → URL Configuration:
   - Site URL: `https://<production-domain>`
   - Redirect URLs:
     - `https://<production-domain>/auth/callback**`
     - `https://*-<vercel-team-slug>.vercel.app/auth/callback**` (previews)
     - `http://localhost:3000/auth/callback**` (local development)
3. Email provider: leave enabled if the email link is used (Pedro, until
   Microsoft is added). Configure custom SMTP; the built-in sender is heavily
   rate limited.
4. Keep “Allow new users to sign up” enabled. New accounts are harmless
   without an `app_members` row, and disabling sign-ups would also block
   first-time Google sign-in for newly added members.
5. SQL Editor: run `0014_deal_rounds.sql`, then `0015_auth_members_and_rls.sql`.

### Vercel (Production and Preview)

| Variable | Production | Preview | Notes |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | ✔ | ✔ | `https://<project-ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✔ | ✔ | Anon / publishable key. After `0015` it grants nothing without a member session. |

No other variables are needed. Do **not** add the service role key or the
Google secret to Vercel. Session cookies are `Secure` in production builds
(Production and Preview) and `SameSite=Lax`; local `next dev` over http
omits `Secure` so sign-in works on `localhost`.

## Activation order

Goal: no window where data is readable without a member session, and no
permanent lock-out.

1. **Google Cloud** OAuth client (above). No effect on the running site.
2. **Supabase** Google provider and Redirect URLs. No effect on the running
   site.
3. **Deploy the code** (merge to `main`). From this moment the web app
   requires login and membership. Until step 4, sign-in cannot complete
   access because `app_members` does not exist yet, so everyone sees
   *access denied*: the app fails closed.
4. **Run `0014` then `0015`** in the SQL Editor right after the deploy is
   live. This removes the anon policies. Until it runs, the anon key can
   still read the database directly (the pre-existing exposure), so do it
   immediately.
5. Mario signs in with Google and checks Overview, Pipeline, a company,
   Portfolio and a document download.
6. Verify in the SQL Editor:
   ```sql
   -- expect no rows
   select tablename, policyname, roles from pg_policies
   where schemaname in ('public', 'storage')
     and ('anon' = any(roles) or 'public' = any(roles));
   ```
7. Add other members (and only then, if ever, extra permissions).

If Mario is locked out after step 4, the fix is in SQL (for example, a
different email on the Google account): insert the right email into
`app_members` and `member_permissions`. Never restore the anon policies.

## Adding Microsoft later (Outlook users)

1. Register an app in Microsoft Entra ID with the redirect URI
   `https://<project-ref>.supabase.co/auth/v1/callback`. Use the Vanquish
   tenant (single-tenant) so only company accounts can sign in and email
   claims come from your directory.
2. Supabase → Providers → **Azure**: enable it with the client ID, secret
   and tenant URL.
3. In `src/lib/auth/providers.ts`, set `enabled: true` for `azure`.
4. Authorization does not change: the account email must be in
   `app_members`.

## Tests

- Unit: `npm test` (`src/lib/auth/*.test.ts` covers `next` sanitizing,
  default-deny permissions, navigation and providers).
- Database: `supabase/tests/access_control.sql` exercises anon, an
  authenticated non-member, a deactivated member, a member without
  permissions and Mario against tables, Storage, the review RPC and
  self-escalation. Run it only on a disposable database with migrations
  `0001`–`0015` applied (for example a local Postgres or a Supabase branch);
  it runs in one transaction and rolls back.
- End to end (not automated in CI): the flows above were exercised against
  a local Postgres + PostgREST stack with signed JWT session cookies for
  each persona, in both `next dev` and a production build.

## Known limits

- A signed URL created for a member with Documents stays valid until it
  expires (1 hour), even if the permission is removed meanwhile.
- The Google OAuth round trip and email delivery cannot be exercised
  outside the real Supabase project; they must be checked after setup.
- Changing a stage to Due Diligence auto-creates the checklist only when the
  person has Documents; for other members the checklist is not created.
- Membership is matched on the JWT email. Providers must supply verified
  emails (Google does; restrict Microsoft to the company tenant).
