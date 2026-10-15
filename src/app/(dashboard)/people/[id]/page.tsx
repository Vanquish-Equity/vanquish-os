import Link from "next/link";
import { notFound } from "next/navigation";
import { requireMember } from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/server";
import { relationshipIntelligenceState } from "@/lib/relationships/intelligence-queries";
import RelationshipIntelligenceSection from "@/components/RelationshipIntelligenceSection";
export const dynamic = "force-dynamic";
export default async function PersonRelationshipPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireMember();
  const { id } = await params;
  const state = await relationshipIntelligenceState();
  if (!state.enabled || !/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { data: person } = await (
    await createClient()
  )
    .from("people")
    .select("id,name,title,primary_organization_id")
    .eq("id", id)
    .is("archived_at", null)
    .maybeSingle();
  if (!person) notFound();
  if (person.primary_organization_id) {
    const { data: parent } = await (
      await createClient()
    )
      .from("companies")
      .select("id")
      .eq("id", person.primary_organization_id)
      .is("deleted_at", null)
      .maybeSingle();
    if (!parent) notFound();
  }
  return (
    <main className="min-w-0 space-y-4 px-4 py-6 sm:px-7">
      <Link
        className="inline-flex min-h-11 items-center text-sm text-cyan-800"
        href="/network"
      >
        Back to Network
      </Link>
      <header>
        <h1 className="text-[23px] font-semibold">{person.name}</h1>
        <p className="text-sm text-neutral-500">{person.title}</p>
      </header>
      {person.primary_organization_id && (
        <Link
          className="inline-flex min-h-11 items-center text-sm text-cyan-800"
          href={`/companies/${person.primary_organization_id}`}
        >
          Open company
        </Link>
      )}
      <RelationshipIntelligenceSection
        people={[{ id: person.id, name: person.name }]}
        allowed={state.allowed}
      />
    </main>
  );
}
