"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import RelativeTime from "@/components/RelativeTime";
import SelectMenu from "@/components/SelectMenu";
import {
  filterCompanies,
  sortCompanies,
  type CompanyFilters,
  type CompanyListItem,
  type CompanySort,
  type CompanySortKey,
} from "@/lib/companies/listing";

type FilterOptions = {
  industries: string[];
  outcomes: string[];
  priorities: string[];
  stages: string[];
};

type SearchParamsLike = {
  get: (key: string) => string | null;
  toString: () => string;
};

function readList(searchParams: SearchParamsLike, key: string) {
  return (searchParams.get(key) ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function asSortKey(value: string | null): CompanySortKey | null {
  if (
    value === "company" ||
    value === "deals" ||
    value === "industry" ||
    value === "invested" ||
    value === "last_update" ||
    value === "priority" ||
    value === "stage"
  ) {
    return value;
  }

  return null;
}

function readSort(searchParams: SearchParamsLike): CompanySort {
  const key = asSortKey(searchParams.get("sort"));
  const direction = searchParams.get("dir");

  if (!key || (direction !== "asc" && direction !== "desc")) return null;
  return { direction, key };
}

function readView(searchParams: SearchParamsLike) {
  return searchParams.get("view") === "cards" ? "cards" : "table";
}

function FilterMenu({
  label,
  onToggle,
  options,
  selected,
}: {
  label: string;
  onToggle: (value: string) => void;
  options: string[];
  selected: string[];
}) {
  return (
    <details className="relative">
      <summary className="list-none rounded-full border border-neutral-200 px-3 py-1.5 text-[11.5px] font-semibold text-neutral-600 transition hover:border-cyan-300 hover:text-cyan-800">
        {label}
        {selected.length > 0 ? ` (${selected.length})` : ""}
      </summary>
      <div className="absolute left-0 top-9 z-20 max-h-72 w-56 overflow-auto rounded-xl border border-neutral-100 bg-white p-2 shadow-lg">
        {options.length === 0 ? (
          <div className="px-2 py-2 text-[12px] text-neutral-400">No options</div>
        ) : (
          options.map((option) => (
            <label
              key={option}
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[12px] text-neutral-600 hover:bg-[#f7f9fa]"
            >
              <input
                type="checkbox"
                checked={selected.includes(option)}
                onChange={() => onToggle(option)}
                className="h-3.5 w-3.5 accent-cyan"
              />
              <span className="truncate">{option}</span>
            </label>
          ))
        )}
      </div>
    </details>
  );
}

function InvestedBadge({ count }: { count: number }) {
  if (count === 0) {
    return <span className="text-neutral-400">-</span>;
  }

  return (
    <span className="rounded-full border border-cyan-200 bg-cyan-50 px-2 py-0.5 text-[10.5px] font-semibold text-cyan-800">
      Invested {count > 1 ? count : ""}
    </span>
  );
}

export default function CompaniesExplorer({
  companies,
  filterOptions,
}: {
  companies: CompanyListItem[];
  filterOptions: FilterOptions;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = searchParams.get("q") ?? "";
  const [draftQueryState, setDraftQueryState] = useState({
    sourceQuery: query,
    value: query,
  });
  const draftQuery =
    draftQueryState.sourceQuery === query ? draftQueryState.value : query;
  const view = readView(searchParams);
  const sort = readSort(searchParams);

  const filters: CompanyFilters = useMemo(
    () => ({
      hasInvestment:
        searchParams.get("hasInvestment") === "yes" ||
        searchParams.get("hasInvestment") === "no"
          ? (searchParams.get("hasInvestment") as "yes" | "no")
          : undefined,
      industries: readList(searchParams, "industry"),
      outcomes: readList(searchParams, "outcome"),
      priorities: readList(searchParams, "priority"),
      query,
      stages: readList(searchParams, "stage"),
    }),
    [query, searchParams]
  );

  const updateQuery = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      Object.entries(updates).forEach(([key, value]) => {
        if (value === null || value === "") {
          params.delete(key);
        } else {
          params.set(key, value);
        }
      });

      const next = params.toString();
      router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  useEffect(() => {
    const handle = window.setTimeout(() => {
      if (draftQuery !== query) updateQuery({ q: draftQuery });
    }, 250);

    return () => window.clearTimeout(handle);
  }, [draftQuery, query, updateQuery]);

  useEffect(() => {
    if (searchParams.get("view")) return;

    try {
      const saved = window.localStorage.getItem("vanquish.companies.view");
      if (saved === "table" || saved === "cards") {
        updateQuery({ view: saved });
      }
    } catch {
      // Preference storage is optional.
    }
  }, [searchParams, updateQuery]);

  const rows = useMemo(
    () => sortCompanies(filterCompanies(companies, filters), sort),
    [companies, filters, sort]
  );

  function setListParam(key: string, values: string[]) {
    updateQuery({ [key]: values.length ? values.join(",") : null });
  }

  function toggleListValue(key: string, value: string, current: string[]) {
    const next = current.includes(value)
      ? current.filter((item) => item !== value)
      : [...current, value];
    setListParam(key, next);
  }

  function changeView(nextView: "cards" | "table") {
    try {
      window.localStorage.setItem("vanquish.companies.view", nextView);
    } catch {
      // Preference storage is optional.
    }
    updateQuery({ view: nextView });
  }

  function toggleSort(key: CompanySortKey) {
    if (!sort || sort.key !== key) {
      updateQuery({ dir: "asc", sort: key });
      return;
    }

    if (sort.direction === "asc") {
      updateQuery({ dir: "desc", sort: key });
      return;
    }

    updateQuery({ dir: null, sort: null });
  }

  function sortIndicator(key: CompanySortKey) {
    if (sort?.key === key) return sort.direction === "asc" ? "^" : "v";
    if (!sort && key === "last_update") return "v";
    return "";
  }

  function clearFilters() {
    const params = new URLSearchParams();
    params.set("view", view);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  return (
    <div className="flex flex-col gap-3.5">
      <div className="rounded-[14px] border border-neutral-100 bg-white p-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={draftQuery}
            onChange={(event) =>
              setDraftQueryState({
                sourceQuery: query,
                value: event.target.value,
              })
            }
            placeholder="Search name, alias or industry"
            className="min-w-[260px] flex-1 rounded-xl border border-neutral-100 bg-white px-3 py-2 text-[12.5px] font-medium text-ink outline-none transition focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100"
          />
          <FilterMenu
            label="Industry"
            options={filterOptions.industries}
            selected={filters.industries ?? []}
            onToggle={(value) =>
              toggleListValue("industry", value, filters.industries ?? [])
            }
          />
          <FilterMenu
            label="Stage"
            options={filterOptions.stages}
            selected={filters.stages ?? []}
            onToggle={(value) => toggleListValue("stage", value, filters.stages ?? [])}
          />
          <FilterMenu
            label="Priority"
            options={filterOptions.priorities}
            selected={filters.priorities ?? []}
            onToggle={(value) =>
              toggleListValue("priority", value, filters.priorities ?? [])
            }
          />
          <FilterMenu
            label="Outcome"
            options={filterOptions.outcomes}
            selected={filters.outcomes ?? []}
            onToggle={(value) =>
              toggleListValue("outcome", value, filters.outcomes ?? [])
            }
          />
          <SelectMenu
            value={filters.hasInvestment ?? ""}
            onChange={(value) => updateQuery({ hasInvestment: value || null })}
            options={[
              { label: "Has investment", value: "" },
              { label: "Invested only", value: "yes" },
              { label: "No investment", value: "no" },
            ]}
            buttonClassName="rounded-full border-neutral-200 px-3 py-1.5 text-[11.5px] font-semibold text-neutral-600"
          />
          <button
            type="button"
            onClick={clearFilters}
            className="rounded-full border border-neutral-200 px-3 py-1.5 text-[11.5px] font-semibold text-neutral-500 transition hover:border-neutral-300 hover:text-neutral-700"
          >
            Clear filters
          </button>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="text-[12px] font-medium text-neutral-500">
            {rows.length} of {companies.length} companies
          </div>
          <div className="flex items-center gap-2">
            {view === "cards" && (
              <SelectMenu
                value={sort ? `${sort.key}:${sort.direction}` : "last_update:desc"}
                onChange={(value) => {
                  const [key, direction] = value.split(":");
                  updateQuery({
                    dir: direction === "asc" ? "asc" : "desc",
                    sort: asSortKey(key) ?? "last_update",
                  });
                }}
                options={[
                  {
                    label: "Last update, newest first",
                    value: "last_update:desc",
                  },
                  {
                    label: "Last update, oldest first",
                    value: "last_update:asc",
                  },
                  { label: "Company, A-Z", value: "company:asc" },
                  { label: "Company, Z-A", value: "company:desc" },
                  { label: "Deals, most first", value: "deals:desc" },
                  { label: "Invested first", value: "invested:desc" },
                ]}
                buttonClassName="rounded-lg border-neutral-200 px-3 py-1.5 text-[11.5px] font-semibold text-neutral-600"
                rootClassName="min-w-[190px]"
              />
            )}
            <div className="rounded-full border border-neutral-200 p-0.5">
              <button
                type="button"
                onClick={() => changeView("table")}
                className={`rounded-full px-3 py-1 text-[11.5px] font-semibold transition ${
                  view === "table"
                    ? "bg-ink text-white"
                    : "text-neutral-500 hover:text-ink"
                }`}
              >
                Table
              </button>
              <button
                type="button"
                onClick={() => changeView("cards")}
                className={`rounded-full px-3 py-1 text-[11.5px] font-semibold transition ${
                  view === "cards"
                    ? "bg-ink text-white"
                    : "text-neutral-500 hover:text-ink"
                }`}
              >
                Cards
              </button>
            </div>
          </div>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-[14px] border border-neutral-100 bg-white p-8 text-center">
          <h2 className="text-[15px] font-semibold text-ink">No matching companies</h2>
          <p className="mt-1 text-[12.5px] text-neutral-500">
            This list is for finding the company record that owns each deal,
            person, document and investment.
          </p>
          <div className="mt-4 flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={clearFilters}
              className="rounded-full bg-ink px-3.5 py-2 text-[11.5px] font-semibold text-white transition hover:bg-neutral-800"
            >
              Clear filters
            </button>
            <Link
              href="/companies/trash"
              className="text-[11.5px] font-semibold text-neutral-400 hover:text-cyan-700"
            >
              View trash
            </Link>
          </div>
        </div>
      ) : view === "table" ? (
        <div className="max-h-[calc(100vh-230px)] overflow-auto rounded-[14px] border border-neutral-100 bg-white">
          <table className="w-full text-[12.5px]">
            <thead className="sticky top-0 z-10 bg-white">
              <tr className="border-b border-neutral-100 text-left text-[10.5px] uppercase tracking-wide text-neutral-400">
                {[
                  ["company", "Company"],
                  ["industry", "Industry"],
                  ["stage", "Stage"],
                  ["priority", "Priority"],
                  ["deals", "Deals"],
                  ["last_update", "Last update"],
                  ["invested", "Invested"],
                ].map(([key, label]) => (
                  <th key={key} className="px-4 py-3 font-semibold">
                    <button
                      type="button"
                      onClick={() => toggleSort(key as CompanySortKey)}
                      className="flex items-center gap-1 hover:text-cyan-800"
                    >
                      {label}
                      <span>{sortIndicator(key as CompanySortKey)}</span>
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((company) => (
                <tr
                  key={company.id}
                  role="link"
                  tabIndex={0}
                  onClick={() => router.push(`/companies/${company.id}`)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") router.push(`/companies/${company.id}`);
                  }}
                  className="cursor-pointer border-b border-neutral-50 transition hover:bg-[#f7f9fa]"
                >
                  <td className="px-4 py-3.5 font-semibold text-ink">
                    {company.name}
                  </td>
                  <td className="px-4 py-3.5 text-neutral-600">
                    {company.industryName ?? "-"}
                  </td>
                  <td className="px-4 py-3.5 text-neutral-600">
                    {company.currentStageName ?? "-"}
                  </td>
                  <td className="px-4 py-3.5 text-neutral-600">
                    {company.currentPriorityName ?? "-"}
                  </td>
                  <td className="px-4 py-3.5 text-neutral-600">
                    {company.dealCount}
                  </td>
                  <td className="px-4 py-3.5 text-neutral-600">
                    <RelativeTime date={company.lastUpdateAt} />
                  </td>
                  <td className="px-4 py-3.5">
                    <InvestedBadge count={company.investmentCount} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((company) => (
            <Link
              key={company.id}
              href={`/companies/${company.id}`}
              className="rounded-[14px] border border-neutral-100 bg-white p-4 transition hover:border-cyan-200"
            >
              <div className="mb-2 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate text-[14px] font-semibold text-ink">
                    {company.name}
                  </h2>
                  <p className="mt-0.5 truncate text-[11.5px] text-neutral-500">
                    {company.industryName ?? "Industry to confirm"}
                  </p>
                </div>
                {company.currentStageName && (
                  <span className="flex-shrink-0 rounded-full bg-[#f0fafb] px-2 py-0.5 text-[10.5px] font-semibold text-cyan-800">
                    {company.currentStageName}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2 text-[11.5px] text-neutral-500">
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-neutral-400">
                    Priority
                  </div>
                  <div className="font-semibold text-ink">
                    {company.currentPriorityName ?? "-"}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-neutral-400">
                    Last update
                  </div>
                  <RelativeTime
                    date={company.lastUpdateAt}
                    className="font-semibold text-ink"
                  />
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-neutral-400">
                    Deals
                  </div>
                  <div className="font-semibold text-ink">{company.dealCount}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-neutral-400">
                    Open tasks
                  </div>
                  <div className="font-semibold text-ink">
                    {company.openTaskCount}
                  </div>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between gap-3">
                <InvestedBadge count={company.investmentCount} />
                {company.ddTotalCount > 0 && (
                  <div className="min-w-[112px]">
                    <div className="mb-1 text-right text-[10.5px] font-semibold text-neutral-500">
                      {company.ddReceivedCount}/{company.ddTotalCount} docs
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-neutral-100">
                      <div
                        className="h-full rounded-full bg-cyan"
                        style={{
                          width: `${Math.round(
                            (company.ddReceivedCount / company.ddTotalCount) * 100
                          )}%`,
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
