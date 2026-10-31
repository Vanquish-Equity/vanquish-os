"""Generate/review phase SQL from migration sources; default mode checks drift."""
import argparse
from adapt_auth_worker_tests import check_generated
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PHASES = {
    "phase-6b-views-templates.sql": ("-- Phase 6B; main through 20261028190337 required. Three capabilities default off.\n\n", ["20261030210635_views_templates.sql"]),
    "phase-6b-rollback.sql": ("-- Phase 6B: pause first; refuse protected views, templates, applications and audit.\n\n", ["../rollback/phase-6b-views-templates.sql"]),
    "phase-6a-custom-fields.sql": ("-- Phase 6A; main through 20261016211212 required. Flag remains off.\n\n", ["20261028190337_custom_fields.sql"]),
    "phase-6a-rollback.sql": ("-- Phase 6A: pause first; refuse protected values, audit or saved views.\n\n", ["../rollback/phase-6a-custom-fields.sql"]),
    "phase-5b-calendar-completion.sql": ("-- Combined Phase 5B; main through 20261016013701 required. Defaults off.\n\n", ["20261016211212_calendar_completion.sql"]),
    "phase-5b-rollback.sql": ("-- Phase 5B: pause first; protected metadata prevents removal.\n\n", ["../rollback/phase-5b-calendar-completion.sql"]),
    "phase-5a-mail-completion.sql": ("-- Combined Phase 5A. Main through 20261014235923 required. Defaults off; no sender.\n\n", ["20261016013701_mail_completion.sql"]),
    "phase-5a-rollback.sql": ("-- Pause first; protected review records prevent schema removal.\n\n", ["../rollback/phase-5a-mail-completion.sql"]),
    "phase-4-relationships.sql": ("-- Combined Phase 4; prerequisite main through 20261014184050. Flag remains off.\n\n", ["20261014235923_relationship_intelligence.sql"]),
    "phase-4-rollback.sql": ("-- Phase 4 rollback; pause first. No relationship history is deleted.\n\n", ["../rollback/phase-4-relationships.sql"]),
    "phase-3-crm-reporting.sql": ("-- Combined Phase 3; prerequisite: main through 20261014173500. All feature flags remain off.\n\n", ["20261014184050_crm_reporting.sql"]),
    "phase-3-rollback.sql": ("-- Unused Phase 3 rollback; pause first; refuses metric reviews.\n\n", ["../rollback/phase-3-crm-reporting.sql"]),
    "phase-2-lp-management.sql": ("-- Combined Phase 2 SQL; run whole file after main Phase 1/Auth and owner-reviewed 20261012200002.\n\n", ["20261014173500_lp_management.sql"]),
    "phase-2-rollback.sql": ("-- Full Phase 2 schema rollback; refuses durable financial/accepted records.\n\n", ["../rollback/phase-2-lp-management.sql"]),
    "phase-1-rollback.sql": ("-- Owner-reviewed full phase 1 rollback. Stop worker; reject phase 2.\n\n", ["../rollback/phase-1-durable-relationship-sync.sql"]),
    "phase-1-durable-relationship-sync.sql": (
        "-- Combined phase 1 SQL. Sources: durable_relationship_sync + auth_service_worker migrations.\n"
        "-- Prerequisite: entire preceding migration chain through 20261008201057.\n"
        "-- Review DELETE/trigger DROP impact in docs/runbook-sync-activation.md.\n"
        "-- No preview/production execution is authorized by this artifact.\n\n",
        ["20261009171254_durable_relationship_sync.sql", "20261012175553_auth_service_worker.sql"],
    ),
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true", help="Regenerate committed phase SQL locally")
    args = parser.parse_args()
    check_generated(args.write)
    failed = []
    for name, (header, sources) in PHASES.items():
        expected = header + "\n".join((ROOT / "supabase/migrations" / source).read_text() for source in sources)
        target = ROOT / "supabase/phase-sql" / name
        if args.write:
            target.write_text(expected)
        elif not target.exists() or target.read_text() != expected:
            failed.append(name)
    if failed:
        raise SystemExit("Combined SQL differs from migration sources: " + ", ".join(failed) + ". Run python3 scripts/check_phase_sql.py --write.")
    print("Combined phase SQL matches ordered migration sources.")


if __name__ == "__main__":
    main()
