import Link from "next/link";
import { notFound } from "next/navigation";
import ContactProfile from "@/components/people/ContactProfile";
import { requireMember } from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/server";

export default async function PersonProfilePage({ params }: {
  params: Promise<{ id: string }>;
}) {
  await requireMember();
  const { id } = await params;
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) notFound();
  const db = await createClient();
  const { data: companies } = await db.from("companies").select("id,name")
    .is("deleted_at", null).order("name").limit(1000);

  return <div className="mx-auto w-full max-w-6xl px-4 py-4 sm:px-6">
    <nav aria-label="Breadcrumb" className="mb-3 px-1 text-sm text-neutral-600">
      <Link href="/people" className="font-semibold text-cyan-800 hover:underline">People</Link>
      <span aria-current="page"> / Contact profile</span>
    </nav>
    <ContactProfile id={id} companies={companies ?? []} full />
  </div>;
}
