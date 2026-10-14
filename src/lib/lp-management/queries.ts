import { createClient } from "@/lib/supabase/server";
import type { LpData, LpRow } from "@/components/LpFundraising";
export async function loadLpData(
  email: string,
  investorId?: string,
): Promise<LpData | null> {
  const db = await createClient();
  const boards = await db
    .from("lp_boards")
    .select("id")
    .eq("owner_email", email)
    .limit(100);
  const select = (table: string, fields: string) =>
    db.from(table).select(fields).order("id").limit(100);
  const filtered = (table: string, fields: string) => {
    const q = select(table, fields);
    return investorId ? q.eq("investor_id", investorId) : q;
  };
  const results = await Promise.all([
    db
      .from("fundraising_funds")
      .select("id,name,currency,target_amount::text,legal_entity_id")
      .is("archived_at", null)
      .order("name")
      .limit(500),
    db
      .from("investors")
      .select("id,display_name,person_id,company_id")
      .is("archived_at", null)
      .order("display_name")
      .limit(500),
    db
      .from("people")
      .select("id,name")
      .is("archived_at", null)
      .order("name")
      .limit(500),
    db
      .from("companies")
      .select("id,name")
      .is("deleted_at", null)
      .order("name")
      .limit(500),
    db
      .from("legal_entities")
      .select("id,name")
      .is("archived_at", null)
      .order("name")
      .limit(500),
    filtered(
      "lp_pipeline_entries",
      "id,investor_id,fund_id,stage,stage_entered_at,loss_reason",
    ),
    filtered(
      "lp_commitments",
      "id,investor_id,fund_id,currency,amount::text,committed_on,status",
    ),
    filtered(
      "capital_events",
      "id,investor_id,fundraising_fund_id,flow_currency,lp_flow_kind,amount::text,event_date",
    ).not("fundraising_fund_id", "is", null),
    filtered(
      "lp_preferences",
      "id,investor_id,report_frequency,contact_preference,co_investment_interest,notes",
    ),
    filtered("lp_tasks", "id,investor_id,title,due_date,done,assignee_email"),
    boards.data?.length
      ? db
          .from("lp_board_cards")
          .select("id,name")
          .in(
            "board_id",
            boards.data.map((b) => b.id),
          )
          .order("id")
          .limit(500)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (boards.error || results.some((r) => r.error)) return null;
  const entries = (results[5].data ?? []) as unknown as LpRow[];
  const history = entries.length
    ? await db
        .from("lp_stage_history")
        .select(
          "id,entry_id,from_stage,to_stage,entered_at,actor_email,loss_reason",
        )
        .in(
          "entry_id",
          entries.map((e) => e.id),
        )
        .order("entered_at", { ascending: false })
        .limit(100)
    : { data: [], error: null };
  if (history.error) return null;
  const keys = [
    "funds",
    "investors",
    "people",
    "companies",
    "entities",
    "entries",
    "commitments",
    "flows",
    "preferences",
    "tasks",
    "cards",
  ];
  const data = Object.fromEntries(
    results.map((r, i) => [keys[i], r.data ?? []]),
  ) as unknown as LpData;
  data.flows = data.flows.map((f) => ({
    ...f,
    fund_id: f.fundraising_fund_id,
  }));
  data.history = (history.data ?? []) as LpRow[];
  return data;
}
