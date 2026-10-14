# Sync worker activation and recovery

This is a code-contract guide, not an inventory of a live environment. Do not
infer database state, account configuration or activation from this document.
Only an owner may execute the separately reviewed SQL. PR checks use disposable
synthetic databases and apply nothing to hosted preview/production projects.

## Runner and identity contract

Use only the scheduled GitHub Actions worker defined in
`.github/workflows/sync-worker.yml`; do not start a second local worker. Keep
credential values in the workflow's secret store. Never put values in source,
repository variables, command arguments, screenshots or logs.

The runner authenticates through Supabase Auth using a dedicated service user.
It validates the expected identity and the ordinary authenticated access token,
keeps tokens in memory and renews the session before sensitive RPCs. A failed
login, invalid/expired session, renewal failure or rejected authorization stops
processing. It never signs JWTs, reads a legacy signing secret or uses a
service-role key. The service user must not be an application member or connect
its own Google account; mailbox access belongs to consenting members.

The owner's private machine registry controls authorization independently of
JWT validity. Each worker RPC first invokes the identity guard, which holds a
shared lock on the enabled identity row until the RPC transaction completes.
Members and unregistered Auth users are denied. Registered identities remain
excluded from member RLS and direct table access even when disabled.

## Phase 2 activation

Review [LP activation and rollback](lp-management.md#activation-and-verification)
and the complete generated `supabase/phase-sql/phase-2-lp-management.sql`.
Confirm the prerequisite migration chain against the target using owner access;
on a project with Phase 1/Auth already installed, apply only Phase 2. Never
reapply a phase merely because its code is included in a branch's history.

The order is **whole Phase 2 SQL → merge/deploy → grant lp_scouting → owner
manual test**. Run the whole transaction, never a selected suffix. With psql,
use ON_ERROR_STOP; in an editor left in an aborted transaction, execute
ROLLBACK before proceeding. A failed transaction must be resolved before any
worker capability or member consent is enabled. Earlier separately committed
migrations are not automatically undone by a later transaction failure.

Start with private manual batches, request mode and metadata off. Confirm that
outbound investor material yields only a private suggestion, incoming founder
pitches cannot create candidates, and explicit human approval is required for
initial People/CRM publication. Members' candidates remain private; Portfolio
and Documents permissions separately govern fundraising and linked documents.

Scheduled LP work needs both the default-false SQL machine capability and the
nonsecret workflow variable documented in the LP guide. Relationships-only mode
rejects LP RPCs even if the capability is enabled. Member permission, personal
consent and a valid Google connection are additional independent gates.
Do not change existing identity settings merely to test the Admin toggle.

## Revocation and rotation

To stop LP work, turn off its workflow opt-in and disable the SQL LP capability.
For full worker revocation, disable the identity row rather than deleting it:
that preserves its exclusion from membership and row access. The owner update
waits for in-flight RPCs holding the shared lock; subsequent calls reject even
an unexpired access token. Provider metadata requests already in progress may
finish, but cannot publish after database revocation.

Password rotation requires stopping the runner, disabling the identity,
changing the service password through trusted Auth administration and globally
revoking its refresh sessions. Password change alone is not proof that existing
access tokens have become invalid. Keep the identity disabled until old tokens
expire, or use the registry's minimum token-issuance fence before re-enabling it.
After fencing, wait for that cutoff and sign in afresh. Refresh-session revocation
is still necessary so an older refresh token cannot obtain a post-cutoff token.
Never give the worker a broader administration key to perform these operations.

## Storage and view prerequisites

Storage schema objects are managed separately from application tables. The Auth
migration requires existing RLS on objects/buckets and only creates/removes its
machine isolation policy there; it does not depend on Storage ALTER TABLE or
REVOKE. Excluded Storage relations with privileges plus a possible row-access
path abort the migration. Enabled RLS with no policies is accepted as deny-all.
The code and disposable Storage permission harness define these preconditions;
the harness is an emulation, not a check of any hosted project's permissions.

Unhandled permission, ownership, guard or policy errors abort the entire Auth
transaction. Do not swallow them, skip statements, change provider ownership or
rely on a warning-free REVOKE to establish isolation. Correct the supported
prerequisite and retry the complete reviewed transaction.

After migration, verify `person_last_interaction` has security_invoker enabled.
As an ordinary active member, compare a known Person's latest view row and
attribution with the latest permitted relationship_interactions row. Test another
member's activity when available; an owner/postgres read alone does not verify
member RLS. An empty or denied member view blocks acceptance. Do not remove
security_invoker to bypass an unexpected result.

## Recovery boundaries

For Phase 2, use the data-preserving operational rollback in the LP guide:
disable LP work/consent and permission, invalidate its leases and restore the
preceding application while retaining financial records. Leave Phase 1/Auth
and its scheduled runner intact.

`supabase/phase-sql/phase-2-rollback.sql` is a separate whole-file schema reversal
for an unused Phase 2 schema. It restores prior function definitions, grants and
permission CHECK, but refuses to delete durable financial/accepted records.
Take an owner backup first; derived unaccepted scouting state is removed.

`supabase/phase-sql/phase-1-rollback.sql` reverses Phase 1 as a separate recovery
operation. Stop the runner and restore the compatible prior app before using it.
It refuses an installed Phase 2 schema, restores browser relationship writes and
prior functions/ACLs/public table/view settings, and removes derived provenance
and the registry. Visible history is preserved; deleted rows are not resurrected.
Storage provider settings remain untouched. Never use it merely to undo LP UI.

Gmail push remains disabled. Future activation needs a separately reviewed
signal-only identity, OIDC issuer/audience checks, bounded/replay-safe payloads,
watch lifecycle and owner-controlled Pub/Sub setup. Polling needs no push setup.
