import Link from "next/link";
import RestrictedArea from "@/components/RestrictedArea";
import { hasPermission } from "@/lib/auth/access";
import { notFound } from "next/navigation";
import ApplyPortfolioTemplateButton from "@/components/ApplyPortfolioTemplateButton";
import RequirementInlineControls from "@/components/RequirementInlineControls";
import { FormSelectMenu } from "@/components/SelectMenu";
import { addCapitalEventAction } from "@/lib/portfolio/actions";
import {
  labelForCriticality,
  labelForEventType,
  labelForInstrument,
  labelForVehicleStatus,
} from "@/lib/labels";
import { startDevPageTimer } from "@/lib/performance";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Vehicle = {
  id: string;
  name: string;
  entity_type: string;
  jurisdiction: string | null;
  vehicle_status: string;
  formation_date: string | null;
  resident_agent: string | null;
  notes: string | null;
};

type Position = {
  id: string;
  amount: number | null;
  units_or_shares: number | null;
  status: string;
  investor: { id: string; display_name: string } | null;
  investment: {
    id: string;
    external_ref: string;
    round_label: string | null;
    company: { id: string; name: string } | null;
  } | null;
};

type InvestmentVehicle = {
  investment: {
    id: string;
    external_ref: string;
    round_label: string | null;
    instrument: string;
    company: { id: string; name: string } | null;
  } | null;
};

type Requirement = {
  id: string;
  scope: string;
  expected_label: string;
  criticality: string;
  status: string;
  executed: string;
  notes: string | null;
  drive_url: string | null;
  found_file_name: string | null;
  investment_id: string | null;
  position_id: string | null;
};

type CapitalEvent = {
  id: string;
  event_type: string;
  event_date: string | null;
  amount: number | null;
  shares_before: number | null;
  shares_after: number | null;
  description: string | null;
};

