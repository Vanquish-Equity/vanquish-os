"use server";

import { createClient } from "@/lib/supabase/server";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

export type ActivityInput = {
  eventType: string;
  targetType: string;
  targetId: string;
  payload?: Record<string, unknown>;
  actor?: string | null;
};

export async function logActivity(
  input: ActivityInput,
  supabase?: SupabaseClient
) {
  const client = supabase ?? (await createClient());

  await client.from("activity_events").insert({
    event_type: input.eventType,
    target_type: input.targetType,
    target_id: input.targetId,
    payload: input.payload ?? {},
    actor: input.actor ?? "anonymous",
  });
}
