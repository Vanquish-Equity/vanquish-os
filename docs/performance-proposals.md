# Performance proposals (not applied)

These came out of the render-waterfall review (PR `agent/perf-render-waterfalls`).
They need SQL, plan or project settings changes, so they are written down for
the owner to decide. None of them is applied by that PR. All figures from the
round-trip test are simulated (15 ms per database call, 120 ms per Google call)
and use synthetic data only.

## 1. Per-row access function on deals (needs SQL, highest database impact)

`supabase/migrations/20261008162841_resolution_search_and_deal_access.sql:26`
adds the restrictive policy `restricted_deals_read ... using (private.can_access_deal(id))`.
The function in force today is the later redefinition in
`supabase/migrations/20261012175553_auth_service_worker.sql:105-108`, which calls
`private.deal_access_for(p_deal, <email>, p_write)` (the machine-identity check
replaced the earlier `auth.role()` test).
The function is `security definer`, so Postgres cannot inline it and calls it
once per candidate deal row. Each call reads `private.is_machine_identity()`,
`private.current_email()`, and inside `deal_access_for` `app_members`, `deals`,
`member_permissions` and `deal_access_members`. Companies, Pipeline, Home and
Overview all read deals (Companies reads them nested under every company), so
the cost is paid on every one of those pages.

Proposal: evaluate the per-request values once per query instead of once per
row, for example `(select private.current_email())` and a single admin check,
so only `restricted` deals reach the per-row lookup:
`using (not restricted or (select private.is_admin()) or exists (...deal_access_members...))`.

Caution: restructuring the policy this way can change who may see a deal (the
current function also requires an active member, honours the machine identity
used by the sync worker, and treats `p_write` separately). Review it as its own
migration with SQL access tests that cover: an ordinary member, an admin, a
restricted deal, and a member assigned to a restricted deal (viewer and editor),
plus the worker identity, before applying.

Not measured: Postgres could not be started in the review environment (the
`runuser` command was blocked by a security control, and was not worked
around). Run before applying:

```sql
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<synthetic uuid>","email":"member@synthetic.test","role":"authenticated"}', true);
explain (analyze, buffers) select id from public.deals;
explain (analyze, buffers)
  select id, deals(id) from public.companies where deleted_at is null;
```

Look for `SubPlan` / `Function Scan` loops and compare execution time with
`2000 companies / 3000 deals` of synthetic rows, before and after.

## 2. Index and policy advisories

Supabase reported two foreign keys without an index, two unused indexes and two
duplicate indexes. Add the foreign key indexes and drop the duplicates in one
migration after checking the advisor output (`get_advisors` for performance) and
the `EXPLAIN` of the pages that use those keys. Policy helpers called straight
from `using (...)` should be wrapped as `(select ...)` where the argument does
not change per row, so Postgres evaluates them once (an InitPlan).

## 3. Two session checks per request

`src/proxy.ts` calls `auth.getClaims()` and `getAccess()` calls it again in the
server render (2 Auth calls per request, shown in every row of the test). With
asymmetric JWT signing keys, `getClaims()` verifies locally against cached keys
and costs no network call; with the legacy shared secret it falls back to a
network call to Auth. Check the project's JWT signing keys setting in Supabase.
If it is the legacy secret, migrating to asymmetric keys removes up to two
network calls from the start of every request. Dashboard setting, no code.

## 4. Combine the state RPCs (needs SQL)

`relationship_intelligence_state`, `custom_fields_state` and
`customization_state` are three RPCs per page render (the first two are in the
layout, the third in some pages). One `app_flags()` RPC that returns all three
would save two trips per request. Requires a new SQL function, so it is only
proposed.

## 5. Platform

- Vercel Hobby cold starts are likely the largest part of a first load after
  idle time and cannot be measured without production access. Options: keep the
  function warm with a scheduled ping, or move to Pro (longer-lived instances,
  bytecode caching).
- Cache Components (`cacheComponents: true`) would let the shell be prerendered
  and streamed from the edge, but it is a global switch that changes how every
  page that reads cookies behaves. Not enabled here; evaluate on its own branch.
  No data that depends on the signed-in member is cached across requests in this PR.
- `next.config.ts` sets `staleTimes.dynamic = 0`, so every sidebar navigation
  re-runs the page. Raising it (for example to 30 seconds) makes back/forward
  and repeat visits instant but can show a page that is up to that old. Product
  decision.
- Supabase browser client (about 260 KB) is loaded on every route for the
  unread counters. Loading the realtime subscription after first paint would
  save more JavaScript than anything else left.
