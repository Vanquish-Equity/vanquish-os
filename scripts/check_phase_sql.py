"""Generate/review phase SQL from migration sources; default mode checks drift."""
import argparse
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PHASES = {
    "phase-1-durable-relationship-sync.sql": (
        "-- Combined phase 1 SQL. Source: migrations/20261009171254_durable_relationship_sync.sql\n"
        "-- Prerequisite: entire preceding migration chain through 20261008201057.\n"
        "-- Review DELETE/trigger DROP impact in docs/runbook-sync-activation.md.\n"
        "-- No preview/production execution is authorized by this artifact.\n\n",
        ["20261009171254_durable_relationship_sync.sql"],
    ),
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true", help="Regenerate committed phase SQL locally")
    args = parser.parse_args()
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
