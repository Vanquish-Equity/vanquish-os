import { parseCsv } from "@/lib/communications/csv";

export const MAX_WEBSITE_IMPORT_ROWS = 500;
export const MAX_WEBSITE_IMPORT_BYTES = 128 * 1024;
const MAX_NAME_LENGTH = 300;
const MAX_URL_LENGTH = 500;

export type WebsiteImportCompany = { id: string; name: string; website: string | null };
export type WebsiteImportStatus =
  | "matched" | "ambiguous" | "not_found" | "invalid_url" | "invalid_row"
  | "already_set" | "duplicate" | "conflict";
export type WebsiteImportRow = {
  row: number;
  name: string;
  website: string | null;
  status: WebsiteImportStatus;
  companyId?: string;
  companyName?: string;
};
export type WebsiteImportApproval = { row: number; companyId: string; website: string };
export type WebsiteImportOutcome = { row: number; status: "saved" | "history_unavailable" | "stale" | "failed" };

type InputRow = { row: number; name: string; website: string; valid: boolean };
type ParseResult = { ok: true; rows: InputRow[] } | { ok: false; message: string };

function nameKey(name: string) {
  return name.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
}

export function normalizeCompanyWebsite(input: string): string | null {
  const value = input.trim();
  if (!value || value.length > MAX_URL_LENGTH || /[\s\\\p{Cc}]/u.test(value)) return null;
  const explicitHttp = /^https?:\/\//i.test(value);
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(value);
  // A bare hostname may contain a numeric port, but not a non-web scheme.
  const bareWithPort = /^[^/?#:@]+\.[^/?#:@]+:\d+(?:[/?#]|$)/.test(value);
  if ((!explicitHttp && hasScheme && !bareWithPort) || value.startsWith("/")) return null;
  const full = explicitHttp ? value : `https://${value}`;
  const authority = full.split("://")[1]?.split(/[/?#]/, 1)[0];
  if (!authority || authority.includes("@")) return null;
  try {
    const url = new URL(full);
    const hostname = url.hostname.replace(/\.$/, "");
    if (url.username || url.password || hostname.length > 253 ||
        !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(hostname)) {
      return null;
    }
    return `https://${hostname}`;
  } catch {
    return null;
  }
}

export function parseWebsiteImport(input: unknown): ParseResult {
  if (typeof input !== "string" || !input.trim()) return { ok: false, message: "Paste rows or choose a CSV file." };
  if (new TextEncoder().encode(input).byteLength > MAX_WEBSITE_IMPORT_BYTES) {
    return { ok: false, message: "The CSV is larger than 128 KB. Split it into smaller files." };
  }
  const rows = parseCsv(input);
  const first = rows[0]?.map((cell) => nameKey(cell).replaceAll("_", " "));
  const hasHeader = first?.length === 2 && ["company name", "company", "name"].includes(first[0]) && first[1] === "website";
  const data = hasHeader ? rows.slice(1) : rows;
  if (!data.length) return { ok: false, message: "The CSV has no company rows." };
  if (data.length > MAX_WEBSITE_IMPORT_ROWS) {
    return { ok: false, message: "Import up to 500 company rows at a time." };
  }
  return {
    ok: true,
    rows: data.map((cells, index) => {
      const name = cells[0]?.trim() ?? "";
      return {
        row: index + 1,
        name: name.slice(0, MAX_NAME_LENGTH),
        website: cells[1] ?? "",
        valid: cells.length === 2 && name.length > 0 && name.length <= MAX_NAME_LENGTH,
      };
    }),
  };
}

export function matchCompanyWebsites(rows: InputRow[], companies: WebsiteImportCompany[]): WebsiteImportRow[] {
  const byName = new Map<string, WebsiteImportCompany[]>();
  for (const company of companies) {
    const key = nameKey(company.name);
    const matches = byName.get(key);
    if (matches) matches.push(company);
    else byName.set(key, [company]);
  }

  const preview = rows.map(({ row, name, website: input, valid }): WebsiteImportRow => {
    if (!valid) return { row, name, website: null, status: "invalid_row" };
    const website = normalizeCompanyWebsite(input);
    if (!website) return { row, name, website: null, status: "invalid_url" };
    const matches = byName.get(nameKey(name));
    if (!matches) return { row, name, website, status: "not_found" };
    if (matches.length !== 1) return { row, name, website, status: "ambiguous" };
    const [company] = matches;
    return {
      row, name, website, companyId: company.id, companyName: company.name,
      status: company.website?.trim() ? "already_set" : "matched",
    };
  });

  const proposals = new Map<string, WebsiteImportRow[]>();
  for (const row of preview) {
    if (row.status !== "matched" || !row.companyId) continue;
    const existing = proposals.get(row.companyId);
    if (existing) existing.push(row);
    else proposals.set(row.companyId, [row]);
  }
  for (const matches of proposals.values()) {
    if (new Set(matches.map((match) => match.website)).size > 1) {
      for (const match of matches) match.status = "conflict";
    } else {
      for (const duplicate of matches.slice(1)) duplicate.status = "duplicate";
    }
  }
  return preview;
}
