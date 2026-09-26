import Link from "next/link";
import { notFound } from "next/navigation";
import DraftComposer from "@/components/DraftComposer";
import { requireMember } from "@/lib/auth/access";
import { canEditDraft, memberLabel } from "@/lib/communications/drafts";
import { loadAssignableMembers, loadDraft, loadLpContacts } from "@/lib/communications/queries";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function DraftPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const [{ id }, { saved }] = await Promise.all([params, searchParams]);
  if (!UUID_PATTERN.test(id)) notFound();

  const access = await requireMember();
  const supabase = await createClient();
  const [draft, contacts, members] = await Promise.all([
    loadDraft(supabase, id),
    loadLpContacts(supabase),
    loadAssignableMembers(supabase),
  ]);
  if (!draft) notFound();

  const canEdit = canEditDraft(draft, access.email);
  const you = (email: string) => (email === access.email ? " (you)" : "");

  return (
    <div className="flex flex-col gap-4 px-7 pt-6">
      <header>
        <Link href="/communications" className="text-[12px] font-semibold text-neutral-500 hover:text-cyan-700">
          ← Communications
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="font-[family-name:var(--font-display)] text-[23px] font-semibold tracking-tight text-ink">
            {draft.subject.trim() || "Untitled draft"}
          </h1>
          <span className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-[11px] font-semibold text-neutral-600">
            {draft.archivedAt ? "Discarded draft" : "Draft · not sent"}
          </span>
        </div>
        <p className="mt-1 text-[13px] text-neutral-500">
          Created by <span className="font-semibold text-ink">{memberLabel(members, draft.createdBy)}{you(draft.createdBy)}</span>
          {" · "}For <span className="font-semibold text-ink">{memberLabel(members, draft.assignedTo)}{you(draft.assignedTo)}</span>
          {" "}(responsible / planned sender)
        </p>
      </header>
      {/* Remount after each save so the form shows exactly what was stored. */}
      <DraftComposer
        key={draft.updatedAt}
        draft={draft}
        contacts={contacts}
        members={members}
        canEdit={canEdit}
        currentUserEmail={access.email}
        justSaved={saved === "1" && canEdit}
      />
    </div>
  );
}
