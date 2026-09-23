"""
Generate private portfolio seed SQL from the audit CSVs.

Input files under data/private/:
  audit_investment_register.csv
  audit_investor_relationships.csv
  audit_document_checklist.csv
  audit_findings.csv

Output:
  supabase/private_seed/portfolio_seed.sql
"""

from __future__ import annotations

import csv
import re
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PRIVATE = ROOT / "data" / "private"
OUT = ROOT / "supabase" / "private_seed" / "portfolio_seed.sql"
REPORT = ROOT / "docs" / "migration-report.md"

REGISTER = PRIVATE / "audit_investment_register.csv"
RELATIONSHIPS = PRIVATE / "audit_investor_relationships.csv"
CHECKLIST = PRIVATE / "audit_document_checklist.csv"
FINDINGS = PRIVATE / "audit_findings.csv"

COMPANY_ALIASES = {
    "Dry Water": "DryWater",
    "Evolve Together": "evolvetogether",
}

STATUS_MAP = {
    "Found": "received_found",
    "Missing": "missing",
    "Needs review": "needs_review",
    "Not applicable": "not_applicable",
}

CRITICALITY_MAP = {
    "Critical": "critical",
    "Important": "important",
    "Administrative": "administrative",
    "If applicable": "if_applicable",
}

EXECUTED_MAP = {
    "Yes": "yes",
    "No": "no",
    "Unknown": "unknown",
}

INSTRUMENT_MAP = {
    "Preferred Equity": "preferred_equity",
    "SAFE": "safe",
    "Convertible Note": "convertible_note",
    "Common": "common",
}


