# Phase 6B view query plans

Native **PostgreSQL 16.15**, fresh local UTF-8 cluster, default planner/JIT/index
settings. `supabase/tests/views_templates_explain.sql` is reproducible in the full
CI chain via `scripts/check_views_templates_sql.py`; no remote Supabase database.
No index/plan forcing or RLS bypass during measurement. The sandbox UID mapping
requires a local filesystem UID shim for initdb/postmaster; PostgreSQL SQL roles,
permissions and RLS are unmodified. CI independently uses its normal postgres:16
service. Absolute times depend on this shared host/cache/JIT and are not an SLA.

The synthetic dataset follows 6A's scale: **20,000 People × 10 definitions =
200,000 typed values**. One definition is single_select for Kanban and nine are
numeric. Its rare option has 20 records, common 16,000, and “No value” 3,980.
Owner-only bulk loading temporarily suspends only CF value validation/audit
triggers, retains CHECKs, and restores both before ANALYZE and every RLS query.
Measurements run as a regular active member, never as the loading owner. The
whole fixture transaction rolls back. No real records/identities are present.

| Query | Native execution |
| --- | --- |
| RPC rare option (20 authorized rows) | 169.029 ms |
| RPC common option (25 plus sentinel) | 160.459 ms |
| RPC No value (25 plus sentinel) | 156.712 ms |
| RPC broad table (100 plus sentinel) | 151.217 ms |
| Direct selective diagnostic (20 rows) | 491.541 ms |
| Direct broad diagnostic (count only, not an app endpoint) | 514.598 ms |

The first four plans show the RPC boundary rather than internal joins. The last
two expose parent RLS work. The selective diagnostic still examines a definition's
20,000 values and performs parent authorization checks; JIT may dominate a direct
plan. A response limit does **not** bound examined rows, and broad/No value queries
can scan/sort many records. These plans do not prove hosted or concurrent latency.

Budgets stay at one CF/query, 25 records/column (+1 sentinel), four column RPCs/page,
100 table records (+1), at most 51 shared-schema buckets and 50 catalog views. The
initial page reuses its first bucket response, so it does not issue a fifth RPC.
Moves make one mutation RPC then at most four read RPCs. Column pagination is
explicit; record lists are truncated, with a partial notice and no hidden total.
There is no multi-field expression engine, provider lookup, unbounded export or
claim of constant scan work. Widen budgets only after owner-reviewed native plans.

## Complete native EXPLAIN (ANALYZE, BUFFERS)

### RPC rare option (20 authorized rows)

```text
Result  (cost=0.00..0.26 rows=1 width=32) (actual time=169.024..169.025 rows=1 loops=1)
  Buffers: shared hit=182407 dirtied=2
Planning Time: 0.036 ms
Execution Time: 169.029 ms
```

### RPC common option (25 plus sentinel)

```text
Result  (cost=0.00..0.26 rows=1 width=32) (actual time=160.454..160.454 rows=1 loops=1)
  Buffers: shared hit=180984
Planning Time: 0.035 ms
Execution Time: 160.459 ms
```

### RPC No value (25 plus sentinel)

```text
Result  (cost=0.00..0.26 rows=1 width=32) (actual time=156.706..156.707 rows=1 loops=1)
  Buffers: shared hit=180973
Planning Time: 0.049 ms
Execution Time: 156.712 ms
```

### RPC broad table (100 plus sentinel)

```text
Result  (cost=0.00..0.26 rows=1 width=32) (actual time=151.212..151.212 rows=1 loops=1)
  Buffers: shared hit=180969
Planning Time: 0.033 ms
Execution Time: 151.217 ms
```

### Direct selective diagnostic (20 rows)

