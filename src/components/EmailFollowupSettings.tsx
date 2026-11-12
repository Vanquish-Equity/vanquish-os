"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Checkbox from "@/components/Checkbox";
import RelativeTime from "@/components/RelativeTime";
import { configureEmailFollowup } from "@/lib/email-followups/actions";
import { FOLLOWUP_ERRORS, type FollowupState } from "@/lib/email-followups/model";

export default function EmailFollowupSettings({ state, canRead, stateError }: { state: FollowupState | null; canRead: boolean; stateError?: "migration" | "unavailable" }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState("");
  return (
    <section className="vq-card-static rounded-[14px] bg-white p-5 sm:p-6" aria-labelledby="settings-email-followups">
      <h2 id="settings-email-followups" className="text-[15px] font-semibold text-ink">Unanswered email reminders</h2>
      <p id="settings-email-followups-help" className="mt-1 max-w-[720px] text-xs text-neutral-500">
        Review headers in your own Gmail inbox for messages from People that you haven&apos;t answered in five days.
        Reminders are private to you and appear in My reminders. Turning this off keeps existing reminders.
      </p>
      <p id="settings-email-followups-coverage" className="mt-1 text-xs text-neutral-500">
        Reviews recent threads from your contacts. Coverage is partial.
      </p>
      <label className="mt-2 flex min-h-11 items-center gap-2 text-xs text-ink">
        <Checkbox aria-describedby="settings-email-followups-help settings-email-followups-coverage" checked={state?.enabled === true} disabled={pending || !state || (!canRead && !state.enabled)}
          onChange={(event) => {
            const enabled = event.target.checked;
            setMessage("");
            start(async () => {
              try {
                const result = await configureEmailFollowup(enabled);
                setMessage(result.message);
                if (result.ok) router.refresh();
              } catch { setMessage("Could not change unanswered email reminders."); }
            });
          }} />
        Review my inbox for unanswered email
      </label>
      {!state && <p className="text-xs text-neutral-500">{stateError === "migration"
        ? "Reminders are unavailable until the database update is installed."
        : "Could not load reminder settings. Try refreshing."}</p>}
      {state && !canRead && <p className="text-xs text-neutral-500">Connect or reconnect Google above to allow mailbox reading.</p>}
      {state?.enabled && !state.workerAvailable && <p className="text-xs text-neutral-500">Pending activation by the administrator.</p>}
      {state?.lastReviewAt && <p className="text-xs text-neutral-500">Last reviewed <RelativeTime date={state.lastReviewAt} /></p>}
      {state?.lastError && <p className="text-xs text-neutral-500">{FOLLOWUP_ERRORS[state.lastError]}</p>}
      <p role="status" className={message ? "mt-2 text-xs text-cyan-800" : "sr-only"}>{message}</p>
    </section>
  );
}
