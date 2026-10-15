# Phase 4: relationship intelligence

This phase is additive to daily relationship history. It changes no ingestion, mailbox scopes, worker identity/capabilities, reporting behavior, LP data or existing history. Network remains its existing UI when the owner flag is off. No provider request or external rendering service is introduced.

## Evidence and deterministic score

The **single** implementation is TypeScript `relationshipScore` in `src/lib/relationships/intelligence.ts`. Invoker SQL returns authorized aggregates, never a second scoring formula. Dates use `occurred_on`, not local timestamps or message counts.

Version **v1**, 180 UTC dates `[asOf − 179, asOf]`:

| Dimension | Points |
| --- | --- |
| Recency, age 0–7 / 8–30 / 31–90 / 91–179 days | 50 / 40 / 25 / 10 |
| Frequency: distinct contact dates across email and meeting | `3 × min(days, 10)` |
| Meetings: distinct dates with meeting existence | `5 × min(meetingDays, 4)` |

Maximum 100. One recent email day scores 53. Four dates, one meeting date, last contact 15 days ago scores 57. Same-date email and meeting count as one contact day. Multiple members are separate edges, never summed into an invented personal relationship. Empty windows, future/invalid dates or invalid aggregates have **no available score**, never zero. SQL's typed dates reject invalid input; future and infinite dates are outside the window. TypeScript independently rejects malformed dates and aggregates. Reciprocity is always unavailable.

Every strength shows date of cutoff, UTC window, distinct days, last date, meeting dates and version. A partial graph labels scores/evidence as lower bounds; a missed path or empty budgeted result does not prove absence. Path ranking is direct routes first, then weakest-edge score descending, then stable visible IDs. The aggregate score does not recommend contacting anyone automatically.

## Authorization and consent

The owner-controlled singleton `private.relationship_intelligence_configuration.enabled` defaults false. The new canonical `member_permissions.permission = 'relationship_intelligence'` defaults absent. A member needs both. Admin status alone does not grant it. Permission vocabulary is extended without replacing the existing Admin RPC or switches; grant/revoke initially uses owner SQL.

All public Phase 4 data readers are `SECURITY INVOKER`. They use current RLS on People, Companies and daily history. Archived people and deleted/unavailable company parents are excluded before ordering or budgets. `can_access_record(company_id, NULL)` checks parent access; a materialized visible-company set prevents repeating it for every daily history row. It is a **correlated** scalar subquery, once per company, not an uncorrelated InitPlan. Row-independent existing RLS member/machine functions use scalar SELECT InitPlans. No Deals, deal_people, private board fields, CRM/provider events, LP evidence, message addresses, subjects, titles, bodies or attendees are queried. Consequently a restricted Deal cannot add, remove or order an edge.

Two small private definers have narrowly scoped grants and empty search paths. The access helper reads/locks only caller membership, permission and configuration. The publisher helper reads/locks only active member identities with `relationship_sync.enabled = true`; history/CRM data never passes through a definer. This helper is necessary because consent rows are own-only under RLS. Membership/permission/config/consent SHARE locks persist until the RPC transaction ends: disabling consent or deactivating a contributor serializes with an in-flight calculation. Queries begun after revocation cannot include retained history. Historical data need not be deleted to disappear from new Phase 4 calculations. Locks are bounded to at most 501 publisher candidates, including an overflow sentinel.

All new functions reject machines, even though they authenticate with the same Auth role. Both new private tables have RLS, no Auth grants, and restrictive `machine_identity_isolation` with `(select not private.is_machine_identity())` in USING and WITH CHECK. No public definer or worker RPC is added. No change to `private.machine_identities`.

Member labels use managed display names (generic fallback), opaque member keys and person IDs; no member-email fallback is sent to the new UI. The private consent helper's internal email join keys are not included in public RPC responses. Already displayed evidence cannot be retroactively erased from a person's memory; no graph is persisted, browser storage is unused, actions are uncached, selection changes/refocus clear displayed results, and every calculation revalidates live authorization. A page refresh updates the selector roster. No sending, acceptance or CRM publication occurs.

## Bounded graph and partial results

The graph is bipartite: **member ↔ visible person**. From a selected sharing member to a target, supported paths have one or three edges. Companies are authorized parents/record contexts, not inferred social edges. Four or more hops are never explored.

SQL first bounds visible root contacts and target members (500 plus overflow sentinel). It selects only edges incident to the target, to the root's selected contacts, or connecting those contacts to target members. It prioritizes target edges, root edges and bridge edges, then authorized recency and stable IDs. At most 10,001 daily rows are inspected as candidate input; 10,000 are aggregated. At most 500 distinct graph nodes and 2,000 edges are admitted; response labels are capped at 160 characters. Both overflow and skipped nodes mark the response partial. The finite UI walk uses only that authorized graph and returns at most 20 routes, marking truncation partial. No hidden candidate count or omitted identity is returned. A root with consent off is unavailable, indistinguishable from an unknown root.

The endpoint's function-level `SET statement_timeout = '2s'` is [hoisted by PostgREST](https://docs.postgrest.org/en/v13/references/transactions.html#hoisted-function-settings) before its SELECT. **For direct SQL, set the timer before calling the function**:

```sql
begin;
set local statement_timeout = '2s';
-- SELECT public.relationship_intelligence_graph(...);
rollback;
```

Changing statement_timeout inside an already running function alone would not arm the timer for that statement. The function also uses a 1.5-second wall-clock soft deadline, checked during graph assembly. A caught SQL cancellation returns partial evidence accumulated so far; cancellation outside the handler maps to explicit partial with no buffered evidence. Permission/consent failure maps to unavailable, not an empty result. A 3.5-second server transport deadline fails unavailable. Production verification must confirm PostgREST hoists `statement_timeout`; no role-wide setting is changed. Lock waits are covered by the same SQL deadline. No claim is made that PL/pgSQL can interrupt every subquery with the soft clock alone.

