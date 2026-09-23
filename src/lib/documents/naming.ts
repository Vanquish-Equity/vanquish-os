export type CanonicalDocumentNameInput = {
  entityRole: string;
  entityName: string;
  category: string;
  documentType: string;
  extension: string;
  periodLabel?: string | null;
  documentDate?: string | null;
  docStatus?: string | null;
  versionNumber?: number | null;
  investorName?: string | null;
};

function toPascalToken(value: string | null | undefined) {
  const ascii = (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const words = ascii.match(/[A-Za-z0-9]+/g) ?? [];

  if (words.length === 0) return "Unknown";

  return words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");
}

function cleanCode(value: string | null | undefined, fallback: string) {
  const cleaned = (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "")
    .toUpperCase();

  return cleaned || fallback;
}

function cleanExtension(value: string) {
  const cleaned = value.trim().replace(/^\./, "").replace(/[^A-Za-z0-9]/g, "");
  return cleaned || "pdf";
}

function cleanPeriodOrDate(value: string) {
  const cleaned = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9-]+/g, "");

  return cleaned || "Undated";
}

export function formatCanonicalDocumentName(input: CanonicalDocumentNameInput) {
  const statusOrVersion = input.docStatus
    ? cleanCode(input.docStatus, "UNKNOWN")
    : input.versionNumber
      ? `v${input.versionNumber}`
      : "UNKNOWN";
  const periodOrDate = input.periodLabel || input.documentDate || "Undated";
  const parts = [
    cleanCode(input.entityRole, "DOC"),
    toPascalToken(input.entityName),
    cleanCode(input.category, "OTHER"),
    toPascalToken(input.documentType),
  ];

  if (input.investorName) {
    parts.push(toPascalToken(input.investorName));
  }

  parts.push(cleanPeriodOrDate(periodOrDate), statusOrVersion);

  return `${parts.join("_")}.${cleanExtension(input.extension)}`;
}
