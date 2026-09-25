// Finds existing companies whose names look like what the user typed, so a
// new company is only created after the user has seen likely duplicates.

export type MatchableCompany = {
  id: string;
  name: string;
  aliases?: string[];
};

export type CompanyMatch<T extends MatchableCompany> = {
  company: T;
  exact: boolean;
  score: number;
};

// Legal-form words that often differ between spellings of the same company.
const LEGAL_SUFFIXES = new Set([
  "co",
  "company",
  "corp",
  "corporation",
  "inc",
  "incorporated",
  "llc",
  "ltd",
  "limited",
  "sa",
  "srl",
  "gmbh",
  "plc",
  "lp",
]);

export function normalizeCompanyName(value: string) {
  const tokens = value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLocaleLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    // Rejoin runs of single letters from dotted initials: "S.A." -> "sa".
    .reduce<string[]>((joined, token, index, all) => {
      const extendsInitials =
        token.length === 1 && index > 0 && all[index - 1].length === 1 && joined.length > 0;
      if (extendsInitials) joined[joined.length - 1] += token;
      else joined.push(token);
      return joined;
    }, []);
  const withoutSuffixes = tokens.filter((token) => !LEGAL_SUFFIXES.has(token));
  return (withoutSuffixes.length ? withoutSuffixes : tokens).join(" ");
}

function editDistance(a: string, b: string) {
  if (a === b) return 0;
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = previous[j];
      previous[j] = Math.min(
        previous[j] + 1,
        previous[j - 1] + 1,
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      diagonal = above;
    }
  }
  return previous[b.length];
}

// Words match when equal or when one is a near spelling of the other
// ("round" / "rounds", "capitol" / "capital").
function tokensMatch(a: string, b: string) {
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 4) return false;
  return editDistance(a, b) <= 1 || a.startsWith(b) || b.startsWith(a);
}

function scoreName(query: string, candidate: string) {
  if (!query || !candidate) return 0;
  if (query === candidate) return 100;

  const compactQuery = query.replace(/ /g, "");
  const compactCandidate = candidate.replace(/ /g, "");
  if (compactQuery === compactCandidate) return 95;
  if (candidate.startsWith(query) || query.startsWith(candidate)) return 80;
  if (candidate.includes(query) || query.includes(candidate)) return 65;

  const queryTokens = query.split(" ");
  const candidateTokens = candidate.split(" ");
  const shared = candidateTokens.filter((token) =>
    queryTokens.some((queryToken) => tokensMatch(queryToken, token))
  ).length;
  const tokenScore = shared
    ? Math.round((shared / Math.max(queryTokens.length, candidateTokens.length)) * 60)
    : 0;

  const distance = editDistance(compactQuery, compactCandidate);
  const longest = Math.max(compactQuery.length, compactCandidate.length);
  const typoScore =
    longest >= 4 && distance <= Math.max(1, Math.floor(longest / 5)) ? 70 - distance * 5 : 0;

  return Math.max(tokenScore, typoScore);
}

export function findCompanyMatches<T extends MatchableCompany>(
  companies: T[],
  query: string,
  limit = 6
): CompanyMatch<T>[] {
  const normalizedQuery = normalizeCompanyName(query);
  if (!normalizedQuery) return [];

  return companies
    .map((company) => {
      const names = [company.name, ...(company.aliases ?? [])].map(normalizeCompanyName);
      const score = Math.max(...names.map((name) => scoreName(normalizedQuery, name)));
      return {
        company,
        exact: names.includes(normalizedQuery),
        score,
      };
    })
    .filter((match) => match.score >= 35)
    .sort((a, b) => b.score - a.score || a.company.name.localeCompare(b.company.name))
    .slice(0, limit);
}
