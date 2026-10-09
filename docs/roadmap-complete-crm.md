# Complete CRM roadmap

Status: **Phase 0 — design only**, 2026-10-09. This is a proposal grounded in
the current repository, not a statement that the capabilities below are live.
The scope comes from Mario's complete-CRM brief. The separately authorized AI
animation merge does not authorize merging these phases, activating sync,
running production migrations, sending messages or connecting an AI provider.

## Delivery and dependency rules

Each numbered phase has its own branch and **draft PR against main**. Start
the next phase only after the previous phase's application and applicable SQL
CI are green at its exact head commit. Never merge these PRs or apply their
migrations to preview/production. A dependent phase must name its prerequisite
PR/commit explicitly; do not silently copy unmerged implementation into another
phase's PR. If a prerequisite is absent from main, hold dependent implementation
for the owner's integration; independent design work can still be prepared.

Read AGENTS.md, the documentation map and the installed Next.js guide relevant
to each API before editing. Reuse existing server membership checks, RLS,
review RPCs, durable jobs, SelectMenu, Checkbox and card/motion styles. Company
is the durable organization; Deal is a round/opportunity; board movement never
changes Deal stage unless it is the real Investment Pipeline.

Every schema change uses a new timestamp migration later than
`20261008201057`, explicit CI registration and a meaningful exception-raising
SQL suite. Preserve existing rows and references. Each phase delivers a
combined SQL file in exact dependency order, with prerequisite migrations,
transaction boundaries and every DELETE/DROP called out. Create machine roles
in a separate earlier migration before their use. No private seeds or secrets.
Only the owner applies reviewed SQL. Forward migrations are not a rollback
script; rollback instructions pause features before any separately reviewed
data repair.

## Verified starting point

| Area | Existing implementation | Gap to close |
| --- | --- | --- |
| Company intake | `company_suggestions`, `contact_requests`, `scouting_settings`; private member suggestions, request/skip/auto **contact handling**, `email_scouting`; manual/browser scans | LP classification, direction-sensitive signals, configurable caps/keywords, durable delivery. Existing modes do not auto-accept companies. |
| Relationships | `relationship_sync`, daily deduplicated `relationship_interactions`, opt-in browser/manual `RelationshipAutoSync` | Durable delivery with the same consent, cancellation handling and withdrawal; independent CRM consent must not imply relationship sharing. |
| CRM sync | `crm_sync_accounts`, `crm_sync_jobs`, `crm_source_events`, lease-bound worker RPCs, Gmail history/watch and primary Calendar syncToken | External scheduler activation is unverified; relationship history is a separate path; richer per-service health. |
| LP follow-up | Private/shareable member LP boards and directory source links; People potential-LP flag | Firm fundraising entity/stage history, promotion to canonical LP, commitments and LP 360. Private follow-up notes must not be published on promotion. |
| Portfolio | `investors`, `legal_entities`, `investments`, `investment_vehicles`, `investor_positions`, `capital_events` | Fundraising identity and cash-flow semantics. `investment_vehicles` is an Investment↔legal-entity join, **not a fund catalog**. |
| Governance | Restricted Deals, explicit readers/editors, reviewed changes with stale-value conflict, audit | Carry these checks into exports, aggregates, introductions, custom fields and integrations. |
| Documents | Private bucket, explicit Drive/Gmail import, local text/PDF extraction, reviewed metadata and metadata versions | Scanned-document OCR, retained historical binaries and semantic-search design. Investor documents require both Documents and Portfolio. |
| Reporting | Pipeline analytics read bounded API rows; monitoring has CSV | SQL aggregates, full authorized exports, scheduled reports and reconciled fund metrics. |
| Mail/calendar | Live caller-owned Google APIs, explicit mutations, etags, no automatic mutation retries | Durable scheduled sends, aliases, complete forwarding, resumable attachments, series editing, availability and task overlay. |

The eleven `20261008*` migrations are repository prerequisites, not evidence
that any environment applied them. Documents still mention some historical
limits followed by operating-workflow updates; use the latest implementation
and those updates together. Outlook is a client of the Workspace Gmail
mailbox; this roadmap does not add Microsoft Graph.

## Phase sequence and acceptance

