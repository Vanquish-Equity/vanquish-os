# LP scouting and fundraising (phase 2)

This phase is based on current main after Phase 1's squash (`a4dc2fc`) and the
GitHub Actions scheduler. Only Phase 2 commits are replayed from the old branch.
No preview/production SQL is executed by this PR or by its disposable SQL CI.

## Private scouting

Admin grants `lp_scouting` independently of `email_scouting` in Settings. It is
absent by default. `/lp-scouting` checks membership and this permission before
loading private settings, suggestions, requests and jobs; RLS repeats the check.
Admin status alone does not permit reading another member's suggestions.

Consent defaults off, metadata defaults off, contact handling defaults request,
lookback defaults 30 days, and cap defaults 100 records **per service**. Allowed
ranges are 1–90 days and 10–500 records. The lower cap is deliberate to keep a
manual first run bounded. Gmail processes ten records per batch; Calendar five.
A new manual scan queues deduplicated Gmail and Calendar work and claims only
one batch. Repeated clicks resume checkpoints instead of creating active leases.

Only headers and attachment filenames are requested from Gmail. The provider's
partial-response mask excludes bodies, snippets and attachment bytes. Calendar
requests bounded event identity, title, time and attendee fields. Mailbox identity
comes from Gmail `/profile`, not the app-member email. Provider SENT labels cover
send-as messages without needing extra Gmail settings scopes. To/BCC recipients
qualify for outbound signals; CC-only recipients do not. Unrelated inbound
pitches cannot create suggestions. Gmail scans qualifying outbound context before received messages within one
shared cap, so replies on later pages can see prior outbound evidence. A cap may
truncate the received pass; increasing it is an explicit member choice. A reply only strengthens an existing
qualifying outbound thread/contact in the transactional SQL commit.

English/Spanish Admin keywords distinguish normal fund-material signals and
strong investor-specific signals. Known Company domains require strong signals.
Internal, automated and ignored participants are filtered. Confidence is a rule
label (strong or reciprocal = high; repeated = medium; otherwise low), not a
probability or a recommendation. Evidence contains signal, direction and date;
raw subjects/titles/filenames appear only under separate LP metadata consent.

Approve/dismiss is always a human action. Approval links or creates a Person,
marks potential LP, optionally links a selected existing Company and adds a card
to the owner's first LP list. No Company is synthesized from email domains.
The request/skip/auto setting applies **only to additional same-organization
contacts after that approval**: request queues private requests, skip omits them,
auto adds contacts to People. It never automatically approves a financial LP,
creates an Investor or infers commitments. Existing terminal decisions stay
terminal on replay; retrying acceptance does not duplicate People/cards.

Disabling prevents new scans. Turning metadata off strips stored metadata.
Integration health's withdrawal removes open suggestions, source evidence,
pending contact requests, jobs and checkpoints, while keeping accepted/dismissed
decisions stripped of evidence and preserving explicit financial records.

## Protected fundraising

`/portfolio/fundraising` and `/portfolio/fundraising/[id]` require Portfolio.
`fundraising_funds` is distinct from investment vehicles and may link a reviewed
legal entity. Investors reuse the canonical table; Person/Company links preserve
existing positions. Users explicitly create/link an Investor from a Person.
Fund currency cannot change once commitments/flows use it. Amount inputs use
decimal strings with at most two places; mixed currencies are never aggregated.

LP/fund stages are prospect, contacted, meeting, interest, soft circle, committed,
closed or lost. Changed stages append immutable history and compare the expected
old stage; stale edits fail. Lost requires a reason. Personal board moves never
change this pipeline. Own-card Investor promotion keeps card notes private.

Commitments are unique by Investor/fund with explicit soft-circle, signed,
funded or cancelled status. Calls, contributions and distributions are explicit
new cash-flow records with retry-stable UUIDs; previous wire/subscription events
are preserved without retroactive classification. Preferences/co-investment
interest and tasks are separate records. Report preferences do not activate
emails or an external scheduler.

LP 360 shows protected financial records/tasks plus opted-in shared relationship
history. Investor-linked files require both Portfolio and Documents and retain
existing document RLS. It never reads teammates' inboxes/private board notes.
Sections are capped at 100 records; identity selectors at 500. This is a bounded
working view, not an export or an accounting snapshot. Legacy position/SPV views
remain under `/portfolio/investors/[id]`; no portal endpoint is introduced.

## Activation and verification

Review `20261014173500_lp_management.sql` and the generated whole-file
`supabase/phase-sql/phase-2-lp-management.sql`. The timestamp sorts after both
`20261012175553` and the owner-reported `20261012200002` production patch. The
latter is not present in the main migration files at review time; it is a
production prerequisite to confirm, not bundled or fabricated by this PR.
SQL is transactional and reapplied in disposable CI; seed keywords use conflict
handling and defaults do not reset existing consent or machine authorization.
`python3 scripts/check_phase_sql.py` checks forward and rollback source drift.

Exact activation order (owner only, not performed here):
1. Back up the project, inspect the current production chain, then paste the
   entire combined Phase 2 SQL into Supabase's SQL editor. Do not select a suffix.
   On failure roll back the transaction, stop activation and resolve the error.
