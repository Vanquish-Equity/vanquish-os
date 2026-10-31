import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
export const customizationState = cache(async () => {
  try {
    const { data, error } = await (
      await createClient()
    ).rpc("customization_state");
    if (error || !data)
      return { views: false, kanban: false, templates: false };
    return {
      views: data.views === true,
      kanban: data.kanban === true,
      templates: data.templates === true,
    };
  } catch {
    return { views: false, kanban: false, templates: false };
  }
});
