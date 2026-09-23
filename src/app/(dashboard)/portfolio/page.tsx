import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type PortfolioInvestment = {
  id: string;
  external_ref: string;
  round_label: string | null;
  instrument: string;
  investment_date: string | null;
  total_amount: number | null;
  currency: string;
  funding_status: string;
  company: { id: string; name: string } | null;
  investment_vehicles: {
    vehicle: { id: string; name: string } | null;
  }[];
};

type RequirementRow = {
  investment_id: string | null;
  criticality: string;
  status: string;
};

function formatMoney(value: number | null, currency: string) {
  if (value === null) return "-";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

export default async function PortfolioPage({
  searchParams,
}: {
  searchParams: Promise<{
    vehicle?: string;
    instrument?: string;
    criticalMissing?: string;
  }>;
}) {
  const filters = await searchParams;
  const supabase = await createClient();
  const [{ data: investments }, { data: requirements }, { data: vehicles }] =
    await Promise.all([
      supabase
        .from("investments")
        .select(
          "id,external_ref,round_label,instrument,investment_date,total_amount,currency,funding_status,company:companies(id,name),investment_vehicles(vehicle:legal_entities(id,name))"
        )
        .is("archived_at", null)
        .order("investment_date", { ascending: false }) as unknown as Promise<{
        data: PortfolioInvestment[] | null;
      }>,
      supabase
        .from("document_requirements")
        .select("investment_id,criticality,status")
        .in("scope", ["spv", "spv_company"])
        .is("archived_at", null) as unknown as Promise<{
        data: RequirementRow[] | null;
      }>,
      supabase
        .from("legal_entities")
        .select("id,name")
        .is("archived_at", null)
        .order("name") as unknown as Promise<{
        data: { id: string; name: string }[] | null;
      }>,
    ]);

  const healthByInvestment = new Map<
    string,
    { criticalFound: number; criticalMissing: number; needsReview: number }
  >();
  (requirements ?? []).forEach((row) => {
    if (!row.investment_id) return;
    const health =
      healthByInvestment.get(row.investment_id) ?? {
        criticalFound: 0,
        criticalMissing: 0,
        needsReview: 0,
      };
    if (row.criticality === "critical" && row.status === "received_found") {
      health.criticalFound += 1;
    }
    if (row.criticality === "critical" && row.status === "missing") {
      health.criticalMissing += 1;
    }
    if (row.status === "needs_review") {
      health.needsReview += 1;
    }
    healthByInvestment.set(row.investment_id, health);
  });

  const rows = (investments ?? []).filter((investment) => {
    const vehicleIds = investment.investment_vehicles
      ?.map((row) => row.vehicle?.id)
      .filter(Boolean);
    const health = healthByInvestment.get(investment.id);

    if (filters.vehicle && !vehicleIds?.includes(filters.vehicle)) return false;
    if (filters.instrument && investment.instrument !== filters.instrument) {
      return false;
    }
    if (filters.criticalMissing === "1" && !health?.criticalMissing) {
      return false;
    }
    return true;
  });
  const instruments = [...new Set((investments ?? []).map((row) => row.instrument))];

  return (
    <div className="flex flex-col gap-4 px-7 py-6">
      <header>
        <div className="mb-2 rounded-[14px] border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] font-semibold text-amber-900">
          Internal - contains SPV ledger and investor data. Never share externally or upload to the investor portal.
        </div>
        <h1 className="font-[family-name:var(--font-display)] text-[23px] font-semibold tracking-tight text-ink">
          Portfolio
        </h1>
        <p className="mt-1 text-[13px] text-neutral-500">
          Investments, vehicles, investors and legal document health.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2 rounded-[14px] border border-neutral-100 bg-white px-3 py-2">
        <Link
          href="/portfolio"
          className="rounded-lg border border-neutral-200 px-3 py-1.5 text-[11.5px] font-semibold text-neutral-600 transition hover:border-neutral-300 hover:text-neutral-800"
        >
          Clear
        </Link>
        {(vehicles ?? []).map((vehicle) => (
          <Link
            key={vehicle.id}
            href={`/portfolio?vehicle=${vehicle.id}`}
            className={`rounded-lg border px-3 py-1.5 text-[11.5px] font-semibold transition ${
              filters.vehicle === vehicle.id
                ? "border-cyan-300 text-cyan-800"
                : "border-neutral-200 text-neutral-600 hover:border-cyan-300 hover:text-cyan-800"
            }`}
          >
            {vehicle.name}
          </Link>
        ))}
        {instruments.map((instrument) => (
          <Link
            key={instrument}
            href={`/portfolio?instrument=${instrument}`}
            className={`rounded-lg border px-3 py-1.5 text-[11.5px] font-semibold transition ${
              filters.instrument === instrument
                ? "border-cyan-300 text-cyan-800"
                : "border-neutral-200 text-neutral-600 hover:border-cyan-300 hover:text-cyan-800"
            }`}
          >
            {instrument.replaceAll("_", " ")}
          </Link>
        ))}
        <Link
          href="/portfolio?criticalMissing=1"
          className={`rounded-lg border px-3 py-1.5 text-[11.5px] font-semibold transition ${
            filters.criticalMissing === "1"
              ? "border-cyan-300 text-cyan-800"
              : "border-neutral-200 text-neutral-600 hover:border-cyan-300 hover:text-cyan-800"
          }`}
        >
          Has critical missing
        </Link>
      </div>

      <div className="overflow-hidden rounded-[14px] border border-neutral-100 bg-white">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="border-b border-neutral-100 text-left text-[10.5px] uppercase tracking-wide text-neutral-400">
              <th className="px-4 py-3 font-semibold">Company</th>
              <th className="px-4 py-3 font-semibold">Round</th>
              <th className="px-4 py-3 font-semibold">Instrument</th>
              <th className="px-4 py-3 font-semibold">Date</th>
              <th className="px-4 py-3 font-semibold">Amount</th>
              <th className="px-4 py-3 font-semibold">Vehicle(s)</th>
              <th className="px-4 py-3 font-semibold">Funding</th>
              <th className="px-4 py-3 font-semibold">Documents</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((investment) => {
              const health = healthByInvestment.get(investment.id) ?? {
                criticalFound: 0,
                criticalMissing: 0,
                needsReview: 0,
              };

              return (
                <tr key={investment.id} className="border-b border-neutral-50 last:border-0">
                  <td className="px-4 py-3">
                    <Link
                      href={`/companies/${investment.company?.id}`}
                      className="font-semibold text-ink hover:text-cyan-700"
                    >
                      {investment.company?.name ?? "Unknown"}
                    </Link>
                    <div className="text-[10.5px] text-neutral-400">
                      {investment.external_ref}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-neutral-600">
                    {investment.round_label ?? "-"}
                  </td>
                  <td className="px-4 py-3 text-neutral-600">
                    {investment.instrument.replaceAll("_", " ")}
                  </td>
                  <td className="px-4 py-3 text-neutral-600">
                    {investment.investment_date
                      ? new Date(investment.investment_date).toLocaleDateString()
                      : "-"}
                  </td>
                  <td className="px-4 py-3 text-neutral-600">
                    {formatMoney(investment.total_amount, investment.currency)}
                  </td>
                  <td className="px-4 py-3 text-neutral-600">
                    <div className="flex flex-col gap-1">
                      {investment.investment_vehicles?.length ? (
                        investment.investment_vehicles.map((row) =>
                          row.vehicle ? (
                            <Link
                              key={row.vehicle.id}
                              href={`/portfolio/vehicles/${row.vehicle.id}`}
                              className="hover:text-cyan-700"
                            >
                              {row.vehicle.name}
                            </Link>
                          ) : null
                        )
                      ) : (
                        <span>Direct / to confirm</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-neutral-600">
                    {investment.funding_status.replaceAll("_", " ")}
                  </td>
                  <td className="px-4 py-3 text-neutral-600">
                    <span className="font-semibold text-ink">
                      {health.criticalFound}
                    </span>{" "}
                    found /{" "}
                    <span className="font-semibold text-red-600">
                      {health.criticalMissing}
                    </span>{" "}
                    missing /{" "}
                    <span className="font-semibold text-amber-600">
                      {health.needsReview}
                    </span>{" "}
                    review
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-neutral-400">
                  No portfolio investments loaded.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
