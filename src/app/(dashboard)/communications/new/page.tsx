import Link from "next/link";
import DraftComposer from "@/components/DraftComposer";
import { requireMember } from "@/lib/auth/access";
import { loadLpContacts } from "@/lib/communications/queries";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function NewDraftPage() {
  const access = await requireMember();
  const supabase = await createClient();
  const contacts = await loadLpContacts(supabase);

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
          Any kind of email to potential LPs. Everything stays a draft until sending from Outlook is connected.
        </p>
      </header>
      <DraftComposer draft={null} contacts={contacts} canEdit currentUserEmail={access.email} />
    </div>
  );
}
