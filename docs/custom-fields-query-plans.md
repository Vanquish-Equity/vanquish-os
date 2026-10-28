# Custom fields query plans — Phase 6A

## Reproduction and limits

`supabase/tests/custom_fields_explain.sql` creates 20,000 **synthetic** People and
10 numeric definitions (200,000 typed values), ANALYZEs them, and measures under
an authenticated non-admin member with RLS active. No real records or names are
used. Its transaction rolls back. The owner bulk fixture loader temporarily
suspends only the two new per-value validation/audit triggers, retaining CHECKs,
and restores both before ANALYZE/measurements. This measures authorized reads,
not write throughput. No index/plan forcing or RLS bypass is used for measurements.

The full CI chain runs the same file on native PostgreSQL 16 and prints plans.
The plans below are from local disposable **PGlite PostgreSQL (WASM)**, not a hosted
Supabase performance prediction. Run `PGLITE_MODULE_PATH=<runtime>/package.json
node scripts/check_custom_fields_sql.mjs` after installing PGlite in that temporary
runtime. The harness captures these four complete plans in
`/tmp/custom-fields-explain.json`. Native CI results should be compared using the
same SQL; host speed, cache state and PostgreSQL version affect absolute times.

| Query | Visible output | Execution time (local WASM) |
| --- | --- | --- |
| Direct selective predicate: number = 777 (20 visible rows) | 20 | 207.842 ms |
| Direct broad count: number >= 0 (20,000 visible rows; diagnostic only) | 1 count row | 205.314 ms |
| Actual RPC selective: equals 777 (20 visible rows) | 20 | 150.969 ms |
| Actual RPC broad: less than 1000, value ascending (101-row sentinel) | 101 | 167.815 ms |

The selective number predicate still performs **20,000 parent authorization index
lookups**: the value equality is a filter after the definition index condition,
not a narrow value-index range. Broad count has similar authorization cost. The
RPC plans show a Function Scan boundary; the two direct plans expose the internal
RLS cost. Constant identity/configuration calls appear as InitPlans, while the
parent-record checks necessarily depend on each row. These measurements do not
prove acceptable latency for larger datasets or concurrent hosted traffic.

Therefore 6A permits one field/request, at most 10 active filterable definitions
per object, and 100 matches plus a truncation sentinel. The UI returns no total;
the broad count below is a benchmark diagnostic, not an application aggregate.
There is no multi-field query language or multi-select GIN index. A row limit
bounds the response, **not** rows examined; text contains/multi-select membership
and broad sorts may scan the entire definition. Evaluate native hosted query
plans before increasing budgets. Normal database request timeouts still apply;
no claim of a custom statement timeout or constant-time search is made.

## Complete local EXPLAIN (ANALYZE, BUFFERS) output

### Direct selective predicate: number = 777 (20 visible rows)

