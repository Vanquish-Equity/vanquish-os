import { isRequirementSatisfied } from "../documents/requirements";

export type CompanyListItem = {
  aliases: string[];
  currentPriorityName: string | null;
  currentStageName: string | null;
  ddReceivedCount: number;
  ddTotalCount: number;
  dealCount: number;
  hasInvestment: boolean;
  id: string;
  industryName: string | null;
  investmentCount: number;
  lastUpdateAt: string | null;
  name: string;
  openTaskCount: number;
  outcomeNames: string[];
};

export type CompanyFilters = {
  hasInvestment?: "yes" | "no";
  industries?: string[];
  outcomes?: string[];
  priorities?: string[];
  query?: string;
  stages?: string[];
};

export type CompanySortKey =
  | "company"
  | "deals"
  | "industry"
  | "invested"
  | "last_update"
  | "priority"
  | "stage";

export type CompanySort = {
  direction: "asc" | "desc";
  key: CompanySortKey;
} | null;

function normalize(value: string | null | undefined) {
  return (value ?? "").trim().toLocaleLowerCase();
}

function includesSelected(value: string | null, selected: string[] | undefined) {
  if (!selected?.length) return true;
  return value ? selected.includes(value) : false;
}

export function filterCompanies(
  companies: CompanyListItem[],
  filters: CompanyFilters
) {
  const query = normalize(filters.query);

  return companies.filter((company) => {
    if (query) {
      const haystack = [
        company.name,
        company.industryName,
        company.currentStageName,
        ...company.aliases,
      ]
        .map(normalize)
        .join(" ");

      if (!haystack.includes(query)) return false;
    }

    if (!includesSelected(company.industryName, filters.industries)) return false;
    if (!includesSelected(company.currentStageName, filters.stages)) return false;
    if (!includesSelected(company.currentPriorityName, filters.priorities)) {
      return false;
    }

    if (filters.outcomes?.length) {
      const matchesOutcome = company.outcomeNames.some((outcome) =>
        filters.outcomes?.includes(outcome)
      );
      if (!matchesOutcome) return false;
    }

    if (filters.hasInvestment === "yes" && !company.hasInvestment) return false;
    if (filters.hasInvestment === "no" && company.hasInvestment) return false;

    return true;
  });
}

function compareText(a: string | null, b: string | null) {
  return (a ?? "").localeCompare(b ?? "");
}

function compareNumbers(a: number, b: number) {
  return a - b;
}

function compareDates(a: string | null, b: string | null) {
  const aTime = a ? new Date(a).getTime() : 0;
  const bTime = b ? new Date(b).getTime() : 0;
  return aTime - bTime;
}

export function sortCompanies(companies: CompanyListItem[], sort: CompanySort) {
  const activeSort = sort ?? { direction: "desc" as const, key: "last_update" as const };
  const direction = activeSort.direction === "asc" ? 1 : -1;

  return [...companies].sort((a, b) => {
    let result = 0;

    if (activeSort.key === "company") result = compareText(a.name, b.name);
    if (activeSort.key === "industry") {
      result = compareText(a.industryName, b.industryName);
    }
    if (activeSort.key === "stage") {
      result = compareText(a.currentStageName, b.currentStageName);
    }
    if (activeSort.key === "priority") {
      result = compareText(a.currentPriorityName, b.currentPriorityName);
    }
    if (activeSort.key === "deals") result = compareNumbers(a.dealCount, b.dealCount);
    if (activeSort.key === "invested") {
      result = compareNumbers(a.investmentCount, b.investmentCount);
    }
    if (activeSort.key === "last_update") {
      result = compareDates(a.lastUpdateAt, b.lastUpdateAt);
    }

    return result === 0 ? a.name.localeCompare(b.name) : result * direction;
  });
}

export function countReceivedRequirements(
  requirements: Array<{ required: boolean; status: string }>
) {
  const required = requirements.filter((requirement) => requirement.required);
  const received = required.filter(isRequirementSatisfied);

  return {
    received: received.length,
    total: required.length,
  };
}
