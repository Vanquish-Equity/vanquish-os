export type RequirementProgressInput = {
  required: boolean;
  status: string;
};

const RECEIVED_STATUSES = new Set(["received_found", "waived", "not_applicable"]);

export function isRequirementSatisfied(requirement: RequirementProgressInput) {
  if (!requirement.required) return true;
  return RECEIVED_STATUSES.has(requirement.status);
}

export function calculateRequirementProgress(
  requirements: RequirementProgressInput[]
) {
  const required = requirements.filter((requirement) => requirement.required);
  const received = required.filter(isRequirementSatisfied);
  const missing = required.filter((requirement) => requirement.status === "missing");
  const needsReview = requirements.filter(
    (requirement) => requirement.status === "needs_review"
  );

  return {
    totalRequired: required.length,
    receivedRequired: received.length,
    missing: missing.length,
    needsReview: needsReview.length,
    percent:
      required.length === 0
        ? 100
        : Math.round((received.length / required.length) * 100),
  };
}
