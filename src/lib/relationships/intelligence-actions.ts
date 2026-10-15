"use server";
import { getAccess } from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/server";
import { parseRelationshipGraph, type RelationshipGraph } from "./intelligence";
export async function loadRelationshipGraph(
  person: string,
  member: string,
): Promise<RelationshipGraph> {
  const denied: RelationshipGraph = { status: "unavailable", edges: [] };
  const access = await getAccess();
  if (
    access.status !== "member" ||
    !access.permissions.has("relationship_intelligence") ||
    !/^[0-9a-f-]{36}$/i.test(person) ||
    !/^[0-9a-f]{32}$/i.test(member)
  )
    return denied;
  try {
    const { data, error } = await (
      await createClient()
    )
      .rpc("relationship_intelligence_graph", {
        p_person: person,
        p_member: member,
      })
      .abortSignal(AbortSignal.timeout(3500));
    // An interrupt outside PL/pgSQL's handler still has an explicit partial state.
    if (error?.code === "57014")
      return {
        status: "partial",
        edges: [],
        asOf: new Date().toISOString().slice(0, 10),
        version: "v1",
        windowDays: 180,
        root: member,
        target: person,
        nodesVisited: 0,
        reasons: ["statement_timeout"],
      };
    return error ? denied : parseRelationshipGraph(data);
  } catch {
    return denied;
  }
}
