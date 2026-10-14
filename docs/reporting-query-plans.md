# Phase 3 query plans — synthetic only

## Native PostgreSQL 16 CI measurement

Measured at `9d8fadbd0035db8f84c6a3857b3d556ca4f2021e`, native PostgreSQL 16
in [SQL CI run 38621923156](https://github.com/Vanquish-Equity/vanquish-os/actions/runs/38621923156).
The complete migration/test/rollback job passed. Same 20,000 synthetic fixtures,
non-Admin member, RLS, UTC and unmodified planner settings as the local method.

| Query | Execution time | Returned source rows | Natural plan |
| --- | ---: | ---: | --- |
| Selective one UTC date | 60.525 ms | 100 | Bitmap index/heap scan |
| Broad 200-date fixture range | 11058.287 ms | 18000 authorized | Sequential scan |
| Broad RPC including access guard | 11124.390 ms | 1 grouped result | Function scan |

**Known performance limit:** broad queries are about 11 seconds on this shared
CI runner. Existing RLS and the explicit correlated Deal check both execute per
Deal; the independent member/machine predicates execute once. Do not treat the
WASM measurements below as native/production estimates. Overview requests 30
UTC dates; weekly generation requests seven, but large ranges/populations still
need owner latency assessment before activation. This phase preserves all prior
policy/function definitions. Reducing the existing per-Deal authorization cost
requires a separately scoped, permission-equivalence-tested change, never a
privileged aggregate/cache or globally cached answer for different Deal IDs.
No production SLO, timeout configuration or production capacity was verified.

```text
 Limit  (cost=277.59..277.65 rows=3 width=24) (actual time=60.499..60.501 rows=1 loops=1)
   Buffers: shared hit=1435
   InitPlan 2 (returns $1)
     ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.118..0.119 rows=1 loops=1)
   InitPlan 3 (returns $2)
     ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.253..0.253 rows=1 loops=1)
           Buffers: shared hit=7
   ->  GroupAggregate  (cost=277.07..277.13 rows=3 width=24) (actual time=60.498..60.499 rows=1 loops=1)
         Group Key: d.stage_id
         Buffers: shared hit=1435
         ->  Sort  (cost=277.07..277.08 rows=4 width=16) (actual time=60.485..60.489 rows=100 loops=1)
               Sort Key: d.stage_id
               Sort Method: quicksort  Memory: 27kB
               Buffers: shared hit=1435
               ->  Bitmap Heap Scan on deals d  (cost=5.29..277.03 rows=4 width=16) (actual time=1.452..60.444 rows=100 loops=1)
                     Recheck Cond: ((created_at >= '2026-02-02 00:00:00+00'::timestamp with time zone) AND (created_at < '2026-02-03 00:00:00+00'::timestamp with time zone) AND (archived_at IS NULL))
                     Filter: ($1 AND $2 AND private.can_access_deal(id, false) AND (SubPlan 1))
                     Heap Blocks: exact=100
                     Buffers: shared hit=1435
                     ->  Bitmap Index Scan on reporting_deals_created_stage  (cost=0.00..5.29 rows=100 width=0) (actual time=0.041..0.041 rows=100 loops=1)
                           Index Cond: ((created_at >= '2026-02-02 00:00:00+00'::timestamp with time zone) AND (created_at < '2026-02-03 00:00:00+00'::timestamp with time zone))
                           Buffers: shared hit=2
                     SubPlan 1
                       ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.296..0.296 rows=1 loops=100)
                             Buffers: shared hit=600
 Planning:
   Buffers: shared hit=115
 Planning Time: 0.317 ms
 Execution Time: 60.525 ms

 Limit  (cost=10953.28..10959.56 rows=6 width=24) (actual time=11058.259..11058.261 rows=1 loops=1)
   Buffers: shared hit=232349
   InitPlan 2 (returns $1)
     ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.111..0.111 rows=1 loops=1)
   InitPlan 3 (returns $2)
     ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.214..0.214 rows=1 loops=1)
           Buffers: shared hit=1
   ->  GroupAggregate  (cost=10952.76..10959.04 rows=6 width=24) (actual time=11058.258..11058.259 rows=1 loops=1)
         Group Key: d.stage_id
         Buffers: shared hit=232349
         ->  Sort  (cost=10952.76..10954.83 rows=829 width=16) (actual time=11056.358..11057.082 rows=18000 loops=1)
               Sort Key: d.stage_id
               Sort Method: quicksort  Memory: 1190kB
               Buffers: shared hit=232349
               ->  Seq Scan on deals d  (cost=0.00..10912.58 rows=829 width=16) (actual time=1.033..11049.978 rows=18000 loops=1)
                     Filter: ($1 AND $2 AND (archived_at IS NULL) AND (created_at >= '2026-01-01 00:00:00+00'::timestamp with time zone) AND (created_at < '2026-08-01 00:00:00+00'::timestamp with time zone) AND private.can_access_deal(id, false) AND (SubPlan 1))
                     Rows Removed by Filter: 2123
                     Buffers: shared hit=232349
                     SubPlan 1
                       ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.289..0.290 rows=1 loops=18000)
                             Buffers: shared hit=108000
 Planning:
   Buffers: shared hit=2
 Planning Time: 0.128 ms
 Execution Time: 11058.287 ms

 Function Scan on reporting_overview  (cost=0.25..10.25 rows=1000 width=24) (actual time=11124.380..11124.381 rows=1 loops=1)
   Buffers: shared hit=232414
 Planning Time: 0.015 ms
 Execution Time: 11124.390 ms

```

## Local WASM measurement and reproduction

Measured on disposable PostgreSQL 18.6 (PGlite 0.5.10, WASM), after the **full**
CI migration/test sequence restored Phase 1/Auth and Phase 2 and applied Phase 3.
Reproduce with `npm install --prefix /tmp/crm-sql @electric-sql/pglite@0.5.10`
and `node scripts/check_reporting_sql.mjs`. The helper expands the existing CI
shell order; it executes every file, including expected rejection, idempotence,
prior-phase regression and rollback cases. It does not contact Supabase.
The initial native PostgreSQL 16 run stopped on a test-only temp-table ACL
before reaching this benchmark; that fixture ACL and local RESET ROLE emulation
were corrected. Native PostgreSQL 16 runs the same SQL in CI; native plans are printed by
`supabase/tests/reporting_explain.sql`. WASM times below are development
observations, **not** production latency or capacity claims.

Fixture: 20,000 newly inserted fictional Deals under one synthetic Company,
created across 200 dates, one real fixture stage, 10% restricted. Historical CI
fixtures also exist; all records are synthetic. Authenticated benchmark member
has no Admin permission and no restricted-Deal ACL. RLS is enabled normally;
statistics are refreshed with ANALYZE. No index/scan/cost/session-role trick
changes the planner. UTC affects labels/date boundaries only.

Three EXPLAIN (ANALYZE, BUFFERS) statements: selective one-date grouped SELECT,
broad all-fixture grouped SELECT, then the broad RPC including its guard. The
SELECTs reproduce the aggregate body with concrete range arguments and no stage
filter. A selective date naturally chooses the new date/stage bitmap index;
the broad query naturally chooses a sequential scan and returns 18,000 visible
Deals. Output is limited to 100 stage groups. Independent member/machine checks
are InitPlans (loops=1); the explicit Deal-ID check is a correlated SubPlan and
must run per visible Deal. Existing Phase 1/2 policy definitions remain unchanged.

Full observed plans, including execution and planning times:

```text
Limit  (cost=277.59..277.65 rows=3 width=24) (actual time=16.091..16.098 rows=1.00 loops=1)
  Buffers: shared hit=1112
  InitPlan 2
    ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.112..0.113 rows=1.00 loops=1)
  InitPlan 3
    ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.089..0.090 rows=1.00 loops=1)
          Buffers: shared hit=2
  ->  GroupAggregate  (cost=277.07..277.13 rows=3 width=24) (actual time=16.087..16.091 rows=1.00 loops=1)
        Group Key: d.stage_id
        Buffers: shared hit=1112
        ->  Sort  (cost=277.07..277.08 rows=4 width=16) (actual time=16.019..16.047 rows=100.00 loops=1)
              Sort Key: d.stage_id
              Sort Method: quicksort  Memory: 17kB
              Buffers: shared hit=1112
              ->  Bitmap Heap Scan on deals d  (cost=5.29..277.03 rows=4 width=16) (actual time=1.217..15.910 rows=100.00 loops=1)
                    Recheck Cond: ((created_at >= '2026-02-02 00:00:00+00'::timestamp with time zone) AND (created_at < '2026-02-03 00:00:00+00'::timestamp with time zone) AND (archived_at IS NULL))
                    Filter: ((InitPlan 2).col1 AND (InitPlan 3).col1 AND private.can_access_deal(id, false) AND (SubPlan 1))
                    Heap Blocks: exact=100
                    Buffers: shared hit=1112
                    ->  Bitmap Index Scan on reporting_deals_created_stage  (cost=0.00..5.29 rows=100 width=0) (actual time=0.018..0.018 rows=100.00 loops=1)
                          Index Cond: ((created_at >= '2026-02-02 00:00:00+00'::timestamp with time zone) AND (created_at < '2026-02-03 00:00:00+00'::timestamp with time zone))
                          Index Searches: 1
                          Buffers: shared hit=2
                    SubPlan 1
                      ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.061..0.063 rows=1.00 loops=100)
                            Buffers: shared hit=500
Planning:
  Buffers: shared hit=107
Planning Time: 5.752 ms
Execution Time: 16.247 ms
Limit  (cost=10953.50..10959.80 rows=5 width=24) (actual time=1417.896..1417.902 rows=1.00 loops=1)
  Buffers: shared hit=194350
  InitPlan 2
    ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.043..0.045 rows=1.00 loops=1)
  InitPlan 3
    ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.545..0.547 rows=1.00 loops=1)
          Buffers: shared hit=2
  ->  GroupAggregate  (cost=10952.98..10959.28 rows=5 width=24) (actual time=1417.892..1417.895 rows=1.00 loops=1)
        Group Key: d.stage_id
        Buffers: shared hit=194350
        ->  Sort  (cost=10952.98..10955.07 rows=833 width=16) (actual time=1411.110..1413.916 rows=18000.00 loops=1)
              Sort Key: d.stage_id
              Sort Method: quicksort  Memory: 513kB
              Buffers: shared hit=194350
              ->  Seq Scan on deals d  (cost=0.00..10912.58 rows=833 width=16) (actual time=1.394..1403.968 rows=18000.00 loops=1)
                    Filter: ((InitPlan 2).col1 AND (InitPlan 3).col1 AND (archived_at IS NULL) AND (created_at >= '2026-01-01 00:00:00+00'::timestamp with time zone) AND (created_at < '2026-08-01 00:00:00+00'::timestamp with time zone) AND private.can_access_deal(id, false) AND (SubPlan 1))
                    Rows Removed by Filter: 2123
                    Buffers: shared hit=194350
                    SubPlan 1
                      ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.035..0.035 rows=1.00 loops=18000)
                            Buffers: shared hit=90000
Planning:
  Buffers: shared hit=2
Planning Time: 0.500 ms
Execution Time: 1417.975 ms
Function Scan on reporting_overview  (cost=0.25..10.25 rows=1000 width=24) (actual time=1993.653..1993.655 rows=1.00 loops=1)
  Buffers: shared hit=194357
Planning Time: 0.056 ms
Execution Time: 1993.681 ms
```

The broad scan remains proportional to authorized rows and existing restricted-
Deal policy cost. This phase adds no cross-member aggregate cache or privileged
materialized view. Large-fund/large-pipeline performance needs owner measurement;
never bypass RLS or force an index to improve a reported benchmark.
