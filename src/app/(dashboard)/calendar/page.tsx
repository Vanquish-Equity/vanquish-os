import CalendarWorkspace from "@/components/calendar/CalendarWorkspace";
import { requireMember } from "@/lib/auth/access";
import { loadMailboxConnection } from "@/lib/connections/queries";
import { createClient } from "@/lib/supabase/server";
export const dynamic = "force-dynamic";
export default async function CalendarPage() {
  await requireMember();
  const mailbox = await loadMailboxConnection(await createClient());
  return (
    <div className="flex flex-col gap-4 px-4 py-6 md:px-7">
      <header>
        <h1 className="font-[family-name:var(--font-display)] text-[23px] font-semibold tracking-tight text-ink">
          Calendar
        </h1>
        <p className="mt-1 text-[13px] text-neutral-500">
          Your Google calendars and meetings, inside Vanquish OS.
        </p>
      </header>
      <CalendarWorkspace connected={mailbox.connected} />
    </div>
  );
}
