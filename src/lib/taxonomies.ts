import { unstable_cache } from "next/cache";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

export const TAXONOMY_TAGS = {
  dealOutcomes: "taxonomy:deal_outcomes",
  dealRounds: "taxonomy:deal_rounds",
  documentCategories: "taxonomy:document_categories",
  documentTypes: "taxonomy:document_types",
  industries: "taxonomy:industries",
  pipelineStages: "taxonomy:pipeline_stages",
  priorities: "taxonomy:priorities",
  relationshipStates: "taxonomy:relationship_states",
} as const;

type PublicOption = {
  id: string;
  name: string;
};

export type PipelineStageOption = PublicOption & {
  sort_order: number;
};

export type DocumentCategoryOption = PublicOption & {
  code: string;
};

export type DocumentTypeOption = PublicOption & {
  category_id: string;
};

function createCachedSupabaseClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        persistSession: false,
      },
    }
  );
}

export const getPipelineStages = unstable_cache(
  async () => {
    const supabase = createCachedSupabaseClient();
    const { data, error } = await supabase
      .from("pipeline_stages")
      .select("id,name,sort_order")
      .eq("is_active", true)
      .order("sort_order");

    if (error) throw new Error(error.message);
    return (data ?? []) as PipelineStageOption[];
  },
  ["taxonomy", "pipeline_stages"],
  { tags: [TAXONOMY_TAGS.pipelineStages], revalidate: 60 * 60 }
);

export const getPriorityOptions = unstable_cache(
  async () => {
    const supabase = createCachedSupabaseClient();
    const { data, error } = await supabase
      .from("priorities")
      .select("id,name")
      .order("sort_order");

    if (error) throw new Error(error.message);
    return (data ?? []) as PublicOption[];
  },
  ["taxonomy", "priorities"],
  { tags: [TAXONOMY_TAGS.priorities], revalidate: 60 * 60 }
);

export const getIndustryOptions = unstable_cache(
  async () => {
    const supabase = createCachedSupabaseClient();
    const { data, error } = await supabase
      .from("industries")
      .select("id,name")
      .order("name");

    if (error) throw new Error(error.message);
    return (data ?? []) as PublicOption[];
  },
  ["taxonomy", "industries"],
  { tags: [TAXONOMY_TAGS.industries], revalidate: 60 * 60 }
);

export const getDealOutcomeOptions = unstable_cache(
  async () => {
    const supabase = createCachedSupabaseClient();
    const { data, error } = await supabase
      .from("deal_outcomes")
      .select("id,name")
      .eq("is_active", true)
      .order("sort_order");

    if (error) throw new Error(error.message);
    return (data ?? []) as PublicOption[];
  },
  ["taxonomy", "deal_outcomes"],
  { tags: [TAXONOMY_TAGS.dealOutcomes], revalidate: 60 * 60 }
);

// Returns an empty list instead of failing when migration 0014 has not been
// applied yet, so pages keep working with "No round" as the only choice.
export const getDealRoundOptions = unstable_cache(
  async () => {
    const supabase = createCachedSupabaseClient();
    const { data, error } = await supabase
      .from("deal_rounds")
      .select("id,name")
      .eq("is_active", true)
      .order("sort_order");

    if (error) {
      console.warn(`deal_rounds unavailable: ${error.message}`);
      return [] as PublicOption[];
    }
    return (data ?? []) as PublicOption[];
  },
  ["taxonomy", "deal_rounds"],
  { tags: [TAXONOMY_TAGS.dealRounds], revalidate: 60 * 60 }
);

export const getRelationshipStateOptions = unstable_cache(
  async () => {
    const supabase = createCachedSupabaseClient();
    const { data, error } = await supabase
      .from("relationship_states")
      .select("id,name")
      .eq("is_active", true)
      .order("sort_order");

    if (error) throw new Error(error.message);
    return (data ?? []) as PublicOption[];
  },
  ["taxonomy", "relationship_states"],
  { tags: [TAXONOMY_TAGS.relationshipStates], revalidate: 60 * 60 }
);

export const getDocumentCategories = unstable_cache(
  async () => {
    const supabase = createCachedSupabaseClient();
    const { data, error } = await supabase
      .from("document_categories")
      .select("id,code,name")
      .order("sort_order");

    if (error) throw new Error(error.message);
    return (data ?? []) as DocumentCategoryOption[];
  },
  ["taxonomy", "document_categories"],
  { tags: [TAXONOMY_TAGS.documentCategories], revalidate: 60 * 60 }
);

export const getDocumentTypes = unstable_cache(
  async () => {
    const supabase = createCachedSupabaseClient();
    const { data, error } = await supabase
      .from("document_types")
      .select("id,name,category_id")
      .eq("is_active", true)
      .order("name");

    if (error) throw new Error(error.message);
    return (data ?? []) as DocumentTypeOption[];
  },
  ["taxonomy", "document_types"],
  { tags: [TAXONOMY_TAGS.documentTypes], revalidate: 60 * 60 }
);
