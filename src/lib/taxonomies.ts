import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

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

// Taxonomies are read with the signed-in member's session so RLS applies
// (anonymous access was removed in migration 0015). React's cache() dedupes
// them within one request. TAXONOMY_TAGS stays for existing revalidateTag
// calls.
async function createCachedSupabaseClient() {
  return createClient();
}

export const getPipelineStages = cache(
  async () => {
    const supabase = await createCachedSupabaseClient();
    const { data, error } = await supabase
      .from("pipeline_stages")
      .select("id,name,sort_order")
      .eq("is_active", true)
      .order("sort_order");

    if (error) throw new Error(error.message);
    return (data ?? []) as PipelineStageOption[];
  }
);

export const getPriorityOptions = cache(
  async () => {
    const supabase = await createCachedSupabaseClient();
    const { data, error } = await supabase
      .from("priorities")
      .select("id,name")
      .order("sort_order");

    if (error) throw new Error(error.message);
    return (data ?? []) as PublicOption[];
  }
);

export const getIndustryOptions = cache(
  async () => {
    const supabase = await createCachedSupabaseClient();
    const { data, error } = await supabase
      .from("industries")
      .select("id,name")
      .order("name");

    if (error) throw new Error(error.message);
    return (data ?? []) as PublicOption[];
  }
);

export const getDealOutcomeOptions = cache(
  async () => {
    const supabase = await createCachedSupabaseClient();
    const { data, error } = await supabase
      .from("deal_outcomes")
      .select("id,name")
      .eq("is_active", true)
      .order("sort_order");

    if (error) throw new Error(error.message);
    return (data ?? []) as PublicOption[];
  }
);

// Returns an empty list instead of failing when migration 0014 has not been
// applied yet, so pages keep working with "No round" as the only choice.
export const getDealRoundOptions = cache(
  async () => {
    const supabase = await createCachedSupabaseClient();
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
  }
);

export const getRelationshipStateOptions = cache(
  async () => {
    const supabase = await createCachedSupabaseClient();
    const { data, error } = await supabase
      .from("relationship_states")
      .select("id,name")
      .eq("is_active", true)
      .order("sort_order");

    if (error) throw new Error(error.message);
    return (data ?? []) as PublicOption[];
  }
);

export const getDocumentCategories = cache(
  async () => {
    const supabase = await createCachedSupabaseClient();
    const { data, error } = await supabase
      .from("document_categories")
      .select("id,code,name")
      .order("sort_order");

    if (error) throw new Error(error.message);
    return (data ?? []) as DocumentCategoryOption[];
  }
);

export const getDocumentTypes = cache(
  async () => {
    const supabase = await createCachedSupabaseClient();
    const { data, error } = await supabase
      .from("document_types")
      .select("id,name,category_id")
      .eq("is_active", true)
      .order("name");

    if (error) throw new Error(error.message);
    return (data ?? []) as DocumentTypeOption[];
  }
);
