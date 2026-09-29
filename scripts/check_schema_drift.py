"""Compare repository migrations with the connected database's applied names.

The first ten migrations were applied manually before Supabase migration
history was adopted. The recorded history starts at 0011. Newer timestamped
filenames were applied through the management API under their descriptive
suffix, so their timestamps must be stripped for this comparison.
"""

import argparse
import json
import re
from pathlib import Path


def expected_names(tree: dict) -> set[str]:
    if tree.get("truncated"):
        raise ValueError("GitHub returned an incomplete repository tree")
    names = []
    for entry in tree.get("tree", []):
        path = entry.get("path", "")
        if not path.startswith("supabase/migrations/") or not path.endswith(".sql"):
            continue
        stem = Path(path).stem
        if re.match(r"^\d{14}_", stem):
            names.append(stem[15:])
        elif re.match(r"^\d{4}_", stem) and int(stem[:4]) >= 11:
            names.append(stem)
    if not names or len(names) != len(set(names)):
        raise ValueError("No recorded migrations found, or migration names collide")
    return set(names)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tree", type=Path, required=True)
    parser.add_argument("--applied", type=Path, required=True)
    args = parser.parse_args()
    expected = expected_names(json.loads(args.tree.read_text()))
    applied = set(args.applied.read_text().splitlines())
    missing = sorted(expected - applied)
    if missing:
        print("Database is missing migrations required by this commit:")
        for name in missing:
            print(f"  - {name}")
        return 1
    print(f"Schema ready: {len(expected)} recorded migrations present.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