| Phase / proposed branch | Deliverable | Dependencies / release gate |
| --- | --- | --- |
| 0 · `docs/complete-crm-roadmap` | This document only, draft PR; no product or schema code | Baseline checks; publish observed CI and connected-flow limitations honestly. |
| 1 · `feat/durable-relationship-sync` | Activation runbook; shared worker delivery for opt-in relationship history; Integration health last success, dead jobs, cursor age and safe retry | Existing sync/withdrawal schema. Prove repeated events, consent revocation and member isolation before Phase 2. No real activation. |
| 2 · `feat/lp-management` | Private Gmail/Calendar LP scouting, fundraising model/pipeline and LP 360; **portal design only** | Phase 1 durable contract for worker intake; validate false positives and transactionality. Portal remains unimplemented without explicit approval. |
| 3 · `feat/crm-reporting` | Authorized CSV, SQL aggregates, opt-in weekly reports to members and fund metrics | Phase 2 commitments/cash-flow meanings, Phase 1 jobs. EXPLAIN on 20,000 synthetic rows and known metric cases. |
| 4 · `feat/relationship-intelligence` | Explainable strength score and bounded multi-hop introductions in Network/record pages | Phase 1 consented history. Depth/node/query budgets, no private-content disclosure. |
| 5 · `feat/mail-calendar-completion` | Scheduled send/cancel, aliases, push refresh, complete forwarding/large attachments; recurrence, drag/resize, RSVP, free/busy and Tasks | Durable worker and explicit Google mutation confirmation. No real Google writes in CI; uncertain delivery never retries automatically. |
| 6 · `feat/crm-personalization` | Admin-defined typed fields, richer saved views and task/checklist templates | Phase 2 LP entity; preserve personal/shared view semantics and board independence. |
| 7 · `feat/document-lifecycle` | Local OCR interface off by default, retained file versions/restore, semantic-search interface/design off | Existing document ACLs plus owner decisions on retention/resources/providers. No cloud OCR/embeddings or LLM calls. |
| 8 · `feat/crm-edge-capabilities` | Individually designed founder intake, co-investors/syndicates, signed API/webhooks, mobile audit and conditional PWA | Prior authorization/data contracts. Each capability gets a threat/privacy design, permission tests, limits and activation flag. |

### Phase 1 — durable activity, without activating accounts

Keep `relationship_sync.enabled` as the independent opt-in source of truth.
Extend job scheduling/lease validation so a member with relationship sharing
only can be serviced without enabling richer CRM publications. Context RPCs
return only fields needed for the requested service/purpose. CRM-only consent
must never publish relationship rows, and relationship-only consent must not
publish CRM subjects/events. Retain existing daily key
`(person_id, member_email, kind, occurred_on)` and update `last_at` monotonically;
do not replace or reset old history. If both consumers use the same provider
event, fetch metadata once and fan out only to independently consented sinks.

Define a compatibility/backfill boundary so history from an earlier browser
run is preserved and reprocessing cannot duplicate it. Cancellation removal
needs provenance: a day can contain several meetings, so removing one must not
delete the remaining day's interaction. Use private source contribution rows
or an equivalent bounded aggregate; do not put provider IDs in the shared
relationship table. Stop/invalidate leases when either relevant consent is
withdrawn or membership is deactivated. Extend the existing transactional
withdrawal to new provenance/cursors; preserve other publishers and manual data.

Expose per-member/service successful-sync time, failed/dead status, cursor
checkpoint time (not Google cursor values), retry count and safe retry. Do not
show another member's mailbox addresses, credentials or private queue records.
An explicit retry only queues an eligible failed/dead read job; concurrent
clicks cannot create duplicate active jobs or revive a revoked lease.

`docs/runbook-sync-activation.md` must distinguish repository readiness,
owner-applied schema, Google consent and external scheduler readiness. Include
worker JWT and push JWT issue/rotation/expiry (maximum one day), secret locations,
environment variables, Google APIs/scopes with Drive readonly by default,
authenticated Pub/Sub, scheduler limits, canary verification, revocation and
rollback. No token values, URLs with credentials or real activation in the PR.

### Phase 2 — LP scouting and fundraising

Mirror private company scouting with `lp_scouting_settings` and
`lp_suggestions`, private to `member_email`; add `lp_scouting` rather than
reusing `email_scouting` because access to finding companies is not consent to
classifying investor relationships. Grant through Admin only, default absent.
Keep request/skip/auto semantics explicit: request queues private review; skip
records no new prospect; auto promotes only under the member's deliberate
setting, permission and high-confidence rules. Default is request. Terminal
accepted/dismissed suggestions never reopen. Accept can atomically create or
link a Person and mark potential LP, optionally link an appropriate canonical
Investor/Company and add to the member's own LP board's chosen initial list.
Do not create a corporate Company for a personal email domain or invent an
investment/commitment from an email. Acceptance verifies current permission,
ownership, chosen IDs and board access; retries return the existing outcome.

