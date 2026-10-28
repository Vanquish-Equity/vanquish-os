import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

// Deduplicate only within an RSC render, never across requests/members/sessions.
// This RPC and its policy helper perform no row locking. Writes revalidate in SQL.
export const readCustomFieldsState = cache(async () => {
  try {
    const { data, error } = await (
      await createClient()
    ).rpc("custom_fields_state");
    return !error && data === true;
  } catch {
    return false;
  }
});
