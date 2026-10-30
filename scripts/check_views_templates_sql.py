"""Run the exact full CI SQL shell against a fresh, disposable native Postgres.
Caller provisions the local cluster (normal Postgres 16 tools); never Supabase.
Required: PGHOST=127.0.0.1/localhost, PGDATABASE=disposable_*, psql on PATH.
"""
import os
from pathlib import Path
import subprocess
import tempfile

if os.environ.get("PGHOST") not in ("127.0.0.1", "localhost") or not os.environ.get("PGDATABASE", "").startswith("disposable_"):
    raise SystemExit("Refusing anything except an explicitly local disposable_* database")
root = Path(__file__).resolve().parent.parent
workflow = (root / ".github/workflows/contextual-comments.yml").read_text()
body = "\n".join(line[10:] for line in workflow.split("        run: |\n", 1)[1].splitlines()) + "\n"
with tempfile.NamedTemporaryFile(mode="w", suffix=".sh") as shell:
    shell.write(body)
    shell.flush()
    result = subprocess.run(["bash", shell.name], cwd=root)
    if result.returncode:
        raise SystemExit(result.returncode)
print("PASS full CI SQL chain on disposable native PostgreSQL")
