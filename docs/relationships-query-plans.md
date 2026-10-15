# Phase 4: synthetic query plans

All fixtures are synthetic. No production/preview database or actual relationship was queried. Reproduce with `supabase/tests/relationships_explain.sql` only on a disposable database after the complete CI migration chain. 20,000 synthetic benchmark People, 100 synthetic benchmark company parents, 10 opted-in benchmark members, exactly 100,000 benchmark daily history rows, five dates per person. Earlier migration-chain baseline Companies also remain in this disposable database: the local visible-company CTE checks 206 total parents, not just the 100 new fixtures. No baseline names or records are printed. Each benchmark person has one member edge; this is not evidence of real introduction accuracy or coverage of every graph topology. Budget tests separately exercise >500 contacts and >10,000 candidate rows.

No planner/index-forcing settings. RLS is active as authenticated; statistics are ANALYZE'd. Uncorrelated membership/machine policy functions show InitPlans. Parent checks are materialized once per Company; correlated parent checks are not incorrectly claimed as global InitPlans. Indexes are additive, never forced.

## Local measurements (PGlite / PostgreSQL WASM)

One run: selective **10.352 ms**, broad **388.568 ms**, actual graph RPC **137.570 ms**. These are not native PostgreSQL or production latency predictions. The broad plan consumes all **100,000** authorized rows and **20,000** groups and spills a sort to disk. It is not a LIMIT shortcut that silently visits only a few hundred people. The actual graph is intentionally partial for a root with 2,000 contacts, because its 500-node/contact budget is exhausted. Do not increase caps or hide this status to make a benchmark look complete.

The RPC EXPLAIN shows the outer Result, not its PL/pgSQL internal operators; the two aggregate plans expose representative authorization/grouping work. The endpoint additionally builds bounded root/target candidate sets and a bounded JSON graph. Physical scans can exceed graph-node budgets and their latency is bounded by the statement timer, not by pretending SQL visited only 500 rows.

