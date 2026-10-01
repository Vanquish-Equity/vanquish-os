import { createClient } from "@/lib/supabase/server";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

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

type SavedViewRow = {
  id: string;
  name: string;
  owner: string;
  is_shared: boolean;
  filters: Partial<PeopleViewFilters> | null;
};

export async function loadSavedViews(
  supabase: SupabaseClient,
  objectType: "people",
): Promise<SavedView[]> {
  const { data } = (await supabase
    .from("saved_views")
    .select("id,name,owner,is_shared,filters")
    .eq("object_type", objectType)
    .order("created_at")) as unknown as { data: SavedViewRow[] | null };
  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    owner: row.owner,
    isShared: row.is_shared,
    filters: {
      view: row.filters?.view === "lps" ? "lps" : "all",
      groupId: row.filters?.groupId ?? null,
      q: row.filters?.q ?? null,
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
