export const STAGE_REQUIREMENTS = [
  { key: "potential_investment", label: "Potential investment" },
  { key: "raise_amount", label: "Raise amount" },
  { key: "round", label: "Round" },
  { key: "source", label: "Source" },
  { key: "deal_team", label: "Deal team" },
  { key: "next_action", label: "Open task" },
  { key: "dd_checklist", label: "DD checklist complete" },
] as const;

export type StageRequirement = (typeof STAGE_REQUIREMENTS)[number]["key"];

export function isStageRequirement(value: string): value is StageRequirement {
  return STAGE_REQUIREMENTS.some((item) => item.key === value);
}
