import { createClient } from "@/lib/supabase/server";
import { loadSavedViewRows } from "./queries";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

export type PipelineViewFilters = {
  hideTerminal: boolean;
  priority: string | null;
  stage: string | null;
};

export type PipelineSavedView = {
  id: string;
  name: string;
  owner: string;
  isShared: boolean;
  filters: PipelineViewFilters;
};

export async function loadPipelineSavedViews(
  supabase: SupabaseClient,
): Promise<PipelineSavedView[]> {
  const rows = await loadSavedViewRows(supabase, "pipeline");
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    owner: row.owner,
    isShared: row.isShared,
    filters: {
      hideTerminal: row.filters.hideTerminal === true,
      priority: (row.filters.priority as string | null) ?? null,
      stage: (row.filters.stage as string | null) ?? null,
    },
  }));
}

export function pipelineViewHref(filters: PipelineViewFilters) {
  const params = new URLSearchParams();
  params.set("hideTerminal", filters.hideTerminal ? "1" : "0");
  if (filters.priority) params.set("priority", filters.priority);
  if (filters.stage) params.set("stage", filters.stage);
  return `/pipeline?${params.toString()}`;
}