Use configurable English/Spanish Admin keywords, member scan window and caps
(proposed defaults 30 days/500 messages, bounded maxima). Classify direction
from the **connected mailbox identity**, including confirmed send-as aliases,
not only the app member email. Outbound Vanquish/fund presentation, investor
deck/one-pager, PPM/LPA/subscription/side letter, investor update/fund overview
and track record signals can identify external LPs. Calendar Vanquish intro,
LP call/fund presentation/reunión inversionista/coffee con LP signals require
external attendees. Inbound founder pitch decks belong to company scouting.
Replies only strengthen LP evidence when linked to qualifying outbound context.
Known Company/Deal domains require strong investor-specific signals; internal,
ignored, automated and unrelated participants are excluded. Confidence labels
are rule-derived, explainable evidence, not probabilities or an LLM decision.

Persist signal codes, counts, dates and direction, plus bounded contact data.
Raw subjects/titles and filenames require explicit **LP** metadata sharing
consent, default off; ordinary CRM subject sharing is not a blanket grant.
Bodies/attachment bytes are never stored for classification. Manual/browser
and durable scans share one pure classifier and transactional persistence.
Tests include founder-to-fund pitch, external-to-external thread, CC-only
recipient, internal account, ignored domain, existing Company, explicit LP
exception, multilingual terms, revoked permission and terminal suggestions.

Separate firm LP identity from personal board cards. Reuse `investors` for
protected canonical identity, extend its Company link without changing existing
positions, and model funds with `fundraising_funds` linked to `legal_entities`
when legally appropriate. Create `lp_commitments` unique by LP/fund plus
currency, amount, date and explicit status; `lp_pipeline_entries` and immutable
stage history track prospect→contacted→meeting→interest→soft-circle→committed→
closed/lost, loss reason and time in stage. Personal editable board lists stay
independent of this firm pipeline. Add board-card canonical links through an
explicit promotion operation, preserving private note ownership.

Extend `capital_events` additively with fund/commitment and normalized
call/distribution semantics, retaining all historical wire/subscription types;
do not assume every wire is a capital call/distribution. Store contact/report
preferences separately from cash flows, and co-investment intent separately
from a funded position. LP 360 joins only authorized identity, shared opt-in
activity, tasks, files and Portfolio-only commitments. Documents+Portfolio
are both required for investor/SPV files. No private mailbox fetch for teammates.

Portal design must specify an external identity→Investor access mapping,
separate member/portal authorization, investor-specific positions and
Investor→SPV files only, expiry/revocation/audit and short-lived download links.
No portal schema, auth flow or public position endpoint before approval.

### Phase 3 — reporting and fund metrics

Exports use bounded keyset pagination with stable ordering, current RLS and
server permission checks on every batch. Escape spreadsheet formula prefixes,
label currency/timezone and never export private board/mailbox fields through
shared routes. Concurrent edits mean exports are not an accounting snapshot
unless a snapshot contract is explicitly implemented. Build invoker/RLS SQL
aggregates for Overview with explicit restricted-Deal filtering; cap inputs,
time ranges and response sizes. Measure representative selective and broad
queries using EXPLAIN ANALYZE with 20,000 synthetic rows, no forced-index trick.

Weekly reports are explicit opt-in, sent only to the active subscribing member,
checked again at dispatch. Queues store references, not immutable copies of
revoked private data. Sending requires the Phase 5 delivery ambiguity contract;
before that contract is ready, generate/download reports and leave dispatch
disabled. PDF generation is local or deferred; no external rendering provider.

Cash flows use explicit signed, dated, currency-consistent meanings:
capital called/paid is distinct from commitment; DPI = distributions/paid-in;
TVPI = (distributions + dated residual NAV)/paid-in. XIRR solves
`sum(CF_i / (1+r)^((date_i-date_0)/365)) = 0` with contributions negative and
distributions/final NAV positive. Missing NAV, zero denominator, mixed
currencies, invalid dates, no root/multiple roots or missing reconciled data
produce an unavailable/ambiguous result, never zero or invented return. Show
as-of date, gross/net basis and reconciliation warning from open-decisions.md.
Known cases, multiple-root cases and Portfolio-denied callers need tests.

### Phase 4 — relationships

Version a deterministic recency/frequency/reciprocity/meeting scoring formula;
show evidence and its window. Daily history alone cannot prove reciprocity,
so add direction aggregates only with an explicit consented contract; do not
invent that dimension from today's rows. Only share existence/date of contact.
Bound introductions (proposed three hops, 500 visited nodes, fixed time window,
result limit and statement timeout), with every intermediate node visible to
the caller. Never leak hidden Deals, private board notes or withheld activity.