2. Merge the reviewed PR into main and confirm the deployment. SQL goes first
   so the new permission constraint/RPC and routes arrive in the correct order.
3. In Admin settings → Members & access, enable `lp_scouting` for the owner/test
   member. Both the toggle and member access read `member_permissions`; there is
   no second permission store. Admin does not implicitly grant scouting. Personal
   scan consent and metadata consent are independent default-off settings.
4. With the owner's existing Google account, enable private scouting in request
   mode, keep metadata off, and run bounded manual batches. Verify outbound
   material yields a private candidate, replies only reinforce it, inbound founder
   pitches/internal/CC-only mail do not create candidates, and approval is the
   only initial CRM/People publication. Repeat approval must not duplicate cards.
5. Optional scheduled LP scanning requires two owner opt-ins, below. Do not
   enable them merely to test the permission toggle. No second project or Google
   account is required; no live Google test was performed by this PR.

### Scheduled Auth worker

The only worker is `.github/workflows/sync-worker.yml`, every 15 minutes. It uses
the existing Supabase Auth email/password session with refresh before every RPC;
no service-role API key, custom JWT or legacy signing secret is used. Ten LP
batches may run after up to twenty relationship/CRM batches. If the scheduler
flag is absent/off, no LP RPC is called. Logs include only service/count/outcome,
never identities, credentials or raw provider/database payloads.

Every LP `worker_*` begins with `private.require_worker_identity()` (including
its shared lock/revocation/rotation fence) then checks the new SQL-only capability.
`lp_scanning_enabled` is false by default for every existing identity.
`relationships_only=true` rejects LP scanning even if that flag is enabled.
Only after owner approval, replace the synthetic UUID locally and run:

```sql
update private.machine_identities
set relationships_only=false,lp_scanning_enabled=true
where sub='00000000-0000-0000-0000-000000000001' and enabled;
```

Set the GitHub Actions repository **variable** `LP_SCOUTING_WORKER_ENABLED=true`
(it is not a secret). The existing authenticated service account still needs the
DB opt-in; the member separately needs permission, consent and a Google connection.
Leaving relationships-only mode permits the existing CRM/Drive paths when their
own consents are enabled; review them before changing the identity. The current
production identity is left unchanged by this migration and PR.

To revoke LP machine work, set that variable false/unset and, as owner SQL:

```sql
update private.machine_identities set lp_scanning_enabled=false
where sub='00000000-0000-0000-0000-000000000001';
```

The update waits for any in-flight RPC holding the shared identity lock; new
claim/context/commit/failure calls then fail with 42501. Full identity revocation
and password rotation remain in the Phase 1 runbook. New LP/fundraising tables
have restrictive machine isolation with scalar SELECT predicates; the service
can only use guarded scan RPCs, not direct table access or human decision RPCs.

### Rollback

First disable scheduled LP work and the DB capability. Stop/invalidate pending
LP leases and personal scan consent using owner SQL, revoke only `lp_scouting`,
and restore the preceding main app deployment. Keep Phase 1 Auth and its Actions
scheduler. Do not apply the Phase 1 rollback merely to undo Phase 2.

The data-preserving operational rollback can leave Phase 2 schema dormant:

```sql
begin;
update private.machine_identities set lp_scanning_enabled=false;
update public.lp_scout_jobs set status='dead',lease=null,locked_until=null,error_code='phase2_rollback'
where status in ('pending','running','retry');
update public.lp_scouting_settings set enabled=false;
delete from public.member_permissions where permission='lp_scouting';
commit;
```

This preserves funds, commitments, flows, accepted People/contacts and boards.
The Phase 2 withdrawal wrapper remains consent-aware and removes only derived
scouting data when a member disconnects. Previous app routes do not expose LP UI.

For an unused schema, review and paste **all** of
`supabase/phase-sql/phase-2-rollback.sql`. It restores exact pre-phase permission
and withdrawal functions/ACLs and the prior CHECK; removes new RPCs/tables,
policies, columns and the machine LP flag; and never touches Storage or Phase 1
identity/sync functions. It is tested twice and refuses to proceed if financial
records, investor Company links or accepted decisions exist. It removes pending
private scan evidence/settings, so take an owner backup first. With durable LP
records, keep the operational rollback or use an independently reviewed backup
restore/data migration; do not bypass the refusal and silently discard data.

### Verification

SQL tests cover member/unregistered/service capability denial, explicit opt-in,
revocation, RLS, common permission source, lease behavior, privacy and financial
rules. CI exercises full historical migrations, Phase 1/Auth, Phase 2 twice,
record-preserving rollback refusal, Phase 2 rollback twice with exact prior
function/ACL/CHECK comparisons, then Auth regressions and Phase 1 reversal.

Synthetic UI verification: after `npm run build`, run
`CHROMIUM_EXECUTABLE_PATH=/path/to/chromium node scripts/check_lp_ui.mjs` with
Playwright available (`PLAYWRIGHT_MODULE_PATH` can point to its installed module).
It bundles actual components/CSS with stubbed actions/links and fictional data.
It checks keyboard selection/Escape, touch approval, reduced motion, narrow
layout, consent submission and cash-flow retry UUID stability. It does not test
real Next transport, Supabase auth or Google; owner acceptance covers those.
