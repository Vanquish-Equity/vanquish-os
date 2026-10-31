import "server-only";
import { cache } from "react";
import { readCustomFieldsState } from "@/lib/custom-fields/state";
import { relationshipIntelligenceState } from "@/lib/relationships/intelligence-queries";

// The same gate /people/[id] applies: the page answers 404 unless
// relationship intelligence or custom fields is on. Computed once per render
// (React cache), so the shell, People and Network share one answer and only
// link to a profile that actually opens.
export const personProfileState = cache(async () => {
  const [intelligence, customFields] = await Promise.all([
    relationshipIntelligenceState().catch(() => ({ enabled: false, allowed: false })),
    readCustomFieldsState(),
  ]);
  return { intelligence, customFields, open: intelligence.enabled || customFields };
});
