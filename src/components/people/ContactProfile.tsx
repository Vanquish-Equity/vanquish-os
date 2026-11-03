import Link from "next/link";
import ContactOrganization from "@/components/people/ContactOrganization";
import CustomFieldsRecord from "@/components/custom-fields/CustomFieldsRecord";
import RelationshipIntelligenceSection from "@/components/RelationshipIntelligenceSection";
import { personProfileState } from "@/lib/people/profile-access";
import { createClient } from "@/lib/supabase/server";

export default async function ContactProfile({ id, companies }: {
  id: string; companies: { id: string; name: string }[];
}) {
  const db = await createClient();
  const loadContact = (withOrganization: boolean) => db.from("people")
    .select(`id,name,title,linkedin_url,primary_organization_id,${withOrganization ? "organization_name," : ""}organization:companies(id,name),person_emails(email,is_primary)`)
    .eq("id", id).is("archived_at", null).maybeSingle();
  const first = await loadContact(true);
  const pendingMigration = first.error?.code === "42703";
  const person = (pendingMigration ? await loadContact(false) : first).data as unknown as {
    name: string; title: string | null; linkedin_url: string | null;
    primary_organization_id: string | null; organization_name?: string | null;
    organization: { id: string; name: string } | null;
    person_emails: { email: string; is_primary: boolean }[] | null;
  } | null;
  if (!person) return <p className="p-6 text-sm text-neutral-600">This contact is unavailable.</p>;

  const [state, activity, members] = await Promise.all([
    personProfileState(),
    db.from("relationship_interactions").select("member_email,kind,last_at")
      .eq("person_id", id).order("last_at", { ascending: false }).limit(12),
    db.rpc("deal_assignee_directory").limit(500),
  ]);
  const names = new Map(((members.data ?? []) as { email: string; display_name: string | null }[]).map((member) => [member.email, member.display_name]));
  const emails = [...(person.person_emails ?? [])].sort((a, b) => Number(b.is_primary) - Number(a.is_primary));
  const organization = person.organization;
  const linkedin = /^https?:\/\//i.test(person.linkedin_url ?? "") ? person.linkedin_url : null;
  return <div className="space-y-4 p-5">
    <header>
      <h1 className="text-2xl font-semibold">{person.name}</h1>
      {person.title && <p className="mt-1 text-sm text-neutral-600">{person.title}</p>}
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 break-all text-sm">
        {emails.map(({ email }) => <a key={email} href={`mailto:${email}`} className="text-cyan-800 underline">{email}</a>)}
        {linkedin && <a href={linkedin} target="_blank" rel="noreferrer" className="text-cyan-800 underline">LinkedIn</a>}
      </div>
    </header>
    <section className="vq-card-static space-y-3 rounded-[14px] p-4">
      <h2 className="text-sm font-semibold">Organization</h2>
      <p className="text-sm text-neutral-600">{organization
        ? <Link href={`/companies/${organization.id}`} className="text-cyan-800 underline">{organization.name}</Link>
        : person.organization_name || "No organization added"}</p>
      {pendingMigration ? <p className="text-xs text-neutral-600">Organization editing is pending a database update.</p> : <details>
        <summary className="cursor-pointer text-sm font-semibold text-cyan-800">Edit organization</summary>
        <div className="mt-3"><ContactOrganization key={id} personId={id} companyId={person.primary_organization_id ?? ""} organizationName={person.organization_name ?? ""} companies={companies} /></div>
      </details>}
    </section>
    <section className="vq-card-static rounded-[14px] p-4">
      <h2 className="text-sm font-semibold">Recent relationship activity</h2>
      {activity.error ? <p className="mt-2 text-sm text-neutral-600">Activity is unavailable.</p>
        : !activity.data?.length ? <p className="mt-2 text-sm text-neutral-600">No shared emails or meetings recorded.</p>
        : <ul className="mt-2 divide-y divide-neutral-100 text-sm">{activity.data.map((item, index) => (
          <li key={index} className="flex flex-wrap justify-between gap-2 py-2">
            <span>{item.kind === "meeting" ? "Meeting" : "Email"}{names.get(item.member_email) ? ` · ${names.get(item.member_email)}` : ""}</span>
            <time dateTime={item.last_at} className="text-neutral-600">{item.last_at.slice(0, 10)}</time>
          </li>
        ))}</ul>}
    </section>
    {state.intelligence.enabled && state.intelligence.allowed && <RelationshipIntelligenceSection people={[{ id, name: person.name }]} allowed />}
    {state.customFields && <details className="vq-card-static rounded-[14px] p-4">
      <summary className="cursor-pointer text-sm font-semibold">Additional fields</summary>
      <div className="mt-3"><CustomFieldsRecord object="people" recordId={id} /></div>
    </details>}
  </div>;
}
