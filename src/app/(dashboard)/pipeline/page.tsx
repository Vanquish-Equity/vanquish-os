import { createClient } from "@/lib/supabase/server";
import PipelineColumn from "@/components/PipelineColumn";

export const dynamic = "force-dynamic";

type Stage = { id: string; name: string; sort_order: number };
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

  const [{ data: stages }, { data: deals }] = await Promise.all([
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
  ]);

  const dealsByStage = new Map<string, Deal[]>();
  (deals ?? []).forEach((d) => {
    const list = dealsByStage.get(d.stage_id) ?? [];
    list.push(d);
    dealsByStage.set(d.stage_id, list);
  });

  const totalDeals = deals?.length ?? 0;

  return (
    <div className="flex flex-col gap-4 px-7 py-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-[23px] font-semibold tracking-tight text-ink">
            Pipeline
          </h1>
          <p className="mt-1 text-[13px] text-neutral-500">
            Companies persist. Each investment round is its own deal.{" "}
            {totalDeals === 0 && "No deals yet — add one in Supabase or wait for the migration."}
          </p>
        </div>
      </header>

      {!stages?.length ? (
        <div className="rounded-[14px] border border-neutral-100 bg-white p-6 text-sm text-neutral-500">
          No pipeline stages found. Run the M1 migration in Supabase first.
        </div>
      ) : (
        <div
          className="grid gap-3"
          style={{
            gridTemplateColumns: `repeat(${stages.length}, minmax(240px, 1fr))`,
          }}
        >
          {stages.map((stage) => (
            <PipelineColumn
              key={stage.id}
              stageName={stage.name}
              deals={dealsByStage.get(stage.id) ?? []}
            />
          ))}
        </div>
      )}
    </div>
  );
}
