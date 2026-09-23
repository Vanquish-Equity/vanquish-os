const requirementStatusLabels: Record<string, string> = {
  missing: "Missing",
  needs_review: "Needs review",
  not_applicable: "Not applicable",
  not_searched: "Pending",
  received_found: "Received",
  requested: "Requested",
  waived: "Waived",
};

const criticalityLabels: Record<string, string> = {
  administrative: "Administrative",
  critical: "Critical",
  if_applicable: "If applicable",
  important: "Important",
};

const entityRoleLabels: Record<string, string> = {
  COUNTERPARTY: "Counterparty",
  DEAL: "Deal",
  FUND: "Fund",
  LP: "LP",
  SPV: "SPV",
  TARGET: "Target company",
  VANQUISH: "Vanquish",
};

const documentStatusLabels: Record<string, string> = {
  DRAFT: "Draft",
  EXECUTED: "Executed",
  RECEIVED: "Received",
  SUPERSEDED: "Superseded",
  UNKNOWN: "Unknown",
};

const instrumentLabels: Record<string, string> = {
  common: "Common equity",
  convertible_note: "Convertible note",
  other: "Other",
  preferred_equity: "Preferred equity",
  safe: "SAFE",
  to_confirm: "To confirm",
};

const fundingStatusLabels: Record<string, string> = {
  authorized_only: "Authorized only",
  funded: "Funded",
  to_confirm: "To confirm",
};

const vehicleStatusLabels: Record<string, string> = {
  direct_no_spv: "Direct, no SPV",
  known: "Known",
  other: "Other",
  shared_vehicle: "Shared vehicle",
  to_confirm: "To confirm",
};

const scopeLabels: Record<string, string> = {
  deal_dd: "Deal diligence",
  investor_spv: "Investor to SPV",
  spv: "SPV",
  spv_company: "SPV to company",
};

const executedLabels: Record<string, string> = {
  no: "Not executed",
  unknown: "Execution unknown",
  yes: "Executed",
};

const eventTypeLabels: Record<string, string> = {
  capital_increase: "Capital increase",
  conversion: "Conversion",
  formation: "Formation",
  joinder: "Joinder",
  operating_agreement: "Operating agreement",
  other: "Other",
  resolution: "Resolution",
  share_issuance: "Share issuance",
  shareholders_agreement: "Shareholders agreement",
  subscription: "Subscription",
  transfer: "Transfer",
  wire_in: "Wire in",
  wire_out: "Wire out",
};

export function humanizeCode(value: string | null | undefined) {
  if (!value) return "-";

  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function labelForRequirementStatus(status: string | null | undefined) {
  return status ? requirementStatusLabels[status] ?? humanizeCode(status) : "-";
}

export function labelForCriticality(value: string | null | undefined) {
  return value ? criticalityLabels[value] ?? humanizeCode(value) : "-";
}

export function labelForEntityRole(value: string | null | undefined) {
  return value ? entityRoleLabels[value] ?? humanizeCode(value) : "-";
}

export function labelForDocumentStatus(value: string | null | undefined) {
  return value ? documentStatusLabels[value] ?? humanizeCode(value) : "-";
}

export function labelForInstrument(value: string | null | undefined) {
  return value ? instrumentLabels[value] ?? humanizeCode(value) : "-";
}

export function labelForFundingStatus(value: string | null | undefined) {
  return value ? fundingStatusLabels[value] ?? humanizeCode(value) : "-";
}

export function labelForVehicleStatus(value: string | null | undefined) {
  return value ? vehicleStatusLabels[value] ?? humanizeCode(value) : "-";
}

export function labelForScope(value: string | null | undefined) {
  return value ? scopeLabels[value] ?? humanizeCode(value) : "-";
}

export function labelForExecuted(value: string | null | undefined) {
  return value ? executedLabels[value] ?? humanizeCode(value) : "-";
}

export function labelForEventType(value: string | null | undefined) {
  return value ? eventTypeLabels[value] ?? humanizeCode(value) : "-";
}
