# Phase 1 — owner-account production canary, Auth worker and rollback

This procedure reflects the owner's choice: one production Supabase project,
one member with Google connected and one existing relationship-history row.
No second project/account is required. The row count is an owner-provided
starting point, not independently inspected here. Preparing this PR applies
nothing and creates no Auth user. CI uses only disposable PostgreSQL fixtures.

## Signing configuration and worker identity

The project uses ECC P-256 signing keys. The worker **does not sign JWTs**,
read the Legacy JWT secret, mint `service_role`, or use `VANQUISH_WORKER_JWT`.
It signs in to Supabase Auth with the service user's email/password. Auth issues
an ordinary `authenticated` access token and refresh token. Both stay in memory.
The session is checked for the expected UUID, email, role and future expiry;
refresh occurs within two minutes of expiry, before claim/context/commit/failure
operations. Malformed/expired sessions, failed login/refresh or denied SQL
identity checks stop the worker without printing token/credential/error payloads.
Each invocation processes at most 20 batches; repeat invocations log in again.

Supabase-generated asymmetric private keys cannot be extracted for local
signing. JWKS provides only public verification keys. External minting would
require a separately held private key deliberately imported/trusted by the
project; no key import/rotation is authorized or needed for this design. An
old HS256 key that remains trusted for verification is not used to mint anything.
The new publishable/secret API keys are API credentials, not signing keys.
See [Supabase signing keys](https://supabase.com/docs/guides/auth/signing-keys)
and [custom JWTs](https://supabase.com/docs/guides/auth/jwts).

`private.machine_identities` records the service Auth user's `sub` UUID, enabled
flag, `relationships_only` flag and minimum accepted token issuance time. It has no API/table grants. Only SQL run by
the database owner can provision, disable or change it. No identities are seeded
by migrations. Each public `worker_*` RPC begins with the identity check and
holds a shared lock on the enabled row until its transaction completes.
Members, unregistered Auth users and the old custom roles are denied. The
service user must not be in `app_members`; accidental membership rejects its
worker access and registered service subjects remain excluded from member RLS.

Registered subjects, including disabled identities, have restrictive table
isolation across public and Storage tables. Existing unprotected tables retain
their prior access contract for other roles, but service access is denied.
Views use invoker RLS. Shared `authenticated` grants cannot distinguish users,
so no-data/no-write tests check actual RLS outcomes, not just SQL GRANT bits.
TRUNCATE/REFERENCES/TRIGGER grants are removed from authenticated because they
can bypass row policies; the rollback restores their exact previous presence.
Private tables/credentials and internal delegates have no direct service grants.

Deal guards, event publication, Drive publisher immutability and audit actor
selection recognize the registered service subject, using the lease-bound member
as publication actor. `current_setting('role')='authenticated'` still applies to
deal guards; this never permits a service user to bypass them. Withdrawal remains
a member RPC with the protected transaction capability, not a worker capability.

## Owner activation order (not executed by this PR)

1. Save the previous production deployment reference and review/download the
   forward combined SQL and full rollback. Take an owner-managed database backup.
   Stop worker processes; leave CRM publication and all Drive sources off.
2. Apply the existing chain through `20261008201057`, then the two phase 1
   migrations in order: `20261009171254_durable_relationship_sync.sql` and
   `20261012175553_auth_service_worker.sql`. The generated forward file contains
   both new migrations only. No SQL tests are for production.
3. Deploy the reviewed phase 1 app/worker. In Supabase Dashboard → Authentication
   → Users, create a dedicated service user with a strong unique password and
   verified email. Ensure the email/password Auth provider permits this service
   login; if sign-in is blocked, stop rather than using a broader key. Copy its Auth UUID. Do **not** add its email to `app_members`,
   connect Google as that user or give it member permissions.
4. As database owner, register that UUID. Replace the example UUID below with
   the actual UUID; the example is not a real identity:

   ```sql
   insert into private.machine_identities(sub, enabled, relationships_only)
   values ('00000000-0000-0000-0000-000000000001', true, true);
   ```

5. As the owner **member** in the app, connect/retain the owner's Google mailbox,
   enable only relationship history, and leave CRM activity and subject sharing
   off. Disable all Drive sources. The service registration defaults to
   relationships-only: **any enabled CRM account or Drive source blocks every
   worker RPC before a claim**, so a misconfigured run cannot publish another
   sink. This is intentionally a global canary gate while only one mailbox exists.
6. Run the local command below, close the app browser, then inspect own Integration
   health and People/Network. Confirm known-People daily history updates, successful
   Gmail/Calendar checkpoints and no CRM/Drive publications. Confirm the existing
   row remains; the initial read window is 90 days, not the LP 30-day scan.
7. Renew/repeat the local invocation as needed for bounded batches. Only after
   acceptance should the owner arrange an external scheduler. Its secrets are
   identical to the local worker environment; no tokens belong in Vercel.

The service Auth account is different from a disposable Google test account:
the owner uses the existing Google connection; the service account only runs RPCs.
There are no consent or identity changes executed by these instructions.

## Run from a computer

Use Node.js 22+ and a terminal on the owner's trusted computer. Clone/fetch the
reviewed branch, then run `npm ci` (dev dependencies are required for `tsx`).
Supply the following environment values through a local secret manager or hidden
terminal prompts, **not command-line arguments, literal shell history or files**:

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | This production project's public URL. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Existing anon key or new publishable API key; never a secret/service-role key. |
| `SUPABASE_WORKER_EMAIL` | Dedicated service Auth email. |
| `SUPABASE_WORKER_PASSWORD` | Its current password. |
| `SUPABASE_WORKER_USER_ID` | Expected Auth UUID, exactly the registered sub. |
| `GOOGLE_OAUTH_CLIENT_ID` | Same Google OAuth client as the app. |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Same Google client secret, from owner secret manager. |
| `MAILBOX_TOKEN_ENCRYPTION_KEY` | Same 32-byte/base64 mailbox encryption key as the app. |

For Bash, hidden prompts avoid echo and literal secret history:

```bash
for name in NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY SUPABASE_WORKER_EMAIL SUPABASE_WORKER_PASSWORD SUPABASE_WORKER_USER_ID GOOGLE_OAUTH_CLIENT_ID GOOGLE_OAUTH_CLIENT_SECRET MAILBOX_TOKEN_ENCRYPTION_KEY; do
  IFS= read -r -s -p "$name: " value
  echo
  export "$name=$value"
done
unset value name
npm run sync:worker
unset SUPABASE_WORKER_PASSWORD GOOGLE_OAUTH_CLIENT_SECRET MAILBOX_TOKEN_ENCRYPTION_KEY
```

On Windows, use PowerShell with hidden input (or run Bash via WSL):

```powershell
$names = 'NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_ANON_KEY','SUPABASE_WORKER_EMAIL','SUPABASE_WORKER_PASSWORD','SUPABASE_WORKER_USER_ID','GOOGLE_OAUTH_CLIENT_ID','GOOGLE_OAUTH_CLIENT_SECRET','MAILBOX_TOKEN_ENCRYPTION_KEY'
foreach ($name in $names) {
  $secure = Read-Host $name -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { [Environment]::SetEnvironmentVariable($name, [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr), 'Process') }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}
npm run sync:worker
Remove-Item Env:SUPABASE_WORKER_PASSWORD,Env:GOOGLE_OAUTH_CLIENT_SECRET,Env:MAILBOX_TOKEN_ENCRYPTION_KEY
```

The worker reads the process environment; it does not automatically load .env
files. Do not enable shell tracing/transcripts or print environment/session
objects. Logs contain only bounded service/outcome counts. Exit nonzero means
stop and inspect credentials, identity/consents and Integration health. No
fallback to a broad role or locally signed JWT is allowed.

## Revoke identity and rotate password

Immediate DB revocation (owner SQL, actual UUID substituted):

```sql
update private.machine_identities set enabled=false
where sub='00000000-0000-0000-0000-000000000001';
```

Stop all invocations. The update waits for any already-authorized RPC transaction
to complete, then blocks new claim/context/commit/failure calls even if its JWT
has not expired. In-flight Google metadata requests can finish, but cannot commit
after revocation. Keep the disabled row: it continues to enforce table isolation.
Revocation does not delete the member's history or Google connection.

For routine password rotation: disable the identity, stop workers, change the
service password through the owner's Auth administration, and globally revoke
that user's refresh sessions using Supabase Auth admin `signOut` with a service
user access token (scope `global`) in an already trusted owner-only admin tool.
Do not put an admin/secret API key in the worker. Password change alone must not
be treated as revocation of all previously issued access tokens. In an incident,
keep the identity disabled, revoke sessions and allow already issued access tokens
to expire, or use the issuance fence below to invalidate old access tokens locally.
Store the new password only in the local/scheduler secret manager. After globally
revoking refresh sessions, owner SQL can re-enable with a minimum token `iat`:

```sql
update private.machine_identities
set tokens_valid_after=date_trunc('second',now())+interval '1 second', enabled=true
where sub='00000000-0000-0000-0000-000000000001';
```

Wait at least one second, then start a fresh worker process. Its new login token
must be issued after the fence; old signed access tokens are rejected by every
worker RPC. Revoking refresh sessions is still required so an old refresh token
cannot obtain a new access token after the fence.
See [Auth admin signOut](https://supabase.com/docs/reference/javascript/auth-admin-signout)
and [sessions](https://supabase.com/docs/guides/auth/sessions).

## Push is disabled

`POST /api/integrations/gmail/push` always returns 503, even if old secrets remain.
The SQL signal RPC validates identity then rejects use. The engine never creates
or renews a Gmail watch; polling suffices. Leave `GMAIL_PUBSUB_TOPIC` and all old
push JWT variables unset. Future activation needs a reviewed signal-only identity
separate from the worker, authenticated Google OIDC issuer/audience/service-account
checks, bounded payloads/replay handling, Gmail watch lifecycle, owner-configured
Pub/Sub and tests. Do not simply turn old environment values back on.

## Full phase 1 rollback

`supabase/phase-sql/phase-1-rollback.sql` is the generated standalone reversal of
both phase 1 migrations. Source: `supabase/rollback/phase-1-durable-relationship-sync.sql`.
Owner operation only, never automatically applied. It rejects a phase 2 schema:
if phase 2 has been applied, its own reviewed reverse procedure is needed first.

Stop worker processes and revert to the previous production application that
still has browser relationship sync. With workers stopped, execute the reviewed
rollback during the switch; the phase 1 app calls RPCs the rollback removes.
The rollback locks the queue, invalidates active Gmail/Calendar leases, restores
all prior function bodies and role ACLs, restores browser INSERT/UPDATE on
relationship_sync and INSERT/UPDATE/DELETE on relationship_interactions, and
restores pre-existing table/view security settings and non-DML grants.

Visible relationship history (including already published phase 1 rows), CRM
activity and Google credentials are preserved. It does **not** restore a deleted
history row from the private legacy copy. It drops phase 1-only private baseline,
provider contributions (including not-yet-published future meetings), machine
registrations and checkpoint/durable columns. Those are derived state; retaining
provider provenance requires an owner backup before reversal. It creates no new
Auth user and does not delete the service Auth account, which should be disabled
or removed separately by the owner. Returning to the old app restores browser
sync, not an Auth worker or push activation.

CI captures pre-phase function definitions/ACLs and table/view security, applies
the full phase, tests Auth isolation/revocation and replay, reapplies it, executes
the rollback twice, compares exact baseline definitions/ACLs, checks visible-data
preservation, then reruns relationship_interactions, sync, source access,
worker-boundary and #60 withdrawal tests. Local SQL runs in disposable PGlite;
GitHub CI runs native PostgreSQL 16. No actual production canary is executed here.

The #65 branch must be rebased/adapted to this new Auth worker contract before
activation. Its LP worker RPCs must receive the same subject guard and its runner
must keep Auth-session login; this PR does not silently change or activate #65.
