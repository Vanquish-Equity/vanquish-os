import Link from "next/link";
import DraftComposer from "@/components/DraftComposer";
import { requireMember } from "@/lib/auth/access";
import { loadAssignableMembers, loadContactGroups, loadLpContacts } from "@/lib/communications/queries";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function NewDraftPage() {
  const access = await requireMember();
  const supabase = await createClient();
  const [contacts, members, groups] = await Promise.all([loadLpContacts(supabase), loadAssignableMembers(supabase), loadContactGroups(supabase)]);

  return (
    <div className="flex flex-col gap-4 px-7 pt-6">
      <header>
        <Link href="/communications" className="text-[12px] font-semibold text-neutral-500 hover:text-cyan-700">
          ← Communications
        </Link>
        <h1 className="mt-1 font-[family-name:var(--font-display)] text-[23px] font-semibold tracking-tight text-ink">
          New email draft
        </h1>
        <p className="mt-1 text-[13px] text-neutral-500">
          Any kind of email to potential LPs. It stays a draft, and only you can edit or discard it — once Gmail is
          connected, it sends from your own mailbox.
        </p>
      </header>
      <DraftComposer draft={null} contacts={contacts} groups={groups} members={members} canEdit currentUserEmail={access.email} />
    </div>
  );
}