```text
Limit  (cost=952521.95..952521.96 rows=1 width=44) (actual time=488.275..488.291 rows=20 loops=1)
  Buffers: shared hit=35551
  InitPlan 1 (returns $0)
    ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.098..0.098 rows=1 loops=1)
  InitPlan 2 (returns $1)
    ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.138..0.138 rows=1 loops=1)
          Buffers: shared hit=2
  InitPlan 3 (returns $2)
    ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.466..0.467 rows=1 loops=1)
          Buffers: shared hit=6
  InitPlan 4 (returns $3)
    ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.260..0.260 rows=1 loops=1)
          Buffers: shared hit=4
  ->  Sort  (cost=952520.91..952520.92 rows=1 width=44) (actual time=59.066..59.077 rows=20 loops=1)
        Sort Key: p.name, p.id
        Sort Method: quicksort  Memory: 26kB
        Buffers: shared hit=35551
        ->  Nested Loop  (cost=0.42..952520.90 rows=1 width=44) (actual time=16.731..59.030 rows=20 loops=1)
              Join Filter: (v.person_id = p.id)
              Rows Removed by Join Filter: 209980
              Buffers: shared hit=35551
              ->  Index Scan using custom_field_values_definition_id_record_id_key on custom_field_values v  (cost=0.42..951363.40 rows=1 width=16) (actual time=13.819..23.078 rows=20 loops=1)
                    Index Cond: (definition_id = 'eb22efab-ceb1-d5d1-7753-8218370a5bef'::uuid)
                    Filter: ($2 AND $3 AND (option_value = 'c7af8101-ba57-9e94-a5a2-cb851883933c'::uuid) AND (hashed SubPlan 12) AND (((person_id IS NOT NULL) AND (SubPlan 21)) OR ((company_id IS NOT NULL) AND (hashed SubPlan 38)) OR ((deal_id IS NOT NULL) AND (hashed SubPlan 52))))
                    Rows Removed by Filter: 19980
                    Buffers: shared hit=20189
                    SubPlan 12
                      ->  Seq Scan on custom_field_definitions f  (cost=0.78..1.88 rows=2 width=16) (actual time=12.542..12.548 rows=10 loops=1)
                            Filter: ($9 AND $10 AND ($11 OR (NOT archived)) AND (NOT archived))
                            Buffers: shared hit=6
                            InitPlan 9 (returns $9)
                              ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.247..0.248 rows=1 loops=1)
                            InitPlan 10 (returns $10)
                              ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.255..0.255 rows=1 loops=1)
                                    Buffers: shared hit=4
                            InitPlan 11 (returns $11)
                              ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.202..0.202 rows=1 loops=1)
                                    Buffers: shared hit=1
                    SubPlan 21
                      ->  Index Scan using people_pkey on people p_1  (cost=0.93..17.76 rows=1 width=0) (actual time=0.014..0.014 rows=1 loops=20)
                            Index Cond: (id = v.person_id)
                            Filter: ($19 AND $20 AND (archived_at IS NULL) AND ((primary_organization_id IS NULL) OR (hashed SubPlan 18)))
                            Buffers: shared hit=82
                            InitPlan 19 (returns $19)
                              ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.058..0.058 rows=1 loops=1)
                            InitPlan 20 (returns $20)
                              ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.116..0.116 rows=1 loops=1)
                                    Buffers: shared hit=2
                            SubPlan 18
                              ->  Index Scan using companies_deleted_at_idx on companies c  (cost=0.79..8.81 rows=1 width=16) (never executed)
                                    Index Cond: (deleted_at IS NULL)
                                    Filter: ($16 AND $17)
                                    InitPlan 16 (returns $16)
                                      ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
                                    InitPlan 17 (returns $17)
                                      ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
                    SubPlan 38
                      ->  Index Scan using companies_deleted_at_idx on companies c_1  (cost=0.79..9.07 rows=1 width=16) (never executed)
                            Index Cond: (deleted_at IS NULL)
                            Filter: ($36 AND $37 AND (SubPlan 35))
                            InitPlan 36 (returns $36)
                              ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
                            InitPlan 37 (returns $37)
                              ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
                            SubPlan 35
                              ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
                    SubPlan 52
                      ->  Nested Loop  (cost=1.45..18.27 rows=1 width=16) (never executed)
                            Join Filter: (c_2.id = d.company_id)
                            InitPlan 48 (returns $50)
                              ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
                            InitPlan 49 (returns $51)
                              ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
                            InitPlan 50 (returns $52)
                              ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
                            InitPlan 51 (returns $53)
                              ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
                            ->  Index Scan using reporting_deals_created_stage on deals d  (cost=0.14..8.93 rows=1 width=32) (never executed)
                                  Filter: ($50 AND $51 AND private.can_access_deal(id, false) AND (SubPlan 46) AND (SubPlan 47))
                                  SubPlan 46
                                    ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
                                  SubPlan 47
                                    ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
                            ->  Index Scan using companies_deleted_at_idx on companies c_2  (cost=0.27..8.29 rows=1 width=16) (never executed)
                                  Index Cond: (deleted_at IS NULL)
                                  Filter: ($52 AND $53)
              ->  Seq Scan on people p  (cost=0.00..1095.00 rows=5000 width=44) (actual time=0.552..1.398 rows=10500 loops=20)
                    Filter: ($0 AND $1 AND (archived_at IS NULL))
                    Buffers: shared hit=15362
Planning:
  Buffers: shared hit=24
Planning Time: 0.689 ms
JIT:
  Functions: 134
  Options: Inlining true, Optimization true, Expressions true, Deforming true
  Timing: Generation 3.008 ms, Inlining 42.910 ms, Optimization 216.749 ms, Emission 181.410 ms, Total 444.076 ms
Execution Time: 491.541 ms
```

### Direct broad diagnostic (count only, not an app endpoint)

