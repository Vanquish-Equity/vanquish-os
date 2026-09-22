import { createClient } from "@/lib/supabase/server";
import NewDealModal from "@/components/NewDealModal";
import PipelineBoard from "@/components/PipelineBoard";

export const dynamic = "force-dynamic";

type Stage = { id: string; name: string; sort_order: number };
type Option = { id: string; name: string };
type Deal = {
  id: string;
  name: string;
  potential_investment: number | null;
  updated_at: string;
  stage_id: string;
  company: { id: string; name: string } | null;
  priority: { name: string } | null;
};

export default async function PipelinePage() {
  const supabase = await createClient();

  const [
    { data: stages },
    { data: deals },
    { data: industries },
    { data: priorities },
  ] = await Promise.all([
    supabase
      .from("pipeline_stages")
      .select("id,name,sort_order")
      .order("sort_order") as unknown as Promise<{ data: Stage[] }>,
    supabase
      .from("deals")
      .select(
        "id,name,potential_investment,updated_at,stage_id,company:companies(id,name),priority:priorities(name)"
      )
      .order("updated_at", { ascending: false }) as unknown as Promise<{
      data: Deal[];
    }>,
    supabase
      .from("industries")
      .select("id,name")
      .order("name") as unknown as Promise<{ data: Option[] }>,
    supabase
      .from("priorities")
      .select("id,name")
      .order("sort_order") as unknown as Promise<{ data: Option[] }>,
  ]);

  const totalDeals = deals?.length ?? 0;
  const boardKey = [
    ...(stages ?? []).map((stage) => stage.id),
    ...(deals ?? []).map((deal) => `${deal.id}:${deal.stage_id}:${deal.updated_at}`),
  ].join("|");

  return (
    <div className="flex flex-col gap-4 px-7 py-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-[23px] font-semibold tracking-tight text-ink">
            Pipeline
          </h1>
          <p className="mt-1 text-[13px] text-neutral-500">
            Companies persist. Each investment round is its own deal.{" "}
            {totalDeals === 0 && "No deals yet — add one in Supabase or wait for the migration."}
          </p>
        </div>
        <NewDealModal
          industries={industries ?? []}
          stages={stages ?? []}
          priorities={priorities ?? []}
        />
      </header>

      {!stages?.length ? (
        <div className="rounded-[14px] border border-neutral-100 bg-white p-6 text-sm text-neutral-500">
          No pipeline stages found. Run the M1 migration in Supabase first.
        </div>
      ) : (
        <PipelineBoard key={boardKey} stages={stages} deals={deals ?? []} />
      )}
    </div>
  );
}