```text
Limit  (cost=0.94..971990.16 rows=1 width=20) (actual time=173.972..207.532 rows=20.00 loops=1)
  Buffers: shared hit=80183
  InitPlan 1
    ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.120..0.129 rows=1.00 loops=1)
  InitPlan 2
    ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.417..0.418 rows=1.00 loops=1)
          Buffers: shared hit=8
  ->  Index Scan using cf_values_number on custom_field_values v  (cost=0.42..971989.64 rows=1 width=20) (actual time=173.964..207.511 rows=20.00 loops=1)
        Index Cond: (definition_id = 'ca5e7788-78b4-24a2-b9f0-cdde7485c02d'::uuid)
        Filter: ((InitPlan 1).col1 AND (InitPlan 2).col1 AND (ANY (definition_id = (hashed SubPlan 10).col1)) AND (((person_id IS NOT NULL) AND EXISTS(SubPlan 19)) OR ((company_id IS NOT NULL) AND (ANY (company_id = (hashed SubPlan 36).col1))) OR ((deal_id IS NOT NULL) AND (ANY (deal_id = (hashed SubPlan 50).col1)))) AND (number_value = '777'::numeric))
        Rows Removed by Filter: 19980
        Index Searches: 1
        Buffers: shared hit=80183
        SubPlan 10
          ->  Seq Scan on custom_field_definitions f  (cost=0.78..2.88 rows=2 width=16) (actual time=2.997..3.010 rows=10.00 loops=1)
                Filter: ((InitPlan 7).col1 AND (InitPlan 8).col1 AND ((InitPlan 9).col1 OR (NOT archived)) AND (NOT archived))
                Buffers: shared hit=11
                InitPlan 7
                  ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.019..0.020 rows=1.00 loops=1)
                InitPlan 8
                  ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=1.436..1.452 rows=1.00 loops=1)
                        Buffers: shared hit=8
                InitPlan 9
                  ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.513..0.514 rows=1.00 loops=1)
                        Buffers: shared hit=1
        SubPlan 19
          ->  Index Scan using people_pkey on people p  (cost=0.81..17.63 rows=1 width=0) (actual time=0.006..0.006 rows=1.00 loops=20000)
                Index Cond: (id = v.person_id)
                Filter: ((InitPlan 17).col1 AND (InitPlan 18).col1 AND (archived_at IS NULL) AND ((primary_organization_id IS NULL) OR (ANY (primary_organization_id = (hashed SubPlan 16).col1))))
                Index Searches: 20000
                Buffers: shared hit=60002
                InitPlan 17
                  ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.024..0.025 rows=1.00 loops=1)
                InitPlan 18
                  ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.045..0.046 rows=1.00 loops=1)
                        Buffers: shared hit=2
                SubPlan 16
                  ->  Index Scan using companies_deleted_at_idx on companies c  (cost=0.79..8.81 rows=1 width=16) (never executed)
                        Index Cond: (deleted_at IS NULL)
                        Filter: ((InitPlan 14).col1 AND (InitPlan 15).col1)
                        Index Searches: 0
                        InitPlan 14
                          ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
                        InitPlan 15
                          ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
        SubPlan 36
          ->  Index Scan using companies_deleted_at_idx on companies c_1  (cost=0.79..9.07 rows=1 width=16) (never executed)
                Index Cond: (deleted_at IS NULL)
                Filter: ((InitPlan 34).col1 AND (InitPlan 35).col1 AND (SubPlan 33))
                Index Searches: 0
                InitPlan 34
                  ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
                InitPlan 35
                  ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
                SubPlan 33
                  ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
        SubPlan 50
          ->  Nested Loop  (cost=1.45..18.27 rows=1 width=16) (never executed)
                Join Filter: (c_2.id = d.company_id)
                InitPlan 46
                  ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
                InitPlan 47
                  ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
                InitPlan 48
                  ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
                InitPlan 49
                  ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
                ->  Index Scan using reporting_deals_created_stage on deals d  (cost=0.14..8.93 rows=1 width=32) (never executed)
                      Filter: ((InitPlan 46).col1 AND (InitPlan 47).col1 AND private.can_access_deal(id, false) AND (SubPlan 44) AND (SubPlan 45))
                      Index Searches: 0
                      SubPlan 44
                        ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
                      SubPlan 45
                        ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
                ->  Index Scan using companies_deleted_at_idx on companies c_2  (cost=0.27..8.29 rows=1 width=16) (never executed)
                      Index Cond: (deleted_at IS NULL)
                      Filter: ((InitPlan 48).col1 AND (InitPlan 49).col1)
                      Index Searches: 0
Planning:
  Buffers: shared hit=190 read=3
Planning Time: 5.669 ms
Execution Time: 207.842 ms
```

### Direct broad count: number >= 0 (20,000 visible rows; diagnostic only)

