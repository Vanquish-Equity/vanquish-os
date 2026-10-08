import Link from "next/link";
import { requireMember } from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/server";
import { loadDirectory } from "@/lib/chat/queries";
import { warmPaths } from "@/lib/relationships/paths";
import { escapeLike } from "@/lib/search/text";

export const dynamic = "force-dynamic";
export default async function NetworkPage({searchParams}:{searchParams:Promise<{q?:string}>}) {
  await requireMember();
  const {q=""} = await searchParams;
  const db = await createClient();
  let query = db.from("people").select("id,name,title,primary_organization_id,organization:companies(name)").is("archived_at",null).order("name").limit(200);
  if (q.trim()) query=query.ilike("name",`%${escapeLike(q.trim().slice(0,80))}%`);
  const [people,directory] = await Promise.all([query,loadDirectory(db)]);
  const ids = (people.data ?? []).map(row => row.id);
  const interactions = ids.length ? await db.from("relationship_interactions").select("person_id,member_email,kind,last_at").in("person_id",ids).order("last_at",{ascending:false}).limit(10000) : {data:[],error:null};
  const paths=warmPaths(interactions.data ?? []);
  return <div className="px-4 py-6 sm:px-7"><header><h1 className="text-[23px] font-semibold text-ink">Network</h1><p className="mt-1 text-[13px] text-neutral-500">Find a teammate who has emailed or met a contact. Strength reflects activity days and recency.</p></header><form className="my-5 flex gap-2"><input name="q" aria-label="Find a contact" defaultValue={q} placeholder="Find a contact…" className="w-full max-w-md rounded-xl border border-neutral-200 px-3 py-2 text-[13px] focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-100"/><button className="rounded-full bg-ink px-4 py-2 text-[12px] font-semibold text-white">Search</button></form>
    <div className="vq-card-grid grid gap-4 md:grid-cols-2 xl:grid-cols-3">{(people.data ?? []).map(person => <article key={person.id} className="vq-card rounded-[14px] bg-white p-5"><Link href={`/people?q=${encodeURIComponent(person.name)}`} className="text-[15px] font-semibold text-ink">{person.name}</Link><p className="mt-1 text-[12px] text-neutral-500">{person.title}</p>{person.primary_organization_id && <Link href={`/companies/${person.primary_organization_id}`} className="text-[12px] text-cyan-800">Open company</Link>}<div className="mt-3 divide-y divide-neutral-100">{paths.filter(path => path.personId===person.id).map(path => <div key={path.member} className="py-2 text-[12px]"><span className="font-medium text-ink">{directory.get(path.member)?.name ?? path.member}</span><p className="text-neutral-500">{path.strength} · {path.days} days · {new Date(path.lastAt).toLocaleDateString()}</p></div>)}{!paths.some(path => path.personId===person.id) && <p className="text-[12px] text-neutral-400">No shared activity. Ask the team before assuming an introduction.</p>}</div></article>)}</div>
    {(people.error || interactions.error) && <p role="status" className="mt-4 text-[12px] text-neutral-500">Relationship history is currently unavailable.</p>}
    <p className="mt-5 text-[11px] text-neutral-400">Showing up to 200 contacts and 10,000 recent activity records. Only activity shared through Settings is included.</p>
  </div>;
}
