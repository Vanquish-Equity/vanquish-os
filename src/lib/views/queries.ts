import { createClient } from "@/lib/supabase/server";

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

export type PeopleViewFilters = {
  view: "all" | "lps";
  groupId: string | null;
  q: string | null;
};

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
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    owner: row.owner,
    isShared: row.isShared,
    filters: {
      view: row.filters.view === "lps" ? "lps" : "all",
      groupId: (row.filters.groupId as string | null) ?? null,
      q: (row.filters.q as string | null) ?? null,
    },
  }));
}

export function viewHref(basePath: string, filters: PeopleViewFilters) {
  const params = new URLSearchParams();
  if (filters.view === "lps") params.set("view", "lps");
  if (filters.groupId) params.set("group", filters.groupId);
  if (filters.q) params.set("q", filters.q);
  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
}
