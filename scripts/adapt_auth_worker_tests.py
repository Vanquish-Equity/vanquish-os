"""Run unchanged legacy business scenarios with a synthetic Auth service identity.
Only emits SQL for a disposable database. It does not contact Supabase.
"""
from pathlib import Path
import argparse
import re
ROOT=Path(__file__).resolve().parent.parent
SERVICE='aaaaaaaa-0000-0000-0000-000000000099'
FIXTURE=f"\ninsert into auth.users(id,email) values('{SERVICE}','worker-service@machine.test');\ninsert into private.machine_identities(sub,relationships_only) values('{SERVICE}',false);\n"
CLAIMS=f"select set_config('request.jwt.claims','{{\"role\":\"authenticated\",\"sub\":\"{SERVICE}\",\"email\":\"worker-service@machine.test\"}}',true);"
SUITES=['durable_relationship_sync','crm_sync_jobs','workflow_source_access','withdraw_sync_publications']
MARKER='-- BEGIN GENERATED AUTH BUSINESS REGRESSIONS\n'

def render(suite):
    source=(ROOT/'supabase/tests'/f'{suite}.sql').read_text()
    source=re.sub(r'\bbegin;',lambda m:m[0]+FIXTURE,source,count=1,flags=re.I)
    source=source.replace('set local role vanquish_worker;',f'set local role authenticated;\n{CLAIMS}')
    source=source.replace('select set_config(\'request.jwt.claims\',\'{"role":"vanquish_worker"}\',true);',CLAIMS)
    return f'-- Original business suite: {suite} (synthetic Auth identity)\n'+source

def check_generated(write=False):
    target=ROOT/'supabase/tests/auth_worker_publication.sql'
    current=target.read_text()
    original=current.split(MARKER)[0].rstrip()+'\n\n'
    expected=original+MARKER+'\n'.join(render(suite) for suite in SUITES)
    if write:
        target.write_text(expected)
    elif current != expected:
        raise SystemExit('Auth regression SQL differs from original suites. Run python3 scripts/adapt_auth_worker_tests.py --write.')

if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('suite',nargs='?',choices=SUITES)
    parser.add_argument('--write',action='store_true')
    args=parser.parse_args()
    if args.suite:
        print(render(args.suite))
    else:
        check_generated(args.write)
