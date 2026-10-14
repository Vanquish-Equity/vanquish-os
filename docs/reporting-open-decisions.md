# Phase 3: reporting decisions (activation pending)

These are proposed contracts; no feature is activated by the migration.

| Decision | Options | Recommendation | Safe default |
| --- | --- | --- | --- |
| Export format | Quoted UTF-8 CSV without BOM; BOM for spreadsheet autodetection; separate XLSX later | Approve UTF-8/CRLF CSV, UTC and explicit per-row currency; import as data, escaped formula prefixes | `csv_enabled=false`; no export until owner approval |
| Fund accounting basis | Gross fund returns; net LP returns with properly allocated fees/expenses; neither until reconciled | Recommend explicit net LP cash-flow review per cutoff, normalized single-currency flows and dated NAV; gross stays unavailable pending an asset-flow/fee-allocation contract; never convert old wires or equate commitments/calls with paid-in | `metrics_enabled=false`; unavailable for missing/stale reconciliation/NAV; no default basis |
| Weekly report retention | No persisted payload; 12-week expiring references; a separately approved private artifact store later | Generate/download current data only; expire references after 84 days, prune on next request; no server PDF/artifact retention | `weekly_enabled=false`; member opt-in false; email dispatch absent pending Phase 5 |

Owner approval should record the selected format, approved accounting basis and
reference-retention policy before setting the corresponding SQL flag. Existing
confidentiality and portfolio reconciliation decisions remain unchanged.
See [Phase 3 reporting](crm-reporting.md) for limits, activation and rollback.