```text
Aggregate  (cost=952486.83..952486.84 rows=1 width=8) (actual time=510.613..510.626 rows=1 loops=1)
  Buffers: shared hit=101000
  InitPlan 1 (returns $0)
    ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.276..0.277 rows=1 loops=1)
  InitPlan 2 (returns $1)
    ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.178..0.179 rows=1 loops=1)
          Buffers: shared hit=2
  InitPlan 3 (returns $2)
    ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.135..0.136 rows=1 loops=1)
  InitPlan 4 (returns $3)
    ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.290..0.290 rows=1 loops=1)
          Buffers: shared hit=4
  ->  Hash Right Join  (cost=1157.92..952474.27 rows=4606 width=0) (actual time=462.807..510.342 rows=3980 loops=1)
        Hash Cond: (v.person_id = p.id)
        Filter: (v.option_value IS NULL)
        Rows Removed by Filter: 16020
        Buffers: shared hit=101000
        ->  Index Scan using custom_field_values_definition_id_record_id_key on custom_field_values v  (cost=0.42..951313.50 rows=1247 width=32) (actual time=13.118..54.152 rows=20000 loops=1)
              Index Cond: (definition_id = 'eb22efab-ceb1-d5d1-7753-8218370a5bef'::uuid)
              Filter: ($2 AND $3 AND (hashed SubPlan 12) AND (((person_id IS NOT NULL) AND (SubPlan 21)) OR ((company_id IS NOT NULL) AND (hashed SubPlan 38)) OR ((deal_id IS NOT NULL) AND (hashed SubPlan 52))))
              Buffers: shared hit=100103
              SubPlan 12
                ->  Seq Scan on custom_field_definitions f  (cost=0.78..1.88 rows=2 width=16) (actual time=12.303..12.309 rows=10 loops=1)
                      Filter: ($9 AND $10 AND ($11 OR (NOT archived)) AND (NOT archived))
                      Buffers: shared hit=6
                      InitPlan 9 (returns $9)
                        ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.214..0.214 rows=1 loops=1)
                      InitPlan 10 (returns $10)
                        ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.255..0.256 rows=1 loops=1)
                              Buffers: shared hit=4
                      InitPlan 11 (returns $11)
                        ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.153..0.154 rows=1 loops=1)
                              Buffers: shared hit=1
              SubPlan 21
                ->  Index Scan using people_pkey on people p_1  (cost=0.93..17.76 rows=1 width=0) (actual time=0.001..0.001 rows=1 loops=20000)
                      Index Cond: (id = v.person_id)
                      Filter: ($19 AND $20 AND (archived_at IS NULL) AND ((primary_organization_id IS NULL) OR (hashed SubPlan 18)))
                      Buffers: shared hit=80002
                      InitPlan 19 (returns $19)
                        ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.051..0.051 rows=1 loops=1)
                      InitPlan 20 (returns $20)
                        ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.113..0.113 rows=1 loops=1)
                              Buffers: shared hit=2
                      SubPlan 18
                        ->  Index Scan using companies_deleted_at_idx on companies c  (cost=0.79..8.81 rows=1 width=16) (never executed)
                              Index Cond: (deleted_at IS NULL)
                              Filter: ($16 AND $17)
                              InitPlan 16 (returns $16)
                                ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
                              InitPlan 17 (returns $17)
                                ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
              SubPlan 38
                ->  Index Scan using companies_deleted_at_idx on companies c_1  (cost=0.79..9.07 rows=1 width=16) (never executed)
                      Index Cond: (deleted_at IS NULL)
                      Filter: ($36 AND $37 AND (SubPlan 35))
                      InitPlan 36 (returns $36)
                        ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
                      InitPlan 37 (returns $37)
                        ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
                      SubPlan 35
                        ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
              SubPlan 52
                ->  Nested Loop  (cost=1.45..18.27 rows=1 width=16) (never executed)
                      Join Filter: (c_2.id = d.company_id)
                      InitPlan 48 (returns $50)
                        ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
                      InitPlan 49 (returns $51)
                        ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
                      InitPlan 50 (returns $52)
                        ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
                      InitPlan 51 (returns $53)
                        ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
                      ->  Index Scan using reporting_deals_created_stage on deals d  (cost=0.14..8.93 rows=1 width=32) (never executed)
                            Filter: ($50 AND $51 AND private.can_access_deal(id, false) AND (SubPlan 46) AND (SubPlan 47))
                            SubPlan 46
                              ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
                            SubPlan 47
                              ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
                      ->  Index Scan using companies_deleted_at_idx on companies c_2  (cost=0.27..8.29 rows=1 width=16) (never executed)
                            Index Cond: (deleted_at IS NULL)
                            Filter: ($52 AND $53)
        ->  Hash  (cost=1095.00..1095.00 rows=5000 width=16) (actual time=449.672..449.673 rows=20000 loops=1)
              Buckets: 32768 (originally 8192)  Batches: 1 (originally 1)  Memory Usage: 1194kB
              Buffers: shared hit=897
              ->  Seq Scan on people p  (cost=0.00..1095.00 rows=5000 width=16) (actual time=445.862..447.532 rows=20000 loops=1)
                    Filter: ($0 AND $1 AND (archived_at IS NULL))
                    Buffers: shared hit=897
Planning:
  Buffers: shared hit=38
Planning Time: 0.801 ms
JIT:
  Functions: 141
  Options: Inlining true, Optimization true, Expressions true, Deforming true
  Timing: Generation 3.597 ms, Inlining 8.239 ms, Optimization 244.958 ms, Emission 203.135 ms, Total 459.929 ms
Execution Time: 514.598 ms
```