### Phase 5 — Gmail and Calendar

Use separate purpose-bound scheduled-send jobs; do not expand the read-sync
worker into a generic email sender. Confirmation captures final recipients,
content/attachment revision, alias and time. Recheck membership, connection,
scopes and cancellation before dispatch. Store scheduled payload encrypted in
a private owner-only store with deletion/expiry, if explicitly approved; this
is a new mail-content privacy decision, not an exception silently granted by
this roadmap. Until then, provider-native scheduling feasibility/design or
disabled queue interface only. Never use shared CRM tables for message bodies.

Model pending/claimed/cancelled/sent/uncertain delivery. Google send uncertainty
goes to review, without automatic retry; retrying a read job is unrelated.
Aliases must be Google's verified send-as choices. Complete forwarding sanitizes
HTML and preserves verified attachment references; chunked uploads have strict
byte/file/time budgets, ownership, cleanup and no resumable cross-user URLs.
Push refresh is a wake-up/invalidation signal, not a cache of private bodies.

Calendar series editing requires explicit occurrence/whole-series choice,
validated recurrence rules, actual provider ACL/scope and If-Match. Drag/resize
has keyboard/select alternatives and confirms changed dates/guest delivery.
RSVP/free-busy reads and writes remain caller-scoped, bounded by calendars and
time range. Tasks overlay is a view, not automatic event creation. No silent
retry of mutations or real-account test writes.

### Phase 6 — customization

Proposed `custom_field_definitions` (Admin, object/type/options/version) and
typed `custom_field_values` with authorized object identity and audited edits.
Validate types in Postgres as well as server code; hidden records/Portfolio LP
values must not leak through shared definitions or filters. Avoid unconstrained
JSON becoming an executable filter/query language. Extend `saved_views.filters`
with a versioned, allowlisted spec for column order, sorting, grouping and
table/Kanban; retain owner-only edits and source-record ACLs. Templates create
checklists/tasks transactionally and never move Deal stage through independent
boards or bypass a stage requirement.

### Phase 7 — files

Local OCR interface defaults off (`DOCUMENT_OCR_ENABLED=false`, server-only),
with worker CPU/memory/page/time/byte budgets, language pack choice, retention
and hosting cost documented before activation. A cloud provider is a separate
owner decision. Retained `document_file_versions` use immutable private object
paths/checksums, parent document ACLs, retention status and audit. Restoring
creates a new current version; never overwrites an old binary. Download/restore
rechecks current access; document purge must include retained objects according
to the approved retention policy. Drive history is not claimed as locally
archived unless its bytes were captured with authorized read access.

Semantic search remains an interface/design with a default-off server flag;
no embedding migration/job/API call until local vs provider, disclosure, cost,
deletion and reindexing are decided. Retrieval must apply the same ACL before
and after ranking, including investor documents and revoked access.

### Phase 8 — bounded external surfaces and mobile

Public founder intake uses a purpose-specific unauthenticated route, a private
review-only queue, strict schemas/size caps, spam/rate limits and no internal
search/IDs. Approval is transactional; submission never creates a Deal directly.
Decide challenge provider/data disclosure before enabling third-party CAPTCHA.
Co-investor/syndicate links reuse Company/Person identities and protect Deal
restrictions; confidential amounts/documents remain Portfolio data.

Scoped API credentials are hashed, revocable, expiring, audited and tied to
an active authorized principal; no service-role substitution. Signed webhook
outbox has event IDs, HMAC timestamp/body signatures, retry budgets and
delivery audit. Recheck scope at dispatch, minimize payloads and prevent SSRF
(private/link-local addresses, DNS rebinding, redirects). A configured outbound
destination is an explicit data-sharing decision; disabled by default.

Audit every main screen at 390px with synthetic authorized/denied users, touch,
keyboard, modal focus and reduced motion. PWA is optional: installation without
caching authenticated HTML/API/attachments or credentials is preferred. If
offline cache guarantees cannot be proved, deliver responsive UI without PWA.

## Proposed authorization model

