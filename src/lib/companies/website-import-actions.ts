"use server";

import { revalidatePath } from "next/cache";
import { actionAccessError } from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/server";
import {
  MAX_WEBSITE_IMPORT_ROWS,
  matchCompanyWebsites,
  parseWebsiteImport,
  type WebsiteImportApproval,
  type WebsiteImportCompany,
  type WebsiteImportOutcome,
  type WebsiteImportRow,
} from "@/lib/companies/website-import";

const PAGE_SIZE = 200;
const MAX_DIRECTORY_ROWS = 10_000;
const WRITE_CONCURRENCY = 8;
type Supabase = Awaited<ReturnType<typeof createClient>>;
type ActionError = { ok: false; message: string };

async function readDirectory(supabase: Supabase): Promise<{ ok: true; companies: WebsiteImportCompany[] } | ActionError> {
  const companies: WebsiteImportCompany[] = [];
  let cursor: string | undefined;
  // Read the whole visible active directory, or fail. Matching a partial page
  // could make a duplicate name look unique.
  for (;;) {
    const query = supabase.from("companies").select("id,name,website").is("deleted_at", null)
      .order("id").limit(PAGE_SIZE);
    const { data, error } = await (cursor ? query.gt("id", cursor) : query);
    if (error || !data) return { ok: false, message: "Couldn’t load the companies directory. Try again." };
    if (!data.length) return { ok: true, companies };
    companies.push(...data);
    if (companies.length > MAX_DIRECTORY_ROWS) {
      return { ok: false, message: "The active company directory is too large to match safely." };
    }
    cursor = data.at(-1)?.id;
  }
}

async function plan(input: unknown) {
  const denied = await actionAccessError();
  if (denied) return { ok: false as const, message: denied };
  const parsed = parseWebsiteImport(input);
  if (!parsed.ok) return parsed;
  const supabase = await createClient();
  const directory = await readDirectory(supabase);
  if (!directory.ok) return directory;
  return {
    ok: true as const,
    preview: matchCompanyWebsites(parsed.rows, directory.companies),
    companies: directory.companies,
    supabase,
  };
}

export async function previewCompanyWebsites(input: string): Promise<{ ok: true; rows: WebsiteImportRow[] } | ActionError> {
  const result = await plan(input);
  if (!result.ok) return result;
  return { ok: true, rows: result.preview };
}

export async function importCompanyWebsites(
  input: string,
  approved: WebsiteImportApproval[],
): Promise<{ ok: true; outcomes: WebsiteImportOutcome[] } | ActionError> {
  const result = await plan(input);
  if (!result.ok) return result;
  if (!Array.isArray(approved) || !approved.length || approved.length > MAX_WEBSITE_IMPORT_ROWS ||
      approved.some((item) => !item || !Number.isInteger(item.row) || item.row < 1 || item.row > MAX_WEBSITE_IMPORT_ROWS ||
        typeof item.companyId !== "string" || item.companyId.length !== 36 ||
        typeof item.website !== "string" || item.website.length > 500) ||
      new Set(approved.map(({ row }) => row)).size !== approved.length) {
    return { ok: false, message: "Review the matched rows before importing." };
  }

  const byRow = new Map(result.preview.map((row) => [row.row, row]));
  const byId = new Map(result.companies.map((company) => [company.id, company]));
  const outcomes: WebsiteImportOutcome[] = [];

  for (let start = 0; start < approved.length; start += WRITE_CONCURRENCY) {
    const batch = approved.slice(start, start + WRITE_CONCURRENCY);
    const results = await Promise.all(batch.map(async ({ row, companyId, website }): Promise<WebsiteImportOutcome> => {
      const next = byRow.get(row);
      const company = byId.get(companyId);
      if (next?.status !== "matched" || next.companyId !== companyId || next.website !== website || !company) {
        return { row, status: "stale" };
      }

      try {
        // The comparison is in the UPDATE itself. If the company was renamed,
        // archived or acquired a website since planning, there is no write.
        const query = result.supabase.from("companies").update({ website })
          .eq("id", companyId).eq("name", company.name).is("deleted_at", null);
        const { data, error } = await (company.website === null
          ? query.is("website", null)
          : query.eq("website", company.website)).select("id").maybeSingle();
        if (error) return { row, status: "failed" };
        if (!data) return { row, status: "stale" };
      } catch {
        return { row, status: "failed" };
      }

      try {
        // Follow the Companies history convention. Its database trigger sets
        // the actor from the session, not from any importer input.
        const { error } = await result.supabase.from("activity_events").insert({
          event_type: "COMPANY_UPDATED",
          target_type: "company",
          target_id: companyId,
          payload: { field: "website", from: company.website, to: website },
        });
        return { row, status: error ? "history_unavailable" : "saved" };
      } catch {
        return { row, status: "history_unavailable" };
      }
    }));
    outcomes.push(...results);
  }

  if (outcomes.some(({ status }) => status === "saved" || status === "history_unavailable")) {
    revalidatePath("/companies");
    revalidatePath("/companies/[id]", "page");
  }
  return { ok: true, outcomes };
}
