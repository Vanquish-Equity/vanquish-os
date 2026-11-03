import { createClient } from "@/lib/supabase/server";
import { parsePeopleColumns } from "./people-columns";
import type { PeopleViewFilters } from "./href";

// Pure helpers live in ./href (no server imports); re-exported for callers.
export { viewHref } from "./href";
export type { PeopleViewFilters } from "./href";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

export type ViewObjectType = "people" | "pipeline";

export type SavedViewRow = {
  id: string;
  name: string;
  owner: string;
  isShared: boolean;
  filters: Record<string, unknown>;
};

type RawSavedViewRow = {
  id: string;
  name: string;
  owner: string;
  is_shared: boolean;
  filters: Record<string, unknown> | null;
};

// Raw rows for any object_type; each page normalizes `filters` into its own
// typed shape, since a View's filter spec is specific to the list it saves.
export async function loadSavedViewRows(
  supabase: SupabaseClient,
  objectType: ViewObjectType,
): Promise<SavedViewRow[]> {
  const { data } = (await supabase
    .from("saved_views")
    .select("id,name,owner,is_shared,filters")
    .eq("object_type", objectType)
    .order("created_at")) as unknown as { data: RawSavedViewRow[] | null };
  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    owner: row.owner,
    isShared: row.is_shared,
    filters: row.filters ?? {},
  }));
}

export type SavedView = {
  id: string;
  name: string;
  owner: string;
  isShared: boolean;
  filters: PeopleViewFilters;
};

export async function loadSavedViews(
  supabase: SupabaseClient,
  objectType: "people",
): Promise<SavedView[]> {
  const rows = await loadSavedViewRows(supabase, objectType);
  return rows.filter((row) => row.filters.version === undefined).map((row) => ({
    id: row.id,
    name: row.name,
    owner: row.owner,
    isShared: row.isShared,
    filters: {
      view: row.filters.view === "lps" ? "lps" : "all",
      groupId: (row.filters.groupId as string | null) ?? null,
      q: (row.filters.q as string | null) ?? null,
      cols: parsePeopleColumns(row.filters.cols),
    },
  }));
}