```text
Limit  (cost=394.04..394.16 rows=5 width=68) (actual time=10.261..10.269 rows=1.00 loops=1)
  Buffers: shared hit=1249 read=109 dirtied=3 written=109
  CTE publishers
    ->  Function Scan on relationship_intelligence_publishers  (cost=0.25..10.25 rows=1000 width=96) (actual time=0.305..0.307 rows=10.00 loops=1)
          Buffers: shared hit=30 read=3 dirtied=3 written=3
  CTE visible_companies
    ->  Seq Scan on companies c  (cost=0.52..326.14 rows=26 width=16) (actual time=0.438..9.415 rows=206.00 loops=1)
          Filter: ((InitPlan 3).col1 AND (InitPlan 4).col1 AND (deleted_at IS NULL) AND (SubPlan 2))
          Buffers: shared hit=1204 read=106 written=106
          InitPlan 3
            ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.015..0.015 rows=1.00 loops=1)
          InitPlan 4
            ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.032..0.033 rows=1.00 loops=1)
                  Buffers: shared hit=2
          SubPlan 2
            ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.042..0.042 rows=1.00 loops=206)
                  Buffers: shared hit=945 read=93 written=93
  InitPlan 7
    ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.024..0.024 rows=1.00 loops=1)
  InitPlan 8
    ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.032..0.033 rows=1.00 loops=1)
          Buffers: shared hit=2
  InitPlan 9
    ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.097..0.097 rows=1.00 loops=1)
  InitPlan 10
    ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.059..0.060 rows=1.00 loops=1)
          Buffers: shared hit=2
  ->  GroupAggregate  (cost=56.61..56.73 rows=5 width=68) (actual time=10.259..10.262 rows=1.00 loops=1)
        Group Key: p.member_key
        Buffers: shared hit=1249 read=109 dirtied=3 written=109
        ->  Sort  (cost=56.61..56.62 rows=5 width=58) (actual time=10.246..10.250 rows=5.00 loops=1)
              Sort Key: p.member_key, h.occurred_on
              Sort Method: quicksort  Memory: 17kB
              Buffers: shared hit=1249 read=109 dirtied=3 written=109
              ->  Nested Loop  (cost=24.68..56.55 rows=5 width=58) (actual time=10.226..10.240 rows=5.00 loops=1)
                    Buffers: shared hit=1249 read=109 dirtied=3 written=109
                    ->  Index Scan using people_pkey on people v  (cost=0.87..8.89 rows=1 width=16) (actual time=9.822..9.824 rows=1.00 loops=1)
                          Index Cond: (id = 'e83aafbd-6e33-0182-812e-8b738ca1703f'::uuid)
                          Filter: ((InitPlan 9).col1 AND (InitPlan 10).col1 AND (archived_at IS NULL) AND ((primary_organization_id IS NULL) OR (ANY (primary_organization_id = (hashed SubPlan 6).col1))))
                          Index Searches: 1
                          Buffers: shared hit=1209 read=106 written=106
                          SubPlan 6
                            ->  CTE Scan on visible_companies  (cost=0.00..0.52 rows=26 width=16) (actual time=0.442..9.548 rows=206.00 loops=1)
                                  Storage: Memory  Maximum Storage: 25kB
                                  Buffers: shared hit=1204 read=106 written=106
                    ->  Hash Join  (cost=23.81..47.61 rows=5 width=58) (actual time=0.402..0.411 rows=5.00 loops=1)
                          Hash Cond: (p.email = h.member_email)
                          Buffers: shared hit=40 read=3 dirtied=3 written=3
                          ->  CTE Scan on publishers p  (cost=0.00..20.00 rows=1000 width=64) (actual time=0.306..0.312 rows=10.00 loops=1)
                                Storage: Memory  Maximum Storage: 18kB
                                Buffers: shared hit=30 read=3 dirtied=3 written=3
                          ->  Hash  (cost=23.80..23.80 rows=1 width=62) (actual time=0.091..0.092 rows=5.00 loops=1)
                                Buckets: 1024  Batches: 1  Memory Usage: 5kB
                                Buffers: shared hit=10
                                ->  Bitmap Heap Scan on relationship_interactions h  (cost=4.46..23.80 rows=1 width=62) (actual time=0.081..0.088 rows=5.00 loops=1)
                                      Recheck Cond: (person_id = 'e83aafbd-6e33-0182-812e-8b738ca1703f'::uuid)
                                      Filter: ((InitPlan 7).col1 AND (InitPlan 8).col1 AND (occurred_on <= CURRENT_DATE) AND (occurred_on >= (CURRENT_DATE - 179)))
                                      Heap Blocks: exact=5
                                      Buffers: shared hit=10
                                      ->  Bitmap Index Scan on relationship_interactions_person_recent_idx  (cost=0.00..4.46 rows=5 width=0) (actual time=0.011..0.011 rows=5.00 loops=1)
                                            Index Cond: (person_id = 'e83aafbd-6e33-0182-812e-8b738ca1703f'::uuid)
                                            Index Searches: 1
                                            Buffers: shared hit=3
Planning:
  Buffers: shared hit=154 read=32 written=32
Planning Time: 1.893 ms
Execution Time: 10.352 ms
Aggregate  (cost=7425.10..7425.11 rows=1 width=76) (actual time=388.300..388.321 rows=1.00 loops=1)
  Buffers: shared hit=3508, temp read=2760 written=2764
  CTE publishers
    ->  Function Scan on relationship_intelligence_publishers  (cost=0.25..10.25 rows=1000 width=96) (actual time=0.209..0.212 rows=10.00 loops=1)
          Buffers: shared hit=33
  CTE visible_companies
    ->  Seq Scan on companies c  (cost=0.52..326.14 rows=26 width=16) (actual time=0.091..7.585 rows=206.00 loops=1)
          Filter: ((InitPlan 3).col1 AND (InitPlan 4).col1 AND (deleted_at IS NULL) AND (SubPlan 2))
          Buffers: shared hit=1302
          InitPlan 3
            ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.010..0.011 rows=1.00 loops=1)
          InitPlan 4
            ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.026..0.027 rows=1.00 loops=1)
                  Buffers: shared hit=2
          SubPlan 2
            ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.034..0.034 rows=1.00 loops=206)
                  Buffers: shared hit=1030
  ->  GroupAggregate  (cost=6346.52..6776.21 rows=15625 width=68) (actual time=306.267..382.889 rows=20000.00 loops=1)
        Group Key: h.person_id, p.member_key
        Buffers: shared hit=3508, temp read=2760 written=2764
        InitPlan 7
          ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.035..0.035 rows=1.00 loops=1)
        InitPlan 8
          ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.061..0.062 rows=1.00 loops=1)
                Buffers: shared hit=2
        InitPlan 9
          ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.012..0.013 rows=1.00 loops=1)
        InitPlan 10
          ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.027..0.027 rows=1.00 loops=1)
                Buffers: shared hit=2
        ->  Sort  (cost=6345.48..6384.54 rows=15625 width=58) (actual time=306.240..331.674 rows=100000.00 loops=1)
              Sort Key: h.person_id, p.member_key, h.occurred_on
              Sort Method: external merge  Disk: 7096kB
              Buffers: shared hit=3508, temp read=2760 written=2764
              ->  Merge Join  (cost=5017.70..5257.08 rows=15625 width=58) (actual time=163.923..233.497 rows=100000.00 loops=1)
                    Merge Cond: (p.email = h.member_email)
                    Buffers: shared hit=3508, temp read=1873 written=1875
                    ->  Sort  (cost=69.83..72.33 rows=1000 width=64) (actual time=0.224..0.231 rows=10.00 loops=1)
                          Sort Key: p.email
                          Sort Method: quicksort  Memory: 17kB
                          Buffers: shared hit=33
                          ->  CTE Scan on publishers p  (cost=0.00..20.00 rows=1000 width=64) (actual time=0.211..0.218 rows=10.00 loops=1)
                                Storage: Memory  Maximum Storage: 18kB
                                Buffers: shared hit=33
                    ->  Sort  (cost=4947.87..4955.68 rows=3125 width=62) (actual time=163.386..189.070 rows=100000.00 loops=1)
                          Sort Key: h.member_email
                          Sort Method: external sort  Disk: 7496kB
                          Buffers: shared hit=3475, temp read=1873 written=1875
                          ->  Hash Join  (cost=617.84..4766.47 rows=3125 width=62) (actual time=23.065..96.979 rows=100000.00 loops=1)
                                Hash Cond: (h.person_id = v.id)
                                Buffers: shared hit=3475
                                ->  Seq Scan on relationship_interactions h  (cost=0.00..4083.00 rows=25000 width=62) (actual time=1.155..32.504 rows=100000.00 loops=1)
                                      Filter: ((InitPlan 7).col1 AND (InitPlan 8).col1 AND (occurred_on <= CURRENT_DATE) AND (occurred_on >= (CURRENT_DATE - 179)))
                                      Buffers: shared hit=1835
                                ->  Hash  (cost=586.59..586.59 rows=2500 width=16) (actual time=21.904..21.906 rows=20000.00 loops=1)
                                      Buckets: 32768 (originally 4096)  Batches: 1 (originally 1)  Memory Usage: 910kB
                                      Buffers: shared hit=1640
                                      ->  Seq Scan on people v  (cost=0.58..586.59 rows=2500 width=16) (actual time=7.876..16.811 rows=20000.00 loops=1)
                                            Filter: ((InitPlan 9).col1 AND (InitPlan 10).col1 AND (archived_at IS NULL) AND ((primary_organization_id IS NULL) OR (ANY (primary_organization_id = (hashed SubPlan 6).col1))))
                                            Buffers: shared hit=1640
                                            SubPlan 6
                                              ->  CTE Scan on visible_companies  (cost=0.00..0.52 rows=26 width=16) (actual time=0.092..7.700 rows=206.00 loops=1)
                                                    Storage: Memory  Maximum Storage: 25kB
                                                    Buffers: shared hit=1302
Planning:
  Buffers: shared hit=22 read=7 written=7
Planning Time: 0.684 ms
Execution Time: 388.568 ms
Result  (cost=0.00..0.26 rows=1 width=32) (actual time=137.556..137.556 rows=1.00 loops=1)
  Buffers: shared hit=4832 read=1 written=1
Planning Time: 0.051 ms
Execution Time: 137.570 ms
```

