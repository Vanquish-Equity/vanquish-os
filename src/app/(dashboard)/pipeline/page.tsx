import { createClient } from "@/lib/supabase/server";
import NewDealModal from "@/components/NewDealModal";
import PipelineBoard from "@/components/PipelineBoard";
import Link from "next/link";

export const dynamic = "force-dynamic";

type Stage = { id: string; name: string; sort_order: number };
type Option = { id: string; name: string };
type Deal = {
  id: string;
  name: string;
  potential_investment: number | null;
  updated_at: string;
  stage_id: string;
  stage: { name: string; is_terminal: boolean } | null;
  company: { id: string; name: string } | null;
  priority: { name: string } | null;
  outcome: { name: string } | null;
};

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<{
    filter?: string;
    hideTerminal?: string;
    priority?: string;
    stage?: string;
  }>;
}) {
  const { filter, hideTerminal, priority, stage } = await searchParams;
  const shouldHideTerminal = hideTerminal === "1" || filter === "active";
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
        .eq("is_active", true)
        .order("sort_order") as unknown as Promise<{ data: Stage[] }>,
      supabase
        .from("deals")
        .select(
          "id,name,potential_investment,updated_at,stage_id,stage:pipeline_stages(name,is_terminal),outcome:deal_outcomes(name),company:companies!inner(id,name,deleted_at),priority:priorities(name)"
        )
        .is("company.deleted_at", null)
        .is("archived_at", null)
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

  const visibleDeals = (deals ?? []).filter((deal) => {
    if (shouldHideTerminal && (deal.outcome || deal.stage?.is_terminal)) return false;
    if (stage && deal.stage?.name !== stage) return false;
    if (priority && deal.priority?.name !== priority) return false;
    return true;
  });
  const totalDeals = visibleDeals.length;
  const boardKey = [
    ...(stages ?? []).map((stage) => stage.id),
    ...visibleDeals.map((deal) => `${deal.id}:${deal.stage_id}:${deal.updated_at}`),
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

      <div className="flex items-center justify-between rounded-[14px] border border-neutral-100 bg-white px-3 py-2">
        <div className="text-[12px] text-neutral-500">
          Terminal outcome filter:{" "}
          <span className="font-semibold text-ink">
            {shouldHideTerminal ? "hidden" : "visible"}
          </span>
        </div>
        <Link
          href={shouldHideTerminal ? "/pipeline" : "/pipeline?hideTerminal=1"}
          className="rounded-lg border border-neutral-200 px-3 py-1.5 text-[11.5px] font-semibold text-neutral-600 transition hover:border-cyan-300 hover:text-cyan-800"
        >
          {shouldHideTerminal ? "Show terminal outcomes" : "Hide terminal outcomes"}
        </Link>
      </div>

      {!stages?.length ? (
        <div className="rounded-[14px] border border-neutral-100 bg-white p-6 text-sm text-neutral-500">
          No pipeline stages found. Run the M1 migration in Supabase first.
        </div>
      ) : (
        <PipelineBoard key={boardKey} stages={stages} deals={visibleDeals} />
      )}
    </div>
  );
}
