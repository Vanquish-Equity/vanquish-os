import Link from "next/link";
import { notFound } from "next/navigation";
import RequirementInlineControls from "@/components/RequirementInlineControls";
import { humanizeCode, labelForCriticality } from "@/lib/labels";
import { startDevPageTimer } from "@/lib/performance";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Investor = {
  id: string;
  display_name: string;
  legal_name: string | null;
  investor_type: string;
  notes: string | null;
};

type Position = {
  id: string;
  amount: number | null;
  units_or_shares: number | null;
  status: string;
  vehicle: { id: string; name: string } | null;
  investment: {
    id: string;
    external_ref: string;
    round_label: string | null;
    company: { id: string; name: string } | null;
  } | null;
};

type Requirement = {
  id: string;
  expected_label: string;
  criticality: string;
  status: string;
  executed: string;
  notes: string | null;
  drive_url: string | null;
  found_file_name: string | null;
  position_id: string | null;
};

function formatMoney(value: number | null) {
  if (value === null) return "-";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

export default async function InvestorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const path = `/portfolio/investors/${id}`;
  const endTimer = startDevPageTimer(`page:data:investor:${id}`);

  const [{ data: investor }, { data: aliases }, { data: positions }] =
    await Promise.all([
      supabase
        .from("investors")
        .select("id,display_name,legal_name,investor_type,notes")
        .eq("id", id)
        .maybeSingle() as unknown as Promise<{ data: Investor | null }>,
    supabase
      .from("investor_aliases")
      .select("alias,source")
      .eq("investor_id", id)
      .order("alias") as unknown as Promise<{
      data: { alias: string; source: string | null }[] | null;
    }>,
    supabase
      .from("investor_positions")
      .select(
        "id,amount,units_or_shares,status,vehicle:legal_entities(id,name),investment:investments(id,external_ref,round_label,company:companies(id,name))"
      )
      .eq("investor_id", id)
      .is("archived_at", null)
      .order("created_at") as unknown as Promise<{ data: Position[] | null }>,
  ]);

  if (!investor) notFound();

  const positionIds = (positions ?? []).map((position) => position.id);
  const { data: requirements } = positionIds.length
    ? ((await supabase
        .from("document_requirements")
        .select(
          "id,expected_label,criticality,status,executed,notes,drive_url,found_file_name,position_id"
        )
        .eq("scope", "investor_spv")
        .in("position_id", positionIds)
        .is("archived_at", null)) as unknown as { data: Requirement[] | null })
    : { data: [] as Requirement[] };
  endTimer();

  return (
    <div className="flex flex-col gap-4 px-7 py-6">
      <header>
        <div className="mb-2 rounded-[14px] border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] font-semibold text-amber-900">
          Internal - this page is the future investor portal scope. It shows only this investor&apos;s positions and Investor to SPV documents.
        </div>
        <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400">
          <Link href="/portfolio" className="hover:text-cyan-700">
            Portfolio
          </Link>{" "}
          / Investors / {investor.display_name}
        </div>
        <h1 className="font-[family-name:var(--font-display)] text-[25px] font-semibold tracking-tight text-ink">
          {investor.display_name}
        </h1>
        <p className="mt-1 text-[13px] text-neutral-500">
          {investor.legal_name ?? "Legal name to confirm"} /{" "}
          {humanizeCode(investor.investor_type)}
        </p>
      </header>

      <div className="grid grid-cols-[1fr_1.4fr] gap-3.5">
        <div className="vq-card rounded-[14px] bg-white p-5">
          <h2 className="mb-3 text-[14.5px] font-semibold text-ink">
            Investor Details
          </h2>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[12.5px]">
            <dt className="text-neutral-400">Aliases</dt>
            <dd className="font-medium text-ink">
              {(aliases ?? []).map((alias) => alias.alias).join(", ") || "-"}
            </dd>
            <dt className="text-neutral-400">Notes</dt>
            <dd className="font-medium text-ink">{investor.notes ?? "-"}</dd>
          </dl>
        </div>

        <div className="vq-card rounded-[14px] bg-white p-5">
          <h2 className="mb-3 text-[14.5px] font-semibold text-ink">
            Positions
          </h2>
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-neutral-100 text-left text-[10.5px] uppercase tracking-wide text-neutral-400">
                <th className="px-3 py-2 font-semibold">Company</th>
                <th className="px-3 py-2 font-semibold">Vehicle</th>
                <th className="px-3 py-2 font-semibold">Amount</th>
                <th className="px-3 py-2 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {(positions ?? []).map((position) => (
                <tr key={position.id} className="border-b border-neutral-50 last:border-0">
                  <td className="px-3 py-2">
                    <Link
                      href={`/companies/${position.investment?.company?.id}`}
                      className="font-semibold text-ink hover:text-cyan-700"
                    >
                      {position.investment?.company?.name ?? "Unknown"}
                    </Link>
                    <div className="text-[10.5px] text-neutral-400">
                      {position.investment?.round_label ??
                        position.investment?.external_ref}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-neutral-600">
                    {position.vehicle ? (
                      <Link
                        href={`/portfolio/vehicles/${position.vehicle.id}`}
                        className="hover:text-cyan-700"
                      >
                        {position.vehicle.name}
                      </Link>
                    ) : (
                      "Direct / to confirm"
                    )}
                  </td>
                  <td className="px-3 py-2 text-neutral-600">
                    {formatMoney(position.amount)}
                  </td>
                  <td className="px-3 py-2 text-neutral-600">
                    {humanizeCode(position.status)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="vq-card-static rounded-[14px] bg-white p-5">
        <h2 className="mb-3 text-[14.5px] font-semibold text-ink">
          Investor to SPV Documents
        </h2>
        <div className="vq-card-grid flex flex-col gap-2">
          {(requirements ?? []).length === 0 && (
            <p className="rounded-xl border border-dashed border-neutral-200 px-3 py-4 text-center text-[12px] text-neutral-400">
              No investor-specific requirements loaded.
            </p>
          )}
          {(requirements ?? []).map((row) => (
            <div
              key={row.id}
              className="grid grid-cols-[1fr_240px] gap-3 rounded-xl border border-neutral-100 p-3"
            >
              <div className="min-w-0">
                <div className="truncate text-[12.5px] font-semibold text-ink">
                  {row.expected_label}
                </div>
                <div className="mt-0.5 text-[10.5px] uppercase tracking-wide text-neutral-400">
                  {labelForCriticality(row.criticality)}
                </div>
                {(row.drive_url || row.found_file_name || row.notes) && (
                  <div className="mt-1 text-[11.5px] text-neutral-500">
                    {row.drive_url ? (
                      <a
                        href={row.drive_url}
                        target="_blank"
                        rel="noreferrer"
                        className="font-semibold text-cyan-700 hover:underline"
                      >
                        {row.found_file_name ?? "Drive link"}
                      </a>
                    ) : (
                      row.found_file_name
                    )}
                    {row.notes ? ` / ${row.notes}` : ""}
                  </div>
                )}
              </div>
              <RequirementInlineControls
                requirementId={row.id}
                status={row.status}
                executed={row.executed}
                revalidatePath={path}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