## Native PostgreSQL 16 CI

Native PostgreSQL 16, CI SQL job https://github.com/Vanquish-Equity/vanquish-os/actions/runs/38659149611/job/116175996201
Measured source commit c2ccd534349126d96841fe3d442ccc7e64415a0d. Same benchmark/query SQL as the node-accounting follow-up; no forced indexes. Both initial workflows passed.

| Query | Execution time |
| --- | ---: |
| Selective authorized aggregate, one Person | 45.068 ms |
| Broad authorized aggregate, all 100,000 rows / 20,000 groups | 255.209 ms |
| Actual capped graph RPC | 157.972 ms |

The selective query also authorizes the materialized Company set (206 total parents from benchmark plus earlier migration fixtures); it is not a submillisecond single-index lookup. The broad sort spills (`external merge`, 7,096 kB, plus a second external sort of 7,488 kB in this run). The actual endpoint returns `partial`, 500 visited graph nodes, reasons `history_or_contact_budget` and `node_budget`. A high-degree root is intentionally incomplete. Benchmark rows have one publisher per Person; they do not establish dense-graph performance or real-world route quality.

### Selective aggregate

```text
 Limit  (cost=127.04..127.16 rows=5 width=68) (actual time=45.017..45.019 rows=1 loops=1)
   Buffers: shared hit=919 read=35 dirtied=4
   CTE publishers
     ->  Function Scan on relationship_intelligence_publishers  (cost=0.25..10.25 rows=1000 width=96) (actual time=1.297..1.298 rows=10 loops=1)
           Buffers: shared hit=85 read=11 dirtied=4
   CTE visible_companies
     ->  Seq Scan on companies c  (cost=0.52..59.14 rows=26 width=16) (actual time=1.160..42.814 rows=206 loops=1)
           Filter: ($2 AND $3 AND (deleted_at IS NULL) AND (SubPlan 2))
           Buffers: shared hit=819 read=24
           InitPlan 3 (returns $2)
             ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.075..0.075 rows=1 loops=1)
           InitPlan 4 (returns $3)
             ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.198..0.198 rows=1 loops=1)
                   Buffers: shared hit=1
           SubPlan 2
             ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.205..0.205 rows=1 loops=206)
                   Buffers: shared hit=815 read=24
   InitPlan 7 (returns $6)
     ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.116..0.116 rows=1 loops=1)
   InitPlan 8 (returns $7)
     ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.203..0.203 rows=1 loops=1)
           Buffers: shared hit=1
   InitPlan 9 (returns $8)
     ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.120..0.121 rows=1 loops=1)
   InitPlan 10 (returns $9)
     ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.234..0.234 rows=1 loops=1)
           Buffers: shared hit=3
   ->  GroupAggregate  (cost=56.61..56.73 rows=5 width=68) (actual time=45.016..45.017 rows=1 loops=1)
         Group Key: p.member_key
         Buffers: shared hit=919 read=35 dirtied=4
         ->  Sort  (cost=56.61..56.62 rows=5 width=58) (actual time=45.011..45.012 rows=5 loops=1)
               Sort Key: p.member_key, h.occurred_on
               Sort Method: quicksort  Memory: 25kB
               Buffers: shared hit=919 read=35 dirtied=4
               ->  Nested Loop  (cost=24.68..56.55 rows=5 width=58) (actual time=45.001..45.007 rows=5 loops=1)
                     Buffers: shared hit=919 read=35 dirtied=4
                     ->  Index Scan using people_pkey on people v  (cost=0.87..8.89 rows=1 width=16) (actual time=43.359..43.360 rows=1 loops=1)
                           Index Cond: (id = 'e83aafbd-6e33-0182-812e-8b738ca1703f'::uuid)
                           Filter: ($8 AND $9 AND (archived_at IS NULL) AND ((primary_organization_id IS NULL) OR (hashed SubPlan 6)))
                           Buffers: shared hit=825 read=24
                           SubPlan 6
                             ->  CTE Scan on visible_companies  (cost=0.00..0.52 rows=26 width=16) (actual time=1.161..42.886 rows=206 loops=1)
                                   Buffers: shared hit=819 read=24
                     ->  Hash Join  (cost=23.81..47.61 rows=5 width=58) (actual time=1.640..1.644 rows=5 loops=1)
                           Hash Cond: (p.email = h.member_email)
                           Buffers: shared hit=94 read=11 dirtied=4
                           ->  CTE Scan on publishers p  (cost=0.00..20.00 rows=1000 width=64) (actual time=1.297..1.300 rows=10 loops=1)
                                 Buffers: shared hit=85 read=11 dirtied=4
                           ->  Hash  (cost=23.80..23.80 rows=1 width=62) (actual time=0.338..0.338 rows=5 loops=1)
                                 Buckets: 1024  Batches: 1  Memory Usage: 9kB
                                 Buffers: shared hit=9
                                 ->  Bitmap Heap Scan on relationship_interactions h  (cost=4.46..23.80 rows=1 width=62) (actual time=0.330..0.335 rows=5 loops=1)
                                       Recheck Cond: (person_id = 'e83aafbd-6e33-0182-812e-8b738ca1703f'::uuid)
                                       Filter: ($6 AND $7 AND (occurred_on <= CURRENT_DATE) AND (occurred_on >= (CURRENT_DATE - 179)))
                                       Heap Blocks: exact=5
                                       Buffers: shared hit=9
                                       ->  Bitmap Index Scan on relationship_interactions_person_recent_idx  (cost=0.00..4.46 rows=5 width=0) (actual time=0.006..0.006 rows=5 loops=1)
                                             Index Cond: (person_id = 'e83aafbd-6e33-0182-812e-8b738ca1703f'::uuid)
                                             Buffers: shared hit=3
 Planning:
   Buffers: shared hit=189 read=29
 Planning Time: 0.882 ms
 Execution Time: 45.068 ms
```

