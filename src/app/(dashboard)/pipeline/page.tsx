import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

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

function formatMoney(n: number | null) {
  if (!n) return null;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n}`;
}

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
          {stages.map((stage) => {
            const stageDeals = dealsByStage.get(stage.id) ?? [];
            return (
              <div key={stage.id} className="rounded-[14px] bg-[#f7f9fa] p-3">
                <div className="mb-3 flex items-center justify-between px-1.5 pt-0.5">
                  <span className="text-xs font-semibold text-neutral-700">
                    {stage.name}
                  </span>
                  <span className="rounded-full bg-[#eef1f2] px-1.5 py-0.5 text-[11px] text-neutral-500">
                    {stageDeals.length}
                  </span>
                </div>
                <div className="flex flex-col gap-2.5">
                  {stageDeals.map((deal) => (
                    <Link
                      key={deal.id}
                      href={`/companies/${deal.company?.id}`}
                      className="block rounded-xl border border-neutral-100 bg-white p-3.5 hover:border-cyan-200"
                    >
                      <div className="mb-2 flex items-start justify-between gap-2">
                        <h3 className="text-[12.5px] font-semibold text-ink">
                          {deal.company?.name ?? deal.name}
                        </h3>
                        {deal.priority?.name === "High" && (
                          <span className="rounded-full border border-cyan-200 bg-cyan-50 px-2 py-0.5 text-[10.5px] font-semibold text-cyan-800">
                            High
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-neutral-500">
                        {deal.name}
                        {formatMoney(deal.potential_investment) &&
                          ` · ${formatMoney(deal.potential_investment)}`}
                      </div>
                    </Link>
                  ))}
                  {stageDeals.length === 0 && (
                    <div className="rounded-xl border border-dashed border-neutral-200 p-3.5 text-center text-[11px] text-neutral-400">
                      No deals
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
