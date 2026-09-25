import type { createClient } from "@/lib/supabase/server";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

// Returns an error message unless the deal is active and belongs to the
// company. Used before linking a record to one specific round.
export async function activeDealInCompanyError(
  supabase: SupabaseClient,
  dealId: string,
  companyId: string
): Promise<string | null> {
  const { data: deal, error } = await supabase
    .from("deals")
    .select("company_id")
    .eq("id", dealId)
    .is("archived_at", null)
    .maybeSingle();

  if (error) return error.message;
  if (!deal || deal.company_id !== companyId) {
    return "Choose an active deal belonging to this company.";
  }
  return null;
}