### Broad aggregate

```text
 Aggregate  (cost=7158.10..7158.11 rows=1 width=76) (actual time=253.509..253.515 rows=1 loops=1)
   Buffers: shared hit=2818, temp read=2759 written=2763
   CTE publishers
     ->  Function Scan on relationship_intelligence_publishers  (cost=0.25..10.25 rows=1000 width=96) (actual time=0.408..0.409 rows=10 loops=1)
           Buffers: shared hit=51
   CTE visible_companies
     ->  Seq Scan on companies c  (cost=0.52..59.14 rows=26 width=16) (actual time=0.584..41.917 rows=206 loops=1)
           Filter: ($2 AND $3 AND (deleted_at IS NULL) AND (SubPlan 2))
           Buffers: shared hit=596
           InitPlan 3 (returns $2)
             ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.082..0.083 rows=1 loops=1)
           InitPlan 4 (returns $3)
             ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.190..0.190 rows=1 loops=1)
                   Buffers: shared hit=1
           SubPlan 2
             ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.201..0.201 rows=1 loops=206)
                   Buffers: shared hit=592
   ->  GroupAggregate  (cost=6346.52..6776.21 rows=15625 width=68) (actual time=222.614..251.952 rows=20000 loops=1)
         Group Key: h.person_id, p.member_key
         Buffers: shared hit=2818, temp read=2759 written=2763
         InitPlan 7 (returns $6)
           ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.096..0.097 rows=1 loops=1)
         InitPlan 8 (returns $7)
           ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.238..0.239 rows=1 loops=1)
                 Buffers: shared hit=1
         InitPlan 9 (returns $8)
           ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.082..0.082 rows=1 loops=1)
         InitPlan 10 (returns $9)
           ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.242..0.242 rows=1 loops=1)
                 Buffers: shared hit=1
         ->  Sort  (cost=6345.48..6384.54 rows=15625 width=58) (actual time=222.606..232.280 rows=100000 loops=1)
               Sort Key: h.person_id, p.member_key, h.occurred_on
               Sort Method: external merge  Disk: 7096kB
               Buffers: shared hit=2818, temp read=2759 written=2763
               ->  Merge Join  (cost=5017.70..5257.08 rows=15625 width=58) (actual time=163.234..185.281 rows=100000 loops=1)
                     Merge Cond: (p.email = h.member_email)
                     Buffers: shared hit=2818, temp read=1872 written=1874
                     ->  Sort  (cost=69.83..72.33 rows=1000 width=64) (actual time=0.417..0.419 rows=10 loops=1)
                           Sort Key: p.email
                           Sort Method: quicksort  Memory: 25kB
                           Buffers: shared hit=51
                           ->  CTE Scan on publishers p  (cost=0.00..20.00 rows=1000 width=64) (actual time=0.409..0.411 rows=10 loops=1)
                                 Buffers: shared hit=51
                     ->  Sort  (cost=4947.87..4955.68 rows=3125 width=62) (actual time=162.813..171.868 rows=100000 loops=1)
                           Sort Key: h.member_email
                           Sort Method: external sort  Disk: 7488kB
                           Buffers: shared hit=2767, temp read=1872 written=1874
                           ->  Hash Join  (cost=617.84..4766.47 rows=3125 width=62) (actual time=50.469..81.065 rows=100000 loops=1)
                                 Hash Cond: (h.person_id = v.id)
                                 Buffers: shared hit=2767
                                 ->  Seq Scan on relationship_interactions h  (cost=0.00..4083.00 rows=25000 width=62) (actual time=1.079..15.364 rows=100000 loops=1)
                                       Filter: ($6 AND $7 AND (occurred_on <= CURRENT_DATE) AND (occurred_on >= (CURRENT_DATE - 179)))
                                       Buffers: shared hit=1834
                                 ->  Hash  (cost=586.59..586.59 rows=2500 width=16) (actual time=49.386..49.387 rows=20000 loops=1)
                                       Buckets: 32768 (originally 4096)  Batches: 1 (originally 1)  Memory Usage: 1194kB
                                       Buffers: shared hit=933
                                       ->  Seq Scan on people v  (cost=0.58..586.59 rows=2500 width=16) (actual time=42.456..47.162 rows=20000 loops=1)
                                             Filter: ($8 AND $9 AND (archived_at IS NULL) AND ((primary_organization_id IS NULL) OR (hashed SubPlan 6)))
                                             Buffers: shared hit=933
                                             SubPlan 6
                                               ->  CTE Scan on visible_companies  (cost=0.00..0.52 rows=26 width=16) (actual time=0.584..41.992 rows=206 loops=1)
                                                     Buffers: shared hit=596
 Planning:
   Buffers: shared hit=36 read=8
 Planning Time: 0.436 ms
 Execution Time: 255.209 ms
```

### Actual RPC

```text
 Result  (cost=0.00..0.26 rows=1 width=32) (actual time=157.968..157.968 rows=1 loops=1)
   Buffers: shared hit=4382 read=31
 Planning Time: 0.037 ms
 Execution Time: 157.972 ms
```

## Limits of verification

No production data, Google service, signed-in browser-to-Supabase request, managed PostgREST configuration, concurrent production revocation, or actual introduction outcome is tested here. SQL SHARE-lock semantics fence membership/config/permission/consent changes within the transaction; sequential revocation tests verify new requests, but local PGlite is one backend and cannot establish multi-session scheduling behavior. Native CI runs ordinary PostgreSQL tests; owner verification of managed PostgREST timeout hoisting remains an activation check.