500 admitted graph nodes is not a promise of 500 physical database reads. Candidate authorization and aggregation can scan larger tables. Broad aggregates and actual capped endpoint timings, including spills, are documented in [query plans](relationships-query-plans.md). No index-forcing settings are used.

## UI and tests

Flag on: Network searches at most 50 visible target choices; use a person record (`/people/<uuid>`) for another target. Company records show the same selector for up to 50 associated people; company evidence is per-person, never summed into company strength. Person records show a fixed target. Sharing-member choices cap at 500, with a partial-selection notice. SelectMenu, Checkbox and vq-card-static are reused. Strength evidence remains visible even if path evidence is collapsed. Ready, empty, unavailable and partial are distinct. Only explicit Calculate dispatches a query; changing a selector discards old results and does not scan automatically.

`supabase/tests/relationship_intelligence.sql` raises on authorization, consent, hidden-node/parent, hidden-noise ordering/counting, budget, date/window, machine and invoker violations. Forward migration and rollback each run twice. Snapshot assertions preserve the previous permission CHECK and history count; Auth/LP/reporting business suites run again after rollback. TS tests cover known scores, date validation, ties, member separation, result caps and action-time revocation. Chromium harness `scripts/check_relationship_ui.mjs` renders the **actual component and CSS**, with only synthetic fixtures/stubbed server actions, at 1440/390px, keyboard/touch/reduced motion and all result states. It is not a signed-in production/browser-to-Supabase test.

Local full-chain validation uses disposable PGlite (PostgreSQL compiled to WASM); CI runs the exact same ordered SQL files on native PostgreSQL 16. Run `TZ=UTC node scripts/check_relationship_sql.mjs` after installing the test-only PGlite runtime under `/tmp/crm-sql`. It extracts the workflow order, includes earlier phases, storage-role simulation, idempotence and rollback. No remote database is contacted. See the harness header for runtime installation. SQL tests and benchmarks must **never** be pasted into Supabase's production or preview editor.

## Verification history

Local checks exposed three harness/build issues before publication: an obsolete pre-Auth browser-write regression was replaced by the existing Auth business suite; a corrupted generated Turbopack cache was removed and the build rerun; UI selectors were corrected to use accessible labels, and the harness now loads only active Network CSS from the build manifest instead of mixing stale CSS chunks. The reduced-motion assertion checks that the arrow's effective transition property is none. The new panel suppresses descendant animations/transitions under reduced motion without changing shared controls. All final application, full-chain SQL and both-width synthetic UI checks are rerun before updating the PR. Native CI results and exact benchmark source commits are recorded in the query-plan document.

## Owner activation and pause/rollback

Nothing in this PR applies SQL or enables a flag remotely. Preview shares production: a preview is not a disposable migration target.

1. Review the draft PR and [open decisions](relationships-open-decisions.md). Confirm main includes Phase 3 and the migration source/combined files match via `python3 scripts/check_phase_sql.py`. Keep Phase 4 off.
2. **SQL:** the owner runs the whole `supabase/phase-sql/phase-4-relationships.sql` transaction after `20261014184050`. It preserves live history and permissions, adds indexes, restores no browser writes and leaves the flag false. Any statement failure rolls back the complete transaction. Confirm the singleton is false and the public graph function is invoker with `statement_timeout=2s` in `pg_proc.proconfig`. Refresh PostgREST's schema cache if the RPC is not yet recognized.
3. **Merge/deploy:** after CI is green at the reviewed exact commit, merge and deploy the app. Flag-off Network stays unchanged. Do not enable in a preview to test a shared production database.
4. **Permission:** owner grants `relationship_intelligence` in `public.member_permissions` only to a reviewed, active member. Use that member's existing canonical email privately in the SQL editor, not in public docs or CI. Example with a bind parameter, not a real address:

   ```sql
   insert into public.member_permissions(email, permission)
   values (:reviewed_member_email, 'relationship_intelligence') on conflict do nothing;
   ```

   `:reviewed_member_email` is a client bind placeholder; replace it privately when using the SQL editor, which does not bind this syntax. This does not grant sharing consent or any Portfolio/Documents/LP permission.
5. **Flag:** after explicit owner approval, `update private.relationship_intelligence_configuration set enabled=true where singleton;`. Sharing still depends on each member's existing Settings consent. No worker flag is involved.
6. **Test:** use the owner's real account to verify allowed/denied access, the existing history's actual date, evidence, empty states and removal after consent off. One production row cannot validate multi-hop accuracy or scale; do not fabricate more. Verify existing `person_last_interaction` still shows the team's authorized activity independently. Confirm PostgREST's hoisted timeout configuration; compare request behavior with the documented deadlines. Inspect keyboard/mobile without publishing production screenshots.

**Pause:** set `enabled=false`, refresh open pages. New Phase 4 calls are denied; Network returns its pre-Phase-4 UI. Revoke an individual by deleting only their `relationship_intelligence` permission. Stop consent contribution through existing Settings. No worker interruption is needed. Completed UI responses are not recalled retroactively.

**Schema rollback:** first pause and deploy the prior app if necessary, then owner reviews/runs the whole `supabase/phase-sql/phase-4-rollback.sql`. It deletes only Phase 4 grants, restores the exact baseline permission CHECK, and drops only Phase 4 APIs/configuration/baseline/indexes; every DELETE/DROP is marked. It is idempotent, transactional and leaves daily history, consent, earlier RPC versions, Phase 1/2/3 schemas and worker privileges intact. Pausing is sufficient for an operational incident; schema rollback is optional and must be reviewed against any later migrations before execution.