def read_csv(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        raise SystemExit(f"Missing {path}")
    with path.open(newline="", encoding="utf-8-sig") as handle:
        return list(csv.DictReader(handle))


def esc(value: object | None) -> str:
    if value is None:
        return "null"
    text = str(value)
    if text == "":
        return "null"
    return "'" + text.replace("'", "''") + "'"


def normalize(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", value.lower())


def normalized_sql(value: str) -> str:
    return f"regexp_replace(lower({value}), '[^a-z0-9]+', '', 'g')"


def company_lookup_expr(name: str) -> str:
    canonical = COMPANY_ALIASES.get(name, name)
    normalized = normalize(canonical)
    return (
        "(select id from companies "
        f"where {normalized_sql('name')} = {esc(normalized)} "
        "limit 1)"
    )


def company_insert_sql(name: str) -> list[str]:
    canonical = COMPANY_ALIASES.get(name, name)
    normalized = normalize(canonical)
    lines = [
        "insert into companies (name) "
        f"select {esc(canonical)} "
        "where not exists ("
        f"select 1 from companies where {normalized_sql('name')} = {esc(normalized)}"
        ");"
    ]
    if canonical != name:
        lines.append(
            "insert into company_aliases (company_id, alias) "
            f"select {company_lookup_expr(canonical)}, {esc(name)} "
            "where not exists ("
            "select 1 from company_aliases "
            f"where company_id = {company_lookup_expr(canonical)} "
            f"and lower(alias) = lower({esc(name)})"
            ");"
        )
    return lines


def clean_vehicle_name(value: str) -> str:
    text = value.strip()
    text = re.sub(r"^Mixed:\s*", "", text, flags=re.I)
    text = re.sub(r"\s*\((JIO|shared|investor)\)\s*$", "", text, flags=re.I)
    return text.strip()


def split_vehicles(value: str) -> list[str]:
    text = value.strip()
    if not text or "direct" in text.lower() or "no spv" in text.lower():
        return []
    text = re.sub(r"^Mixed:\s*", "", text, flags=re.I)
    parts = [clean_vehicle_name(part) for part in re.split(r"\s+\+\s+", text)]
    return [part for part in parts if part]


def vehicle_attrs(name: str, status: str = "Known") -> tuple[str, str | None, str]:
    lowered = name.lower()
    if "panama" in lowered or "s.a" in lowered:
        entity_type = "sa"
        jurisdiction = "Panama"
    elif "llc" in lowered:
        entity_type = "llc"
        jurisdiction = "Delaware"
    else:
        entity_type = "other"
        jurisdiction = None

    status_lower = status.lower()
    if "shared" in status_lower:
        vehicle_status = "shared_vehicle"
    elif "direct" in status_lower or "no spv" in status_lower:
        vehicle_status = "direct_no_spv"
    elif "known" in status_lower:
        vehicle_status = "known"
    elif "confirm" in status_lower:
        vehicle_status = "to_confirm"
    else:
        vehicle_status = "other"
    return entity_type, jurisdiction, vehicle_status


def vehicle_lookup_expr(name: str | None) -> str:
    if not name:
        return "null"
    return f"(select id from legal_entities where name = {esc(clean_vehicle_name(name))} limit 1)"


def investor_lookup_expr(name: str) -> str:
    return f"(select id from investors where display_name = {esc(name)} limit 1)"


def investment_lookup_expr(external_ref: str) -> str:
    return f"(select id from investments where external_ref = {esc(external_ref)} limit 1)"


def document_type_expr(label: str) -> str:
    return (
        "(select id from document_types "
        f"where lower(name) = lower({esc(label)}) "
        "limit 1)"
    )


def parse_vehicle_from_notes(notes: str) -> str | None:
    if "Vehicle/structure not located" in notes:
        return None
    match = re.search(r"Vehicle:\s*([^|]+)$", notes)
    if not match:
        return None
    return clean_vehicle_name(match.group(1).strip())


def parse_alias_from_notes(notes: str) -> str | None:
    match = re.search(r"Drive alias:\s*([^|]+)", notes)
    if not match:
        return None
    return match.group(1).strip()


def parse_date(value: str) -> str | None:
    value = value.strip()
    if re.match(r"^\d{4}-\d{2}-\d{2}$", value):
        return value
    return None


def scope_mapping(scope: str) -> str:
    if scope == "SPV":
        return "spv"
    if scope == "Investor -> SPV" or scope == "Investor \u2192 SPV":
        return "investor_spv"
    return "spv_company"


def main() -> None:
    investments = read_csv(REGISTER)
    relationships = read_csv(RELATIONSHIPS)
    checklist = read_csv(CHECKLIST)
    findings = read_csv(FINDINGS)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.parent.mkdir(parents=True, exist_ok=True)

    lines: list[str] = [
        "-- Private portfolio seed generated by scripts/generate_portfolio_seed.py",
        "begin;",
        "",
    ]

    company_names = sorted(
        {
            row["Portfolio Company"].strip()
            for row in [*investments, *relationships]
            if row.get("Portfolio Company")
        }
    )
    for name in company_names:
        lines.extend(company_insert_sql(name))

    lines.append("")
    for row in investments:
        external_ref = row["Investment ID"].strip()
        company_name = row["Portfolio Company"].strip()
        instrument = INSTRUMENT_MAP.get(row["Instrument"].strip(), "other")
        notes = row["Source / Structure Notes"].strip()
        funding_status = "authorized_only" if "authorization" in notes.lower() else "funded"

        lines.append(
            "insert into investments "
            "(external_ref, company_id, round_label, instrument, investment_date, total_amount, currency, funding_status, structure_notes) values ("
            f"{esc(external_ref)}, {company_lookup_expr(company_name)}, "
            f"{esc(row['Round / Investment'].strip())}, {esc(instrument)}, "
            f"{esc(parse_date(row['Investment Date']))}::date, "
            f"{esc(row['Total Invested ($)'].strip())}::numeric, 'USD', "
            f"{esc(funding_status)}, {esc(notes)}"
            ") on conflict (external_ref) do update set "
            "company_id = excluded.company_id, round_label = excluded.round_label, "
            "instrument = excluded.instrument, investment_date = excluded.investment_date, "
            "total_amount = excluded.total_amount, funding_status = excluded.funding_status, "
            "structure_notes = excluded.structure_notes;"
        )

        vehicle_names = split_vehicles(row["Legal Vehicle / SPV"])
        for index, vehicle_name in enumerate(vehicle_names):
            entity_type, jurisdiction, vehicle_status = vehicle_attrs(
                vehicle_name, row["Vehicle Status"]
            )
            lines.append(
                "insert into legal_entities (name, entity_type, jurisdiction, vehicle_status, notes) values ("
                f"{esc(vehicle_name)}, {esc(entity_type)}, {esc(jurisdiction)}, "
                f"{esc(vehicle_status)}, {esc(notes)}"
                ") on conflict (name) do update set "
                "entity_type = excluded.entity_type, jurisdiction = excluded.jurisdiction, "
                "vehicle_status = excluded.vehicle_status, notes = excluded.notes;"
            )
            lines.append(
                "insert into investment_vehicles (investment_id, vehicle_id, role) "
                f"values ({investment_lookup_expr(external_ref)}, {vehicle_lookup_expr(vehicle_name)}, "
                f"{esc('primary' if index == 0 else 'secondary')}) "
                "on conflict (investment_id, vehicle_id) do update set role = excluded.role;"
            )

    lines.append("")
    for row in relationships:
        investor = row["Investor"].strip()
        notes = row["Notes"].strip()
        external_ref = row["Investment ID"].strip()
        vehicle_name = parse_vehicle_from_notes(notes)
        position_status = "to_confirm" if vehicle_name is None and "not located" in notes.lower() else "funded"
        alias = parse_alias_from_notes(notes)

        lines.append(
            "insert into investors (display_name, investor_type, notes) values ("
            f"{esc(investor)}, 'unknown', {esc(notes)}"
            ") on conflict (display_name) do update set notes = excluded.notes;"
        )
        if alias and alias != investor:
            lines.append(
                "insert into investor_aliases (investor_id, alias, source) "
                f"select {investor_lookup_expr(investor)}, {esc(alias)}, 'Drive folder name' "
                "where not exists ("
                "select 1 from investor_aliases "
                f"where investor_id = {investor_lookup_expr(investor)} "
                f"and lower(alias) = lower({esc(alias)})"
                ");"
            )

        vehicle_sql = vehicle_lookup_expr(vehicle_name)
        lines.append(
            "insert into investor_positions "
            "(investment_id, investor_id, vehicle_id, amount, status, notes) "
            "select "
            f"{investment_lookup_expr(external_ref)}, {investor_lookup_expr(investor)}, "
            f"{vehicle_sql}, {esc(row['Amount Invested ($)'].strip())}::numeric, "
            f"{esc(position_status)}, {esc(notes)} "
            "where not exists ("
            "select 1 from investor_positions "
            f"where investment_id = {investment_lookup_expr(external_ref)} "
            f"and investor_id = {investor_lookup_expr(investor)} "
            f"and vehicle_id is not distinct from {vehicle_sql}"
            ");"
        )

    lines.append("")
    status_counts = Counter()
    for row in checklist:
        external_ref = row["Checklist ID"].strip()
        investment_ref = row["Investment ID"].strip()
        company_name = row["Portfolio Company"].strip()
        expected = row["Expected Document"].strip()
        status = STATUS_MAP[row["Status"].strip()]
        criticality = CRITICALITY_MAP[row["Criticality"].strip()]
        executed = EXECUTED_MAP.get(row["Executed?"].strip(), "unknown")
        scope = scope_mapping(row["Scope"].strip())
        vehicle_name = clean_vehicle_name(row["Legal Vehicle / SPV"].strip())
        investor = row["Investor (if applicable)"].strip()
        found_file = row["Found File Name"].strip()
        drive_url = row["Drive Location / Link"].strip()
        entity_on_doc = row["Entity / Holder on Document"].strip()
        date_on_doc = parse_date(row["Date on Document"])
        notes = row["Notes / Gap"].strip()
        status_counts[row["Status"].strip()] += 1

        if found_file or drive_url:
            entity_role = "SPV" if scope == "spv" else "LP" if scope == "investor_spv" else "TARGET"
            lines.append(
                "insert into documents "
                "(company_id, name, storage_path, source, drive_url, entity_role, document_type_id, "
                "doc_status, investment_id, vehicle_id, investor_id) "
                "select "
                f"{company_lookup_expr(company_name)}, {esc(found_file or expected)}, null, 'migration', "
                f"{esc(drive_url)}, {esc(entity_role)}, {document_type_expr(expected)}, "
                f"{esc('EXECUTED' if executed == 'yes' else 'UNKNOWN')}, "
                f"{investment_lookup_expr(investment_ref)}, {vehicle_lookup_expr(vehicle_name)}, "
                f"{investor_lookup_expr(investor) if investor else 'null'} "
                "where not exists ("
                "select 1 from documents "
                f"where coalesce(drive_url, '') = coalesce({esc(drive_url)}, '') "
                f"and name = {esc(found_file or expected)}"
                ");"
            )

        position_expr = "null"
        if scope == "investor_spv" and investor:
            position_expr = (
                "(select id from investor_positions "
                f"where investment_id = {investment_lookup_expr(investment_ref)} "
                f"and investor_id = {investor_lookup_expr(investor)} "
                f"and vehicle_id is not distinct from {vehicle_lookup_expr(vehicle_name)} "
                "limit 1)"
            )

        satisfied_expr = "null"
        if found_file or drive_url:
            satisfied_expr = (
                "(select id from documents "
                f"where coalesce(drive_url, '') = coalesce({esc(drive_url)}, '') "
                f"and name = {esc(found_file or expected)} "
                "limit 1)"
            )

        lines.append(
            "insert into document_requirements "
            "(scope, deal_id, vehicle_id, investment_id, position_id, document_type_id, "
            "expected_label, criticality, required, status, executed, found_file_name, "
            "drive_url, entity_on_document, date_on_document, notes, satisfied_by_document_id, external_ref) values ("
            f"{esc(scope)}, null, "
            f"{vehicle_lookup_expr(vehicle_name) if scope == 'spv' else 'null'}, "
            f"{investment_lookup_expr(investment_ref) if scope in ('spv', 'spv_company') else 'null'}, "
            f"{position_expr}, {document_type_expr(expected)}, "
            f"{esc(expected)}, {esc(criticality)}, "
            f"{'false' if criticality == 'if_applicable' else 'true'}, "
            f"{esc(status)}, {esc(executed)}, {esc(found_file)}, {esc(drive_url)}, "
            f"{esc(entity_on_doc)}, {esc(date_on_doc)}::date, {esc(notes)}, "
            f"{satisfied_expr}, {esc(external_ref)}"
            ") on conflict (external_ref) do update set "
            "status = excluded.status, executed = excluded.executed, "
            "found_file_name = excluded.found_file_name, drive_url = excluded.drive_url, "
            "entity_on_document = excluded.entity_on_document, date_on_document = excluded.date_on_document, "
            "notes = excluded.notes, satisfied_by_document_id = excluded.satisfied_by_document_id;"
        )

    lines.extend(["", "-- Capital events intentionally left empty; enter verified events manually.", "commit;", ""])
    OUT.write_text("\n".join(lines), encoding="utf-8")

    report_append = f"""
## Portfolio Seed

Generated by `scripts/generate_portfolio_seed.py`.

- Investments: {len(investments)}
- Investor positions: {len(relationships)}
- Document requirements: {len(checklist)}
- Checklist status counts: Found {status_counts['Found']} / Missing {status_counts['Missing']} / Needs review {status_counts['Needs review']} / Not applicable {status_counts['Not applicable']}
- Capital events seeded: 0

## Audit Findings Source

- Rows in `audit_findings.csv`: {len(findings)}
"""
    if REPORT.exists():
        existing = REPORT.read_text(encoding="utf-8")
        if "## Portfolio Seed" in existing:
            existing = existing.split("## Portfolio Seed")[0].rstrip() + "\n"
        REPORT.write_text(existing + report_append, encoding="utf-8")
    else:
        REPORT.write_text("# Migration Report\n" + report_append, encoding="utf-8")

    print(f"Wrote {OUT}")
    print(
        "Counts:",
        f"{len(investments)} investments,",
        f"{len(relationships)} positions,",
        f"{len(checklist)} requirements,",
        dict(status_counts),
    )


if __name__ == "__main__":
    main()