```text
Aggregate  (cost=971799.72..971799.73 rows=1 width=8) (actual time=205.079..205.091 rows=1.00 loops=1)
  Buffers: shared hit=80121 read=1
  InitPlan 1
    ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.086..0.090 rows=1.00 loops=1)
  InitPlan 2
    ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.248..0.249 rows=1.00 loops=1)
          Buffers: shared hit=8
  ->  Index Scan using custom_field_values_definition_id_record_id_key on custom_field_values v  (cost=0.42..971797.64 rows=626 width=0) (actual time=2.303..187.778 rows=20000.00 loops=1)
        Index Cond: (definition_id = 'ca5e7788-78b4-24a2-b9f0-cdde7485c02d'::uuid)
        Filter: ((InitPlan 1).col1 AND (InitPlan 2).col1 AND is_set AND (ANY (definition_id = (hashed SubPlan 10).col1)) AND (((person_id IS NOT NULL) AND EXISTS(SubPlan 19)) OR ((company_id IS NOT NULL) AND (ANY (company_id = (hashed SubPlan 36).col1))) OR ((deal_id IS NOT NULL) AND (ANY (deal_id = (hashed SubPlan 50).col1)))) AND (number_value >= '0'::numeric))
        Index Searches: 1
        Buffers: shared hit=80121 read=1
        SubPlan 10
          ->  Seq Scan on custom_field_definitions f  (cost=0.78..2.88 rows=2 width=16) (actual time=0.146..0.153 rows=10.00 loops=1)
                Filter: ((InitPlan 7).col1 AND (InitPlan 8).col1 AND ((InitPlan 9).col1 OR (NOT archived)) AND (NOT archived))
                Buffers: shared hit=11
                InitPlan 7
                  ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.016..0.016 rows=1.00 loops=1)
                InitPlan 8
                  ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.077..0.077 rows=1.00 loops=1)
                        Buffers: shared hit=8
                InitPlan 9
                  ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.035..0.036 rows=1.00 loops=1)
                        Buffers: shared hit=1
        SubPlan 19
          ->  Index Scan using people_pkey on people p  (cost=0.81..17.63 rows=1 width=0) (actual time=0.005..0.005 rows=1.00 loops=20000)
                Index Cond: (id = v.person_id)
                Filter: ((InitPlan 17).col1 AND (InitPlan 18).col1 AND (archived_at IS NULL) AND ((primary_organization_id IS NULL) OR (ANY (primary_organization_id = (hashed SubPlan 16).col1))))
                Index Searches: 20000
                Buffers: shared hit=60002
                InitPlan 17
                  ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.013..0.014 rows=1.00 loops=1)
                InitPlan 18
                  ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.030..0.030 rows=1.00 loops=1)
                        Buffers: shared hit=2
                SubPlan 16
                  ->  Index Scan using companies_deleted_at_idx on companies c  (cost=0.79..8.81 rows=1 width=16) (never executed)
                        Index Cond: (deleted_at IS NULL)
                        Filter: ((InitPlan 14).col1 AND (InitPlan 15).col1)
                        Index Searches: 0
                        InitPlan 14
                          ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
                        InitPlan 15
                          ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
        SubPlan 36
          ->  Index Scan using companies_deleted_at_idx on companies c_1  (cost=0.79..9.07 rows=1 width=16) (never executed)
                Index Cond: (deleted_at IS NULL)
                Filter: ((InitPlan 34).col1 AND (InitPlan 35).col1 AND (SubPlan 33))
                Index Searches: 0
                InitPlan 34
                  ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
                InitPlan 35
                  ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
                SubPlan 33
                  ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
        SubPlan 50
          ->  Nested Loop  (cost=1.45..18.27 rows=1 width=16) (never executed)
                Join Filter: (c_2.id = d.company_id)
                InitPlan 46
                  ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
                InitPlan 47
                  ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
                InitPlan 48
                  ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
                InitPlan 49
                  ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
                ->  Index Scan using reporting_deals_created_stage on deals d  (cost=0.14..8.93 rows=1 width=32) (never executed)
                      Filter: ((InitPlan 46).col1 AND (InitPlan 47).col1 AND private.can_access_deal(id, false) AND (SubPlan 44) AND (SubPlan 45))
                      Index Searches: 0
                      SubPlan 44
                        ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
                      SubPlan 45
                        ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
                ->  Index Scan using companies_deleted_at_idx on companies c_2  (cost=0.27..8.29 rows=1 width=16) (never executed)
                      Index Cond: (deleted_at IS NULL)
                      Filter: ((InitPlan 48).col1 AND (InitPlan 49).col1)
                      Index Searches: 0
Planning:
  Buffers: shared hit=4
Planning Time: 5.999 ms
Execution Time: 205.314 ms
```