function formatMoney(value: number | null) {
  if (value === null) return "-";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function templateForVehicle(entityType: string) {
  return entityType === "sa" ? "SPV_SA_PANAMA" : "SPV_LLC";
}

function investorTemplateForVehicle(entityType: string) {
  return entityType === "sa" ? "INVESTOR_SPV_SA_PANAMA" : "INVESTOR_SPV_LLC";
}

function companyTemplateForInstrument(instrument: string) {
  if (instrument === "safe") return "COMPANY_SAFE";
  if (instrument === "convertible_note") return "COMPANY_CONVERTIBLE_NOTE";
  return "COMPANY_PREFERRED_EQUITY";
}

function matchesRequirementFilter(row: Requirement, filter: string | undefined) {
  if (filter === "critical_missing") {
    return row.criticality === "critical" && row.status === "missing";
  }
  if (filter === "needs_review") return row.status === "needs_review";
  if (filter === "open_gaps") {
    return row.status === "missing" || row.status === "needs_review";
  }
  return true;
}

function RequirementTable({
  emptyText = "No checklist items match this filter.",
  title,
  rows,
  path,
}: {
  emptyText?: string;
  title: string;
  rows: Requirement[];
  path: string;
}) {
  return (
    <div className="vq-card rounded-[14px] bg-white p-5">
      <h2 className="mb-3 text-[14.5px] font-semibold text-ink">{title}</h2>
      <div className="flex flex-col gap-2">
        {rows.length === 0 && (
          <p className="rounded-xl border border-dashed border-neutral-200 px-3 py-4 text-center text-[12px] text-neutral-400">
            {emptyText}
          </p>
        )}
        {rows.map((row) => (
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
  );
}

export default async function VehiclePage({
  searchParams,
  params,
}: {
  searchParams: Promise<{ filter?: string; investment?: string }>;
  params: Promise<{ id: string }>;
}) {
  if (!(await hasPermission("portfolio"))) return <RestrictedArea area="Portfolio" />;
  const { id } = await params;
  const checklistFilters = await searchParams;
  const supabase = await createClient();
  const path = `/portfolio/vehicles/${id}`;
  const endTimer = startDevPageTimer(`page:data:vehicle:${id}`);

  const [
    { data: vehicle },
    { data: aliases },
    { data: positions },
    { data: investmentVehicles },
    { data: capitalEvents },
  ] = await Promise.all([
    supabase
      .from("legal_entities")
      .select(
        "id,name,entity_type,jurisdiction,vehicle_status,formation_date,resident_agent,notes"
      )
      .eq("id", id)
      .maybeSingle() as unknown as Promise<{ data: Vehicle | null }>,
    supabase
      .from("legal_entity_aliases")
      .select("alias,source")
      .eq("legal_entity_id", id)
      .order("alias") as unknown as Promise<{
      data: { alias: string; source: string | null }[] | null;
    }>,
    supabase
      .from("investor_positions")
      .select(
        "id,amount,units_or_shares,status,investor:investors(id,display_name),investment:investments(id,external_ref,round_label,company:companies(id,name))"
      )
      .eq("vehicle_id", id)
      .is("archived_at", null)
      .order("created_at") as unknown as Promise<{ data: Position[] | null }>,
    supabase
      .from("investment_vehicles")
      .select(
        "investment:investments(id,external_ref,round_label,instrument,company:companies(id,name))"
      )
      .eq("vehicle_id", id) as unknown as Promise<{
      data: InvestmentVehicle[] | null;
    }>,
    supabase
      .from("capital_events")
      .select("id,event_type,event_date,amount,shares_before,shares_after,description")
      .eq("vehicle_id", id)
      .order("event_date", { ascending: false, nullsFirst: false }) as unknown as Promise<{
      data: CapitalEvent[] | null;
    }>,
  ]);

  if (!vehicle) notFound();

  const vehicleInvestments = (investmentVehicles ?? [])
    .map((row) => row.investment)
    .filter(Boolean) as NonNullable<InvestmentVehicle["investment"]>[];
  const investmentIds = new Set(vehicleInvestments.map((investment) => investment.id));
  const positionIds = new Set((positions ?? []).map((position) => position.id));
  const requirementFilters = [`vehicle_id.eq.${id}`];
  if (investmentIds.size > 0) {
    requirementFilters.push(`investment_id.in.(${[...investmentIds].join(",")})`);
  }
  if (positionIds.size > 0) {
    requirementFilters.push(`position_id.in.(${[...positionIds].join(",")})`);
  }
  const { data: requirements } = (await supabase
    .from("document_requirements")
    .select(
      "id,scope,expected_label,criticality,status,executed,notes,drive_url,found_file_name,investment_id,position_id"
    )
    .or(requirementFilters.join(","))
    .is("archived_at", null)) as unknown as { data: Requirement[] | null };
  endTimer();
  const spvRequirements = (requirements ?? []).filter((row) => row.scope === "spv");
  const investorRequirements = (requirements ?? []).filter(
    (row) => row.scope === "investor_spv" && row.position_id && positionIds.has(row.position_id)
  );
  const companyRequirements = (requirements ?? []).filter(
    (row) =>
      row.scope === "spv_company" &&
      row.investment_id &&
      investmentIds.has(row.investment_id)
  );
  const filteredSpvRequirements = spvRequirements.filter((row) =>
    matchesRequirementFilter(row, checklistFilters.filter)
  );
  const filteredInvestorRequirements = investorRequirements.filter((row) =>
    matchesRequirementFilter(row, checklistFilters.filter)
  );
  const filteredCompanyRequirements = companyRequirements.filter((row) => {
    if (
      checklistFilters.investment &&
      row.investment_id !== checklistFilters.investment
    ) {
      return false;
    }
    return matchesRequirementFilter(row, checklistFilters.filter);
  });
  const totalCapital = (positions ?? []).reduce(
    (sum, position) => sum + (position.amount ?? 0),
    0
  );
  async function addCapitalEvent(formData: FormData) {
    "use server";
    await addCapitalEventAction(formData);
  }

  return (
    <div className="flex flex-col gap-4 px-7 py-6">
      <header>
        <div className="mb-2 rounded-[14px] border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] font-semibold text-amber-900">
          Internal - SPV ledger and cap table. Never expose this view to investors.
        </div>
        <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400">
          <Link href="/portfolio" className="hover:text-cyan-700">
            Portfolio
          </Link>{" "}
          / Vehicle
        </div>
        <h1 className="font-[family-name:var(--font-display)] text-[25px] font-semibold tracking-tight text-ink">
          {vehicle.name}
        </h1>
        <p className="mt-1 text-[13px] text-neutral-500">
          {vehicle.entity_type.toUpperCase()} / {vehicle.jurisdiction ?? "Jurisdiction to confirm"} /{" "}
          {labelForVehicleStatus(vehicle.vehicle_status)}
        </p>
      </header>

      <div className="grid grid-cols-[1fr_1fr] gap-3.5">
        <div className="vq-card rounded-[14px] bg-white p-5">
          <div className="mb-3 flex items-start justify-between gap-3">
            <h2 className="text-[14.5px] font-semibold text-ink">Vehicle Details</h2>
            <ApplyPortfolioTemplateButton
              label="Start SPV checklist"
              templateCode={templateForVehicle(vehicle.entity_type)}
              scope="spv"
              vehicleId={vehicle.id}
              revalidatePath={path}
            />
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[12.5px]">
            <dt className="text-neutral-400">Formation date</dt>
            <dd className="font-medium text-ink">{vehicle.formation_date ?? "-"}</dd>
            <dt className="text-neutral-400">Resident agent</dt>
            <dd className="font-medium text-ink">{vehicle.resident_agent ?? "-"}</dd>
            <dt className="text-neutral-400">Aliases</dt>
            <dd className="font-medium text-ink">
              {(aliases ?? []).map((alias) => alias.alias).join(", ") || "-"}
            </dd>
            <dt className="text-neutral-400">Notes</dt>
            <dd className="font-medium text-ink">{vehicle.notes ?? "-"}</dd>
          </dl>
        </div>

        <div className="vq-card rounded-[14px] bg-white p-5">
          <h2 className="mb-3 text-[14.5px] font-semibold text-ink">
            Investments Held
          </h2>
          <div className="vq-card-grid flex flex-col gap-2">
            {vehicleInvestments.map((investment) => (
              <div key={investment.id} className="rounded-xl border border-neutral-100 px-3 py-2.5">
                <Link
                  href={`/companies/${investment.company?.id}`}
                  className="text-[12.5px] font-semibold text-ink hover:text-cyan-700"
                >
                  {investment.company?.name ?? "Unknown company"}
                </Link>
                <div className="mt-0.5 text-[11.5px] text-neutral-500">
                  {investment.external_ref} / {investment.round_label ?? "Round"} /{" "}
                  {labelForInstrument(investment.instrument)}
                </div>
                <div className="mt-2">
                  <ApplyPortfolioTemplateButton
                    label="Start company checklist"
                    templateCode={companyTemplateForInstrument(investment.instrument)}
                    scope="spv_company"
                    investmentId={investment.id}
                    revalidatePath={path}
                  />
                </div>
              </div>
            ))}
            {vehicleInvestments.length === 0 && (
              <p className="text-[12px] text-neutral-400">No linked investments.</p>
            )}
          </div>
        </div>
      </div>

      <div className="vq-card-static rounded-[14px] bg-white p-5">
        <h2 className="mb-3 text-[14.5px] font-semibold text-ink">
          Internal Cap Table
        </h2>
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="border-b border-neutral-100 text-left text-[10.5px] uppercase tracking-wide text-neutral-400">
              <th className="px-3 py-2 font-semibold">Investor</th>
              <th className="px-3 py-2 font-semibold">Investment</th>
              <th className="px-3 py-2 font-semibold">Amount</th>
              <th className="px-3 py-2 font-semibold">Units</th>
              <th className="px-3 py-2 font-semibold">% capital</th>
              <th className="px-3 py-2 font-semibold">Investor docs</th>
            </tr>
          </thead>
          <tbody>
            {(positions ?? []).map((position) => (
              <tr key={position.id} className="border-b border-neutral-50 last:border-0">
                <td className="px-3 py-2">
                  <Link
                    href={`/portfolio/investors/${position.investor?.id}`}
                    className="font-semibold text-ink hover:text-cyan-700"
                  >
                    {position.investor?.display_name ?? "Unknown"}
                  </Link>
                </td>
                <td className="px-3 py-2 text-neutral-600">
                  {position.investment?.company ? (
                    <Link
                      href={`/companies/${position.investment.company.id}`}
                      className="hover:text-cyan-700"
                    >
                      {position.investment.company.name}
                    </Link>
                  ) : (
                    "-"
                  )}{" "}
                  / {position.investment?.round_label ?? position.investment?.external_ref}
                </td>
                <td className="px-3 py-2 text-neutral-600">
                  {formatMoney(position.amount)}
                </td>
                <td className="px-3 py-2 text-neutral-600">
                  {position.units_or_shares ?? "-"}
                </td>
                <td className="px-3 py-2 text-neutral-600">
                  {totalCapital && position.amount
                    ? `${((position.amount / totalCapital) * 100).toFixed(1)}%`
                    : "-"}
                </td>
                <td className="px-3 py-2">
                  <ApplyPortfolioTemplateButton
                    label="Start investor checklist"
                    templateCode={investorTemplateForVehicle(vehicle.entity_type)}
                    scope="investor_spv"
                    positionId={position.id}
                    revalidatePath={path}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="vq-card-static rounded-[14px] bg-white p-5">
        <h2 className="mb-3 text-[14.5px] font-semibold text-ink">
          Capital Events
        </h2>
        <div className="mb-4 flex flex-col gap-2">
          {(capitalEvents ?? []).map((event) => (
            <div key={event.id} className="rounded-xl border border-neutral-100 px-3 py-2.5">
              <div className="text-[12.5px] font-semibold text-ink">
                {labelForEventType(event.event_type)}
                {event.event_date ? ` / ${new Date(event.event_date).toLocaleDateString()}` : ""}
              </div>
              <div className="mt-0.5 text-[11.5px] text-neutral-500">
                {event.description}
                {event.amount ? ` / ${formatMoney(event.amount)}` : ""}
              </div>
            </div>
          ))}
          {(capitalEvents ?? []).length === 0 && (
            <p className="text-[12px] text-neutral-400">No capital events yet.</p>
          )}
        </div>
        <form action={addCapitalEvent} className="grid grid-cols-[150px_150px_1fr_auto] gap-2">
          <input type="hidden" name="vehicleId" value={vehicle.id} />
          <input type="hidden" name="returnPath" value={path} />
          <FormSelectMenu
            name="eventType"
            defaultValue="formation"
            options={[
              "formation",
              "operating_agreement",
              "shareholders_agreement",
              "joinder",
              "subscription",
              "capital_increase",
              "share_issuance",
              "transfer",
              "conversion",
              "resolution",
              "wire_in",
              "wire_out",
              "other",
            ].map((eventType) => ({
              label: labelForEventType(eventType),
              value: eventType,
            }))}
            buttonClassName="px-2.5 py-2 text-[12px]"
          />
          <input
            type="date"
            name="eventDate"
            className="rounded-xl border border-neutral-100 px-2.5 py-2 text-[12px]"
          />
          <input
            name="description"
            placeholder="Description"
            className="rounded-xl border border-neutral-100 px-2.5 py-2 text-[12px]"
          />
          <button className="rounded-lg bg-ink px-3 py-2 text-[11px] font-semibold text-white">
            Add Event
          </button>
        </form>
      </div>

      <div id="checklist" className="flex flex-col gap-4 scroll-mt-6">
        <div className="vq-card-static flex flex-wrap items-center gap-2 rounded-[14px] bg-white px-3 py-2">
          <Link
            href={path}
            className="rounded-lg border border-neutral-200 px-3 py-1.5 text-[11.5px] font-semibold text-neutral-600 transition hover:border-neutral-300 hover:text-neutral-800"
          >
            All checklist items
          </Link>
          <Link
            href={`${path}?filter=open_gaps#checklist`}
            className="rounded-lg border border-neutral-200 px-3 py-1.5 text-[11.5px] font-semibold text-neutral-600 transition hover:border-cyan-300 hover:text-cyan-800"
          >
            Open gaps
          </Link>
          <Link
            href={`${path}?filter=critical_missing#checklist`}
            className="rounded-lg border border-neutral-200 px-3 py-1.5 text-[11.5px] font-semibold text-neutral-600 transition hover:border-cyan-300 hover:text-cyan-800"
          >
            Critical missing
          </Link>
          <Link
            href={`${path}?filter=needs_review#checklist`}
            className="rounded-lg border border-neutral-200 px-3 py-1.5 text-[11.5px] font-semibold text-neutral-600 transition hover:border-cyan-300 hover:text-cyan-800"
          >
            Needs review
          </Link>
        </div>
        <RequirementTable
          title="SPV Documents"
          rows={filteredSpvRequirements}
          path={path}
        />
        <RequirementTable
          title="Investor to SPV"
          rows={filteredInvestorRequirements}
          path={path}
        />
        <RequirementTable
          title="SPV to Company"
          rows={filteredCompanyRequirements}
          path={path}
        />
      </div>
    </div>
  );
}