| Resource/operation | Required access | Machine boundary |
| --- | --- | --- |
| LP suggestions and scan settings | Active owner + new `lp_scouting`; Admin manages permission/keywords, not private suggestions | Lease/purpose/member consent plus current permission; no direct table access |
| Canonical LP/funds/commitments/capital events and financial reports | Active member + `portfolio` | Report role has only bounded RPCs for opted-in active recipient; no general table reads/sends |
| LP-linked documents/file versions | `documents` **and** `portfolio`, plus current parent/source ACL | Explicit document job/lease, no global bucket read |
| Firm LP prospect communication view | Authorized CRM Person/Company, published opt-in metadata only | Independent consent checks; no teammate mailbox tokens |
| Relationship history/graph | Active member, consented publication; owner-only settings/provenance | `vanquish_worker` purpose-bound RPCs, no browser credential exposure |
| Custom-field definitions/templates | Admin writes; member reads only appropriate object schema | No implicit machine grant |
| Public founder submission | Narrow validated anonymous submission only; internal review by authorized member | Separate rate-limited capability, not member or worker role |
| API/webhooks | Explicit principal/scopes + source-record permissions; destination opt-in | Separate minimum role/capability; revocation at execution |

Any SECURITY DEFINER RPC uses `set search_path=''`, qualified names and explicit
revoke/grant for PUBLIC, anon and authenticated; check permission, ownership,
parent ACL, current membership and transaction invariants internally. Prefer
invoker aggregates and `security_invoker` views. Tests must probe RPCs directly,
not just confirm hidden controls. No existing permission grants are widened.

## Decisions that must remain open

Record each implementation's decision/options/recommendation in
`docs/open-decisions.md` before blocking activation; Phase 0 does not change
those decisions or implicitly approve them.

| Decision | Options and recommendation | Safe behavior pending decision |
| --- | --- | --- |
| Shared LP taxonomy/promotion | Independent firm pipeline with explicit private-board links; recommend keeping personal lists private and editable | No publication of private notes or inferred commitment |
| Fund and cash-flow accounting | Legal entity/fund linkage, actual paid-in vs called, gross/net and NAV basis; recommend explicit classified flows and currency-specific metrics | No conversion of legacy wires; unavailable unreconciled metrics |
| LP evidence consent | Separate subject/title/filename option; recommend off by default | Signal codes/date/direction only |
| External LP portal | Separate auth/principal→Investor mapping vs external member accounts; recommend separate authorization surface | Design only, no implementation without explicit approval |
| Scheduling payload storage | Provider-native feasibility vs encrypted private queued MIME; recommend no shared body persistence and a separately approved private retention contract | No scheduled delivery/body store |
| OCR/semantic/enrichment provider | Local worker resources vs external disclosure/provider/cost; recommend bounded local OCR first, semantic interface only | Flags off, no contact/file data sent to vendors |
| Binary retention | Duration/legal hold/quota/purge ownership and Drive copy rules | Version capture off until retention approved |
| Webhook destination/challenge provider | Explicit approved recipient/service and minimized payload vs local-only workflow | Outbound delivery and external CAPTCHA off |
| PWA | Install-only/no private caches vs sensitive offline caching | Responsive web app; no sensitive caching |

## Verification and owner activation checklist

Before every push run lint, `tsc --noEmit`, Vitest, production build and the
**full CI SQL sequence on disposable Postgres**. SQL suites raise exceptions
on failure, cover anon/nonmember/deactivated/permissionless callers, owner
isolation, restricted parents, revoked consent/leases and rollback/idempotence.
Register all new SQL files explicitly in contextual-comments.yml; verify
combined SQL matches the ordered migration sources, including role prerequisites.
Review the diff for secrets/private input, definer grants, direct-table bypasses,
unbounded requests, stale-consent races and unintended provider calls.

For new UI, test Chromium 1440px/390px with synthetic data, keyboard, touch and
reduced motion and inspect screenshots. State which flows are synthetic.
Provider mocks do not prove Google OAuth, delivery, Pub/Sub or scheduler
rotation. Each PR states exact check results and unverified connected flows.

Owner activation, **not performed by implementation**:

1. Review the phase's exact PR/CI head, prerequisites and decisions; merge manually.
2. Back up the target, inspect destructive statements, apply ordered combined
   SQL manually, and verify schema readiness. Preview may share production DB;
   it is never a disposable test target.
3. Set reviewed server-only flags/credentials through the correct secret manager;
   give minimum scopes, issue renewable role JWTs, keep AI/provider flags off.
4. Use agreed disposable Google data/recipients only after explicit confirmation
   for each mutation; verify permissions, opt-out, withdrawal and failure handling.
5. Activate only consented members and monitor last success/dead jobs/budgets.
   On failure pause scheduler/flags, invalidate leases and revoke grants as needed;
   do not drop protected data or restore anon policies as a rollback shortcut.

## Exclusions

No paid enrichment integration (Apollo/Clearbit/People Data Labs), no Vanquish
AI model, no automatic production/preview migrations, no merge of these draft
phases, no real Google mutations or third-party data disclosure. This roadmap
does not include private ledgers, contact CSVs or private Drive links.