### Actual RPC selective: equals 777 (20 visible rows)

```text
Function Scan on custom_field_search  (cost=0.25..10.25 rows=1000 width=16) (actual time=150.944..150.949 rows=20.00 loops=1)
  Buffers: shared hit=80230 read=1
Planning Time: 0.103 ms
Execution Time: 150.969 ms
```

### Actual RPC broad: less than 1000, value ascending (101-row sentinel)

```text
Function Scan on custom_field_search  (cost=0.25..10.25 rows=1000 width=16) (actual time=167.763..167.781 rows=101.00 loops=1)
  Buffers: shared hit=80145
Planning Time: 0.050 ms
Execution Time: 167.815 ms
```

## Native PostgreSQL 16 CI measurement

Measured by the same synthetic SQL on GitHub Actions, source commit
`6aa6d18ca703e9c2fae202b628dd19ec0e32c42d`,
[successful SQL run 40755712979](https://github.com/Vanquish-Equity/vanquish-os/actions/runs/40755712979).
The query/schema fixture is unchanged in the documentation-only follow-up.

| Case | Execution time |
| --- | --- |
| Direct selective (20 visible rows) | 363.386 ms |
| Direct broad count (20,000 visible rows) | 309.992 ms |
| Actual RPC selective (20 visible rows) | 319.805 ms |
| Actual RPC broad (101-row sentinel) | 323.586 ms |

Native PostgreSQL 16 also checks 20,000 parent rows for the selective predicate.
The native direct plans report JIT totals of 324.510 ms (selective) and
285.742 ms (broad), which dominate their execution times. Default JIT/settings
were left unchanged; no plan or index forcing was used. Parent RLS work remains
visible separately from this compilation cost.
These results reinforce the one-field/100-result restriction; they do not validate
production latency or simultaneous traffic. This host is slower for these plans
than the local WASM run, so neither set of absolute timings should be generalized.

### Native: Direct selective number = 777

```text
Limit  (cost=0.94..959964.91 rows=1 width=20) (actual time=343.350..348.427 rows=20 loops=1)
  Buffers: shared hit=80186
  InitPlan 1 (returns $0)
    ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.271..0.272 rows=1 loops=1)
  InitPlan 2 (returns $1)
    ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.416..0.416 rows=1 loops=1)
          Buffers: shared hit=6
  ->  Index Scan using cf_values_number on custom_field_values v  (cost=0.42..959964.39 rows=1 width=20) (actual time=27.351..32.425 rows=20 loops=1)
        Index Cond: (definition_id = 'ca5e7788-78b4-24a2-b9f0-cdde7485c02d'::uuid)
        Filter: ($0 AND $1 AND (hashed SubPlan 10) AND (((person_id IS NOT NULL) AND (SubPlan 19)) OR ((company_id IS NOT NULL) AND (hashed SubPlan 36)) OR ((deal_id IS NOT NULL) AND (hashed SubPlan 50))) AND (number_value = '777'::numeric))
        Rows Removed by Filter: 19980
        Buffers: shared hit=80186
        SubPlan 10
          ->  Seq Scan on custom_field_definitions f  (cost=0.78..2.88 rows=2 width=16) (actual time=7.300..7.303 rows=10 loops=1)
                Filter: ($7 AND $8 AND ($9 OR (NOT archived)) AND (NOT archived))
                Buffers: shared hit=17
                InitPlan 7 (returns $7)
                  ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.160..0.160 rows=1 loops=1)
                InitPlan 8 (returns $8)
                  ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.222..0.223 rows=1 loops=1)
                        Buffers: shared hit=6
                InitPlan 9 (returns $9)
                  ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.136..0.136 rows=1 loops=1)
                        Buffers: shared hit=9
        SubPlan 19
          ->  Index Scan using people_pkey on people p  (cost=0.81..17.63 rows=1 width=0) (actual time=0.001..0.001 rows=1 loops=20000)
                Index Cond: (id = v.person_id)
                Filter: ($17 AND $18 AND (archived_at IS NULL) AND ((primary_organization_id IS NULL) OR (hashed SubPlan 16)))
                Buffers: shared hit=60001
                InitPlan 17 (returns $17)
                  ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.039..0.039 rows=1 loops=1)
                InitPlan 18 (returns $18)
                  ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.096..0.096 rows=1 loops=1)
                        Buffers: shared hit=1
                SubPlan 16
                  ->  Index Scan using companies_deleted_at_idx on companies c  (cost=0.79..8.81 rows=1 width=16) (never executed)
                        Index Cond: (deleted_at IS NULL)
                        Filter: ($14 AND $15)
                        InitPlan 14 (returns $14)
                          ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
                        InitPlan 15 (returns $15)
                          ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
        SubPlan 36
          ->  Index Scan using companies_deleted_at_idx on companies c_1  (cost=0.79..9.07 rows=1 width=16) (never executed)
                Index Cond: (deleted_at IS NULL)
                Filter: ($34 AND $35 AND (SubPlan 33))
                InitPlan 34 (returns $34)
                  ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
                InitPlan 35 (returns $35)
                  ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
                SubPlan 33
                  ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
        SubPlan 50
          ->  Nested Loop  (cost=1.58..18.41 rows=1 width=16) (never executed)
                InitPlan 46 (returns $48)
                  ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
                InitPlan 47 (returns $49)
                  ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
                InitPlan 48 (returns $50)
                  ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
                InitPlan 49 (returns $51)
                  ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
                ->  Index Scan using companies_deleted_at_idx on companies c_2  (cost=0.27..8.29 rows=1 width=16) (never executed)
                      Index Cond: (deleted_at IS NULL)
                      Filter: ($50 AND $51)
                ->  Index Scan using deals_company_id_idx on deals d  (cost=0.27..9.07 rows=1 width=32) (never executed)
                      Index Cond: (company_id = c_2.id)
                      Filter: ($48 AND $49 AND (archived_at IS NULL) AND private.can_access_deal(id, false) AND (SubPlan 44) AND (SubPlan 45))
                      SubPlan 44
                        ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
                      SubPlan 45
                        ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
Planning:
  Buffers: shared hit=478 read=10
Planning Time: 1.209 ms
JIT:
  Functions: 128
  Options: Inlining true, Optimization true, Expressions true, Deforming true
  Timing: Generation 1.721 ms, Inlining 39.263 ms, Optimization 152.503 ms, Emission 131.023 ms, Total 324.510 ms
Execution Time: 363.386 ms
```

### Native: Direct broad count number >= 0 (diagnostic only)

```text
Aggregate  (cost=959778.45..959778.46 rows=1 width=8) (actual time=307.618..307.627 rows=1 loops=1)
  Buffers: shared hit=80116 read=1
  InitPlan 1 (returns $0)
    ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.265..0.266 rows=1 loops=1)
  InitPlan 2 (returns $1)
    ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.296..0.297 rows=1 loops=1)
          Buffers: shared hit=6
  ->  Index Scan using custom_field_values_definition_id_record_id_key on custom_field_values v  (cost=0.42..959776.39 rows=616 width=0) (actual time=284.850..306.937 rows=20000 loops=1)
        Index Cond: (definition_id = 'ca5e7788-78b4-24a2-b9f0-cdde7485c02d'::uuid)
        Filter: ($0 AND $1 AND is_set AND (hashed SubPlan 10) AND (((person_id IS NOT NULL) AND (SubPlan 19)) OR ((company_id IS NOT NULL) AND (hashed SubPlan 36)) OR ((deal_id IS NOT NULL) AND (hashed SubPlan 50))) AND (number_value >= '0'::numeric))
        Buffers: shared hit=80116 read=1
        SubPlan 10
          ->  Seq Scan on custom_field_definitions f  (cost=0.78..2.88 rows=2 width=16) (actual time=7.259..7.262 rows=10 loops=1)
                Filter: ($7 AND $8 AND ($9 OR (NOT archived)) AND (NOT archived))
                Buffers: shared hit=9
                InitPlan 7 (returns $7)
                  ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.160..0.160 rows=1 loops=1)
                InitPlan 8 (returns $8)
                  ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.235..0.235 rows=1 loops=1)
                        Buffers: shared hit=6
                InitPlan 9 (returns $9)
                  ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.125..0.125 rows=1 loops=1)
                        Buffers: shared hit=1
        SubPlan 19
          ->  Index Scan using people_pkey on people p  (cost=0.81..17.63 rows=1 width=0) (actual time=0.001..0.001 rows=1 loops=20000)
                Index Cond: (id = v.person_id)
                Filter: ($17 AND $18 AND (archived_at IS NULL) AND ((primary_organization_id IS NULL) OR (hashed SubPlan 16)))
                Buffers: shared hit=60001
                InitPlan 17 (returns $17)
                  ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.040..0.041 rows=1 loops=1)
                InitPlan 18 (returns $18)
                  ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.097..0.097 rows=1 loops=1)
                        Buffers: shared hit=1
                SubPlan 16
                  ->  Index Scan using companies_deleted_at_idx on companies c  (cost=0.79..8.81 rows=1 width=16) (never executed)
                        Index Cond: (deleted_at IS NULL)
                        Filter: ($14 AND $15)
                        InitPlan 14 (returns $14)
                          ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
                        InitPlan 15 (returns $15)
                          ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
        SubPlan 36
          ->  Index Scan using companies_deleted_at_idx on companies c_1  (cost=0.79..9.07 rows=1 width=16) (never executed)
                Index Cond: (deleted_at IS NULL)
                Filter: ($34 AND $35 AND (SubPlan 33))
                InitPlan 34 (returns $34)
                  ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
                InitPlan 35 (returns $35)
                  ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
                SubPlan 33
                  ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
        SubPlan 50
          ->  Nested Loop  (cost=1.58..18.41 rows=1 width=16) (never executed)
                InitPlan 46 (returns $48)
                  ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
                InitPlan 47 (returns $49)
                  ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
                InitPlan 48 (returns $50)
                  ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
                InitPlan 49 (returns $51)
                  ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
                ->  Index Scan using companies_deleted_at_idx on companies c_2  (cost=0.27..8.29 rows=1 width=16) (never executed)
                      Index Cond: (deleted_at IS NULL)
                      Filter: ($50 AND $51)
                ->  Index Scan using deals_company_id_idx on deals d  (cost=0.27..9.07 rows=1 width=32) (never executed)
                      Index Cond: (company_id = c_2.id)
                      Filter: ($48 AND $49 AND (archived_at IS NULL) AND private.can_access_deal(id, false) AND (SubPlan 44) AND (SubPlan 45))
                      SubPlan 44
                        ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
                      SubPlan 45
                        ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
Planning:
  Buffers: shared hit=4
Planning Time: 0.591 ms
JIT:
  Functions: 127
  Options: Inlining true, Optimization true, Expressions true, Deforming true
  Timing: Generation 2.257 ms, Inlining 6.958 ms, Optimization 148.837 ms, Emission 127.690 ms, Total 285.742 ms
Execution Time: 309.992 ms
```

### Native: Actual RPC selective equals 777

```text
Function Scan on custom_field_search  (cost=0.25..10.25 rows=1000 width=16) (actual time=319.796..319.797 rows=20 loops=1)
  Buffers: shared hit=80470
Planning Time: 0.055 ms
Execution Time: 319.805 ms
```

### Native: Actual RPC broad less than 1000, value ascending

```text
Function Scan on custom_field_search  (cost=0.25..10.25 rows=1000 width=16) (actual time=323.571..323.575 rows=101 loops=1)
  Buffers: shared hit=80136
Planning Time: 0.060 ms
Execution Time: 323.586 ms
```
