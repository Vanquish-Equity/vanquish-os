import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

function formatMoney(n: number | null) {
  if (!n) return "—";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n}`;
}

export default async function CompanyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: company } = (await supabase
    .from("companies")
    .select("id,name,description,website,industry:industries(name)")
    .eq("id", id)
    .maybeSingle()) as unknown as {
    data: {
      id: string;
      name: string;
      description: string | null;
      website: string | null;
      industry: { name: string } | null;
    } | null;
  };

  if (!company) notFound();

  const { data: deals } = await supabase
    .from("deals")
    .select(
      "id,name,potential_investment,round,owner,updated_at,stage:pipeline_stages(name),priority:priorities(name)"
    )
    .eq("company_id", id)
    .order("updated_at", { ascending: false });

  const primaryDeal = deals?.[0] as
    | {
        id: string;
        name: string;
        potential_investment: number | null;
        round: string | null;
        owner: string | null;
        stage: { name: string } | null;
        priority: { name: string } | null;
      }
    | undefined;

  const [{ data: history }, { data: interactions }, { data: people }] =
    await Promise.all([
      primaryDeal
        ? supabase
            .from("deal_status_history")
            .select("id,changed_at,changed_by,note,stage:pipeline_stages(name)")
            .eq("deal_id", primaryDeal.id)
            .order("changed_at", { ascending: false })
        : Promise.resolve({ data: [] }),
      supabase
        .from("interactions")
        .select("id,type,occurred_at,subject,summary,created_by")
        .eq("company_id", id)
        .order("occurred_at", { ascending: false })
        .limit(10),
      supabase
        .from("people")
        .select("id,name,title,linkedin_url")
        .eq("primary_organization_id", id),
    ]);

  return (
    <div className="flex flex-col gap-4 px-7 py-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400">
            Company{primaryDeal ? " / Active Deal" : ""}
          </div>
          <h1 className="font-[family-name:var(--font-display)] text-[25px] font-semibold tracking-tight text-ink">
            {company.name}
          </h1>
          <p className="mt-1 text-[13px] text-neutral-500">
            {primaryDeal?.round ?? "No active deal"}
            {company.industry?.name ? ` · ${company.industry.name}` : ""}
          </p>
        </div>
        {primaryDeal && (
          <div className="flex flex-shrink-0 gap-2">
            {primaryDeal.priority?.name && (
              <span className="rounded-full border border-cyan-200 bg-cyan-50 px-2.5 py-1 text-[11px] font-semibold text-cyan-800">
                {primaryDeal.priority.name} priority
              </span>
            )}
            {primaryDeal.stage?.name && (
              <span className="rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-[11px] font-semibold text-neutral-600">
                {primaryDeal.stage.name}
              </span>
            )}
          </div>
        )}
      </header>

      <div className="grid grid-cols-[2fr_1fr] gap-3.5">
        <div className="flex flex-col gap-3.5">
          {primaryDeal && (
            <div className="rounded-[14px] border border-neutral-100 bg-white p-5">
              <h2 className="mb-3.5 text-[14.5px] font-semibold text-ink">
                Deal Overview
              </h2>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="mb-1 text-[10.5px] uppercase tracking-wide text-neutral-400">
                    Stage
                  </div>
                  <div className="text-[13px] font-semibold">
                    {primaryDeal.stage?.name ?? "—"}
                  </div>
                </div>
                <div>
                  <div className="mb-1 text-[10.5px] uppercase tracking-wide text-neutral-400">
                    Priority
                  </div>
                  <div className="text-[13px] font-semibold">
                    {primaryDeal.priority?.name ?? "—"}
                  </div>
                </div>
                <div>
                  <div className="mb-1 text-[10.5px] uppercase tracking-wide text-neutral-400">
                    Owner
                  </div>
                  <div className="text-[13px] font-semibold">
                    {primaryDeal.owner ?? "—"}
                  </div>
                </div>
                <div>
                  <div className="mb-1 text-[10.5px] uppercase tracking-wide text-neutral-400">
                    Potential Investment
                  </div>
                  <div className="text-[13px] font-semibold">
                    {formatMoney(primaryDeal.potential_investment)}
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="rounded-[14px] border border-neutral-100 bg-white p-5">
            <h2 className="mb-3 text-[14.5px] font-semibold text-ink">
              Status History
            </h2>
            <div className="relative pl-4.5">
              {(history ?? []).length === 0 && (
                <p className="text-[12px] text-neutral-400">
                  No status changes recorded yet.
                </p>
              )}
              {(history ?? []).map((h) => (
                <div key={h.id} className="relative mb-3.5 last:mb-0">
                  <div className="mb-0.5 text-[10px] tracking-wide text-neutral-400">
                    {new Date(h.changed_at).toLocaleString()}
                  </div>
                  <div className="text-[12.5px] text-neutral-800">
                    Moved to{" "}
                    <strong>
                      {(h.stage as unknown as { name: string } | null)?.name}
                    </strong>
                    {h.changed_by ? ` · ${h.changed_by}` : ""}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[14px] border border-neutral-100 bg-white p-5">
            <h2 className="mb-3 text-[14.5px] font-semibold text-ink">
              Recent Activity
            </h2>
            <div className="flex flex-col gap-3">
              {(interactions ?? []).length === 0 && (
                <p className="text-[12px] text-neutral-400">
                  No interactions logged yet.
                </p>
              )}
              {(interactions ?? []).map((i) => (
                <div
                  key={i.id}
                  className="border-b border-neutral-50 pb-3 last:border-0 last:pb-0"
                >
                  <div className="mb-0.5 text-[10px] uppercase tracking-wide text-neutral-400">
                    {i.type} · {new Date(i.occurred_at).toLocaleDateString()}
                  </div>
                  <div className="text-[12.5px] font-medium text-ink">
                    {i.subject}
                  </div>
                  {i.summary && (
                    <div className="mt-0.5 text-[12px] text-neutral-500">
                      {i.summary}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3.5">
          <div className="rounded-[14px] border border-neutral-100 bg-white p-5">
            <h2 className="mb-3 text-[14.5px] font-semibold text-ink">
              People
            </h2>
            <div className="flex flex-col gap-3">
              {(people ?? []).length === 0 && (
                <p className="text-[12px] text-neutral-400">
                  No people linked yet.
                </p>
              )}
              {(people ?? []).map((p) => (
                <div key={p.id} className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-[#f0fafb] text-[11px] font-semibold text-cyan-800">
                    {p.name
                      .split(" ")
                      .map((n: string) => n[0])
                      .slice(0, 2)
                      .join("")}
                  </div>
                  <div>
                    <div className="text-[12.5px] font-semibold">{p.name}</div>
                    <div className="text-[11px] text-neutral-500">
                      {p.title ?? "—"}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {company.website && (
            <div className="rounded-[14px] border border-neutral-100 bg-white p-5">
              <h2 className="mb-2 text-[14.5px] font-semibold text-ink">
                Website
              </h2>
              <a
                href={company.website}
                target="_blank"
                rel="noreferrer"
                className="text-[12.5px] text-cyan-700 hover:underline"
              >
                {company.website}
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
