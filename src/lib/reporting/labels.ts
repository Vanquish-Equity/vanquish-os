// Plain-language reasons for "fund metrics not available". The calculation
// returns short internal codes (or one fixed sentence); people read these.

const REASONS: Record<string, string> = {
  portfolio_required: "You need Portfolio access to see fund metrics.",
  gross_basis_contract_pending: "Gross figures are not available yet. Choose Net.",
  not_reconciled: "The fund's figures have not been reviewed and approved yet.",
  invalid_date_or_basis: "Check the date and the accounting basis, then try again.",
  invalid_currency: "The fund has no valid currency set.",
  dated_nav_required: "There is no fund value recorded for that exact date. Pick a date that has one.",
  invalid_nav: "The recorded fund value looks wrong. Ask an admin to check it.",
  flow_limit_or_empty: "There are no cash movements to calculate from, or too many to process.",
  flow_limit: "There are too many cash movements to calculate.",
  invalid_flow: "A recorded cash movement looks wrong. Ask an admin to check it.",
  multiple_sign_changes: "The cash movements give more than one possible return, so none is shown.",
  no_root: "A return cannot be calculated from these cash movements.",
  no_root_in_supported_range: "The return is outside the range that can be shown.",
  non_finite_root: "A return cannot be calculated from these cash movements.",
  "Portfolio access, activation and reconciled inputs required.":
    "Fund metrics are not available yet. They need Portfolio access and an admin to approve the fund's figures.",
  "Reconciled input attestation; verify accounting basis.":
    "Based on reviewed figures. Check the accounting basis before relying on it.",
};

export const METRICS_FALLBACK = "These metrics cannot be shown right now.";

export function metricsReasonLabel(reason: string | null | undefined): string {
  if (!reason) return METRICS_FALLBACK;
  return REASONS[reason] ?? METRICS_FALLBACK;
}
