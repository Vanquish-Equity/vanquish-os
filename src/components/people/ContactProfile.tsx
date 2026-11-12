import { getAccess } from "@/lib/auth/access";
import { can } from "@/lib/auth/permissions";
import ContactWorkspace from "@/components/people/ContactWorkspace";
import Link from "next/link";
import { composeHref } from "@/lib/communications/compose-link";
import ContactActivity from "@/components/people/ContactActivity";
import ContactFounderFields from "@/components/people/ContactFounderFields";
import { EMPTY_FOUNDER_PROFILE } from "@/lib/people/founder-profile";
import ContactOrganization from "@/components/people/ContactOrganization";
import RelationshipIntelligenceSection from "@/components/RelationshipIntelligenceSection";
import { relationshipIntelligenceState } from "@/lib/relationships/intelligence-queries";
import { createClient } from "@/lib/supabase/server";
import { isOverdue, reminderForLabel, visibilityLabel, type Visibility } from "@/lib/people/contact-privacy";

export default async function ContactProfile({ id, companies, full = false }: {
  id: string; full?: boolean; companies: { id: string; name: string }[];
}) {
  const [db, access] = await Promise.all([createClient(), getAccess()]);
  if (access.status !== "member") return null;
  const canReadFiles = can(access, "documents");
  const loadContact = (withOrganization: boolean) => db.from("people")
    .select(`id,name,title,linkedin_url,primary_organization_id,${withOrganization ? "organization_name," : ""}is_potential_lp,created_at,organization:companies(id,name),person_emails(email,is_primary)`)
    .eq("id", id).is("archived_at", null).maybeSingle();
  const first = await loadContact(true);
  const pendingMigration = first.error?.code === "42703";
  const person = (pendingMigration ? await loadContact(false) : first).data as unknown as {
    name: string; title: string | null; linkedin_url: string | null; is_potential_lp: boolean; created_at: string;
    primary_organization_id: string | null; organization_name?: string | null;
    organization: { id: string; name: string } | null;
    person_emails: { email: string; is_primary: boolean }[] | null;
  } | null;
  if (!person) return <p className="p-6 text-sm text-neutral-600">This contact is unavailable.</p>;

  const today = new Date().toISOString().slice(0, 10);
  const since = new Date(Date.parse(today) - 89 * 86_400_000).toISOString().slice(0, 10);
  const [intelligence, activity, members, groupResult, dealResult, noteAttempt, reminderResult, fileResult, founderResult] = await Promise.all([
    relationshipIntelligenceState().catch(() => ({ enabled: false, allowed: false })),
    db.from("relationship_interactions").select("member_email,kind,occurred_on,last_at")
      .eq("person_id", id).gte("occurred_on", since).lte("occurred_on", today)
      .order("last_at", { ascending: false }).order("member_email").order("kind").limit(121),
    db.rpc("deal_assignee_directory").limit(500),
    db.from("person_group_members").select("group:person_groups(id,name)").eq("person_id", id).limit(30),
    db.from("deal_people").select("role,deal:deals!inner(id,name,company_id,stage:pipeline_stages(name),company:companies!inner(name))")
      .eq("person_id", id).is("deal.archived_at", null).is("deal.company.deleted_at", null).order("deal_id").limit(20),
    db.from("contact_notes").select("id,author_email,body,created_at,visibility,recipients:contact_note_recipients(member_email)").eq("person_id", id)
      .order("created_at", { ascending: false }).order("id").limit(30),
    db.from("contact_reminders").select("id,title,due_on,visibility,created_by,completed_at,completed_by,recipients:contact_reminder_recipients(member_email)")
      .eq("person_id", id).order("completed_at", { ascending: true, nullsFirst: true }).order("due_on").order("id").limit(60),
    canReadFiles ? db.storage.from("contact-files").list(id, { limit: 50, sortBy: { column: "created_at", order: "desc" } }) : undefined,
    db.from("people").select("city,country,origin").eq("id", id).is("archived_at", null).maybeSingle(),
  ]);
  const founder = founderResult.error || !founderResult.data ? null : founderResult.data;
  // Before the privacy migration is applied, notes load without visibility.
  type NoteRow = { id: string; author_email: string; body: string; created_at: string; visibility?: Visibility;
    recipients?: { member_email: string }[] | null };
  const noteResult = (noteAttempt.error && ["42703", "PGRST200", "PGRST204"].includes(noteAttempt.error.code ?? "")
    ? await db.from("contact_notes").select("id,author_email,body,created_at").eq("person_id", id)
        .order("created_at", { ascending: false }).order("id").limit(30)
    : noteAttempt) as unknown as { data: NoteRow[] | null; error: { code?: string } | null };
  const names = new Map(((members.data ?? []) as { email: string; display_name: string | null }[]).map((member) => [member.email, member.display_name]));
  const displayName = (email: string) => email === access.email ? "You" : names.get(email) || email;
  const memberOptions = ((members.data ?? []) as { email: string; display_name: string | null }[])
    .filter((member) => member.email !== access.email).map((member) => ({ email: member.email, name: member.display_name?.trim() || member.email }));
  type ReminderRow = { id: string; title: string; due_on: string; visibility: Visibility; created_by: string;
    completed_at: string | null; completed_by: string | null; recipients: { member_email: string }[] | null };
  const emails = [...(person.person_emails ?? [])].sort((a, b) => Number(b.is_primary) - Number(a.is_primary));
  const organization = person.organization;
  const linkedin = /^https?:\/\//i.test(person.linkedin_url ?? "") ? person.linkedin_url : null;
  const rows = (activity.data ?? []).slice(0, 120);
  const connections = new Map<string, { days: Set<string>; lastDay: string }>();
  for (const item of rows) {
    const existing = connections.get(item.member_email);
    if (existing) existing.days.add(item.occurred_on);
    else connections.set(item.member_email, { days: new Set([item.occurred_on]), lastDay: item.occurred_on });
  }
  const connectionRows = [...connections].sort((a, b) => b[1].days.size - a[1].days.size || b[1].lastDay.localeCompare(a[1].lastDay));
  const groups = ((groupResult.data ?? []) as unknown as { group: { id: string; name: string } | null }[]).flatMap(({ group }) => group ? [group] : []);
  const deals = (dealResult.data ?? []) as unknown as { role: string | null; deal: {
    id: string; name: string; company_id: string; stage: { name: string } | null; company: { name: string };
  } }[];
  const initials = person.name.trim().split(/\s+/).slice(0, 2).map((part) => Array.from(part)[0]).join("").toUpperCase();
  const pill = "inline-flex min-h-9 items-center rounded-full border border-neutral-200 bg-white px-3 text-xs font-semibold text-cyan-800 hover:border-cyan-400";
  const stats = [
    { label: "Last shared contact · 90d", value: rows[0]?.occurred_on ?? "—" },
    { label: "Active days · 90d", value: activity.error ? "—" : new Set(rows.map((item) => item.occurred_on)).size },
    { label: "Teammates · 90d", value: activity.error ? "—" : connections.size },
  ];

  return <div className="space-y-4 bg-neutral-50/70 p-4 sm:p-5">
    <header className="vq-card-static rounded-[14px] bg-white p-4">
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="grid size-12 shrink-0 place-items-center rounded-2xl bg-cyan-100 text-lg font-semibold text-cyan-900">{initials}</span>
        <div className="min-w-0">
          <h1 className="break-words text-2xl font-semibold tracking-tight">{person.name}</h1>
          {person.title && <p className="mt-0.5 text-sm text-neutral-600">{person.title}</p>}
          {(organization || person.organization_name) && <p className="mt-1 text-sm">{organization
            ? <Link href={`/companies/${organization.id}`} className="font-medium text-cyan-800 hover:underline">{organization.name}</Link>
            : person.organization_name}</p>}
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {emails[0] && <a className={pill} href={composeHref(emails[0].email)}>Email contact</a>}
        {linkedin && <a className={pill} href={linkedin} target="_blank" rel="noreferrer">LinkedIn</a>}
        {person.is_potential_lp && <span className="self-center rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-950">Potential LP</span>}
      </div>
    </header>

    <dl className="grid grid-cols-3 gap-2">
      {stats.map(({ label, value }) => <div key={label} className="rounded-xl border border-neutral-200 bg-white px-2.5 py-2.5 sm:px-3">
        <dt className="text-[11px] text-neutral-600">{label}</dt>
        <dd className="mt-1 break-words text-sm font-semibold tabular-nums">{value}</dd>
      </div>)}
    </dl>
    {(activity.data?.length ?? 0) > 120 && <p className="text-xs text-neutral-500">Relationship totals reflect the 120 latest entries shown in this profile.</p>}

    <div className={full ? "grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]" : "space-y-4"}>
    <div className="min-w-0 space-y-4">
    <section className="vq-card-static space-y-3 rounded-[14px] bg-white p-4">
      <h2 className="text-sm font-semibold">Contact details</h2>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div className="min-w-0"><dt className="text-xs text-neutral-500">Email addresses</dt>
          <dd className="mt-1">{emails.length ? emails.map(({ email, is_primary }) => <div key={email} className="break-all">
            <a href={composeHref(email)} className="text-cyan-800 underline">{email}</a>{is_primary && <span className="ml-1.5 text-[10px] text-neutral-500">Primary</span>}
          </div>) : "No email added"}</dd></div>
        <div><dt className="text-xs text-neutral-500">Added to CRM</dt><dd className="mt-1">
          <time dateTime={person.created_at}>{person.created_at.slice(0, 10)}</time>
        </dd></div>
      </dl>
      {groups.length > 0 && <div className="flex flex-wrap items-center gap-2"><span className="text-xs text-neutral-500">Lists</span>
        {groups.map((group) => <Link key={group.id} href={`/people?group=${group.id}`} className="rounded-full bg-cyan-50 px-2.5 py-1 text-xs font-medium text-cyan-900 hover:underline">{group.name}</Link>)}
      </div>}
      {pendingMigration ? <p className="text-xs text-neutral-600">Organization editing is pending a database update.</p> : <details>
        <summary className="cursor-pointer text-sm font-semibold text-cyan-800">Edit organization</summary>
        <div className="mt-3"><ContactOrganization key={id} personId={id} companyId={person.primary_organization_id ?? ""} organizationName={person.organization_name ?? ""} companies={companies} /></div>
      </details>}
    </section>

    <ContactFounderFields key={JSON.stringify([id, founder])} personId={id}
      fields={founder ?? EMPTY_FOUNDER_PROFILE} available={Boolean(founder)} />

    <ContactWorkspace key={id} personId={id}
      members={memberOptions}
      notes={noteResult.error ? null : (noteResult.data ?? []).map((note) => {
        const included = (note.recipients ?? []).map((row) => row.member_email);
        const visibility = note.visibility ?? "team";
        return {
          id: note.id, body: note.body, author: names.get(note.author_email) ?? (note.author_email === access.email ? "You" : "Team member"),
          day: note.created_at.slice(0, 10), mine: note.author_email === access.email,
          label: visibilityLabel(visibility, included, displayName),
          tagged: visibility === "team" && included.length ? `Tagged: ${included.map(displayName).join(", ")}` : null,
        };
      })}
      reminders={reminderResult.error ? null : ((reminderResult.data ?? []) as unknown as ReminderRow[]).map((row) => {
        const included = (row.recipients ?? []).map((item) => item.member_email);
        const mine = row.created_by === access.email;
        const done = row.completed_at !== null;
        return {
          id: row.id, title: row.title, dueOn: row.due_on, visibility: row.visibility, mine, included,
          label: visibilityLabel(row.visibility, included, displayName),
          forLabel: reminderForLabel(included.map(displayName), displayName(row.created_by)),
          done, overdue: isOverdue(row.due_on, today, done),
          canComplete: !done && (mine || included.includes(access.email)),
          doneBy: done ? `Done by ${row.completed_by ? displayName(row.completed_by) : "a former member"}, ${row.completed_at!.slice(0, 10)}` : null,
        };
      }).sort((a, b) => Number(a.done) - Number(b.done) || a.dueOn.localeCompare(b.dueOn))}
      files={fileResult ? fileResult.error ? null : (fileResult.data ?? []).filter((file) => file.id).map(({ name }) => ({ name })) : undefined} />

    <section className="vq-card-static rounded-[14px] bg-white p-4">
      <h2 className="text-sm font-semibold">Team connections</h2>
      <p className="mt-1 text-xs text-neutral-500">Teammates with shared activity in the last 90 days, ranked by distinct activity days.</p>
      {activity.error ? <p className="mt-2 text-sm text-neutral-600">Connections are unavailable right now.</p>
        : !connectionRows.length ? <p className="mt-2 text-sm text-neutral-600">No shared connections in this period.</p>
        : <ul className="mt-2 divide-y divide-neutral-100 text-sm">{connectionRows.map(([email, value], index) => (
          <li key={index} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span className="font-medium">{names.get(email) || "Team member"}</span>
            <span className="text-xs text-neutral-600">{value.days.size} {value.days.size === 1 ? "day" : "days"} · Last {value.lastDay}</span>
          </li>
        ))}</ul>}
    </section>
    </div>
    <div className="min-w-0 space-y-4">
    {intelligence.enabled && intelligence.allowed && <RelationshipIntelligenceSection people={[{ id, name: person.name }]} allowed />}
    <ContactActivity today={today} failed={!!activity.error} limited={(activity.data?.length ?? 0) > 120}
      items={[
        ...rows.map((item, index) => ({ key: `shared-${index}`, member: names.get(item.member_email) ?? null, kind: item.kind, day: item.occurred_on })),
        ...(noteResult.data ?? []).map((note) => ({ key: `note-${note.id}`, member: names.get(note.author_email) ?? "Team member",
          kind: "note", day: note.created_at.slice(0, 10), detail: note.body })),
      ].sort((a, b) => b.day.localeCompare(a.day) || a.key.localeCompare(b.key))} />

    {deals.length > 0 && <section className="vq-card-static rounded-[14px] bg-white p-4">
      <h2 className="text-sm font-semibold">Linked deals</h2>
      <ul className="mt-2 divide-y divide-neutral-100 text-sm">{deals.map(({ role, deal }) => <li key={deal.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
        <div><Link href={`/companies/${deal.company_id}/deals/${deal.id}`} className="font-medium text-cyan-800 hover:underline">{deal.name}</Link>
          <p className="text-xs text-neutral-600">{deal.company.name}{role ? ` · ${role}` : ""}</p></div>
        {deal.stage && <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs">{deal.stage.name}</span>}
      </li>)}</ul>
    </section>}
    </div>
    </div>
  </div>;
}
