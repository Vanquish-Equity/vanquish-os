import Link from "next/link";
import { notFound } from "next/navigation";
import { requireMember } from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/server";
import { loadLpData } from "@/lib/lp-management/queries";
import LpFundraising from "@/components/LpFundraising";
export const dynamic = "force-dynamic";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const access = await requireMember();
  if (!access.permissions.has("portfolio")) notFound();
  const { id } = await params;
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) notFound();
  const db = await createClient();
  const investor = await db
    .from("investors")
    .select("id,person_id")
    .eq("id", id)
    .is("archived_at", null)
    .maybeSingle();
  if (!investor.data) notFound();
  const data = await loadLpData(access.email, id);
  if (!data) return <div className="p-7">LP records are unavailable.</div>;
  const [activity, files] = await Promise.all([
    investor.data.person_id
      ? db
          .from("relationship_interactions")
          .select("kind,last_at,member_email")
          .eq("person_id", investor.data.person_id)
          .order("last_at", { ascending: false })
          .limit(100)
      : Promise.resolve({ data: [], error: null }),
    access.permissions.has("documents")
      ? db
          .from("documents")
          .select("id,name")
          .eq("investor_id", id)
          .is("archived_at", null)
          .order("created_at", { ascending: false })
          .limit(100)
      : Promise.resolve({ data: [], error: null }),
  ]);
  return (
    <>
      <LpFundraising data={data} investorId={id} />
      <section className="mx-auto max-w-6xl space-y-3 px-4 pb-7 sm:px-7">
        <h2 className="font-semibold">Shared opt-in relationship activity</h2>
        {activity.error ? (
          <p>Activity unavailable.</p>
        ) : (
          (activity.data ?? []).map((a, i) => (
            <p key={i} className="text-sm">
              {a.kind} · {a.last_at} · {a.member_email}
            </p>
          ))
        )}
        <Link
          href={`/portfolio/investors/${id}`}
          className="text-sm text-cyan-800 underline"
        >
          Investor positions and SPV requirements →
        </Link>
        <h2 className="font-semibold">Investor documents</h2>
        {!access.permissions.has("documents") ? (
          <p className="text-sm">Documents permission also required.</p>
        ) : files.error ? (
          <p>Files unavailable.</p>
        ) : (
          <ul className="space-y-2">
            {(files.data ?? []).map((f) => (
              <li key={f.id}>
                <Link
                  className="text-sm text-cyan-800 underline"
                  href="/documents"
                >
                  {f.name}
                </Link>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-neutral-500">
          Latest 100 shared interactions and investor-linked files. Private
          inboxes and other members’ board notes are excluded.
        </p>
      </section>
    </>
  );
}
