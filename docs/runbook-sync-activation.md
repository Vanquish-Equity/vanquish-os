# Sync activation runbook — phase 1

This is a reviewable operating procedure, not evidence of activation. No remote
migration, scheduler, issuer, Pub/Sub subscription or secret is created by this
change. A queued job is not proof of a functioning worker.

## Preconditions and owner decisions

The owner first reviews and merges the implementation PR and separately decides
which environment to activate. Apply the full migration chain through
`20261008201057`, followed by `20261009171254`, under the existing migration
process. The combined phase SQL includes only the new migration, not seeds or
SQL tests. Do not run test files against preview/production. Confirm schema
readiness before opening the new pages.

Provision a server-side scheduler outside Vercel (for example every ten minutes)
and trusted machine-token issuer. The repository supplies the worker command,
not the infrastructure. Install dependencies including `tsx`, or precompile the
worker. Run `npm run sync:worker`; each invocation processes at most 20 batches,
with at most 10 Gmail metadata reads per lease and five-minute leases.

Configure the Supabase public URL/anon key, existing Google client ID/secret,
`MAILBOX_TOKEN_ENCRYPTION_KEY` and `VANQUISH_WORKER_JWT` in the worker's secret
manager. The JWT has role `vanquish_worker`, expiry at most one day ahead
(prefer one hour), and automatic renewal before expiry. Its signing key stays
only at the trusted issuer. Never use the service-role key. Never put the worker
JWT in Vercel, browser variables, Git, PRs or logs. Verify expiry/role failures
before a disposable lease smoke check; rotate with overlapping short-lived
issuance and retire the previous issuer key only after the overlap ends.

Each member connects their own Google account. CRM activity and relationship
history are separate choices, both off by default; subject/title sharing needs
its separate explicit CRM choice. Relationship-only access fetches no Gmail
Subject header and never publishes CRM activity. Drive remains separately
consented, Documents-permission gated, and restricted to chosen folders.

## Optional Gmail push

Polling works without push. If the owner chooses push, provision a Google topic
and Gmail publishing permission, then an authenticated Pub/Sub push subscription
to `/api/integrations/gmail/push`. `GMAIL_PUBSUB_TOPIC` belongs on the worker.
Vercel receives only `GMAIL_PUSH_AUDIENCE`, `GMAIL_PUSH_SERVICE_ACCOUNT` and a
separately renewed `GMAIL_PUSH_JWT` with role `vanquish_gmail_push`. That identity
can signal Gmail work but cannot claim leases, obtain OAuth tokens or read
tables. Verify Google's OIDC issuer, audience and service-account identity.
Push history IDs are wake-up hints, never committed sync checkpoints.

## Synthetic acceptance in the selected test environment

Use disposable accounts and People/Company records; never a real investor
ledger, private mailbox body or production document. Record timestamps, bounded
outcome codes and fixture IDs, without credentials or provider payloads.

| Check | Expected result |
| --- | --- |
| Both consents off | No Gmail/Calendar lease or publication. |
| Relationship only | Email/meeting daily rows for known People; no CRM source activity, subject/title or body. |
| CRM only | Existing reviewed CRM matching; no relationship daily rows. |
| Both on | One active stream per member/service; both authorized sinks publish. |
| Browser closed | External scheduled invocation completes queued work; verify last success and checkpoint age. |
| Replay same IDs | No duplicate daily/source rows or regression of latest time. |
| Two meetings on one UTC day, cancel newest | Remaining contribution survives; a legacy baseline remains when provenance is unknowable. |
| Future recurring occurrence, cancellation | Shared history waits until due; cancelled occurrence removes only its own contribution. |
| Declined contact/self, draft, chat, Trash/Spam | No relationship publication from excluded evidence. |
| Revoke relationship during lease | Old lease cannot commit; CRM may continue only under its independent consent. |
| Deactivate member or disconnect during lease | Commit fails closed; no further publication. |
| Another member opens health/retries ID | Own health only; cross-account retry and private provenance reads denied. |
| Retry dead/retry run twice | Current consent/access required; committed cursor retained; one active job. |
| Delete my history | Own baseline/contributions/history removed, relationship consent off; CRM untouched. |
| Disconnect and withdraw | Own CRM/relationship/Drive publications and private provenance removed; another member's publications preserved; original Google files untouched. |
| Expired/wrong-role token | Worker/push fail before privileged calls; no fallback to service role. |

UI acceptance covers Chromium at 1440px and 390px, keyboard and touch, reduced
motion and live retry feedback. SQL acceptance runs the entire historical CI
sequence plus the new suite on a disposable database before push.

## Health, failure and recovery

Inspect Integration health per service/source: last successful sync, checkpoint
age, dead and active runs. Old consent-change dead runs remain historical;
counts are not a blanket outage diagnosis. Five exhausted attempts stop a run.
Resolve connection, issuer, scheduler or provider issues first, then use own
safe retry. Do not advance a Google cursor manually, enable an unrelated sink
or remove source data to make the status green. Retry only queues reads; it
never sends mail or mutates Google events/files.

Pause the relevant consent or Drive source to stop new eligible work. For a
privacy withdrawal use Disconnect and withdraw, or Delete my history for only
relationships. Pause alone retains already shared history. Legacy rows cannot
be attributed to cancelled old provider events because the original browser
sync stored no provenance. A Google token already retrieved may remain usable
at Google until expiry; database authorization is rechecked at commit.

## SQL impact and review artifact

`supabase/phase-sql/phase-1-durable-relationship-sync.sql` contains the single
new migration in execution order. It has DELETE statements for cancellation,
explicit history deletion and withdrawal. Existing shared rows are copied once
into a private baseline, not mass deleted. It drops/recreates one checkpoint
trigger, revokes browser write grants, and moves three existing function bodies
into private delegates before installing wrappers. It drops no table, column
or stored history. The migration does not turn on any previously disabled sink.
