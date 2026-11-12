"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Checkbox from "@/components/Checkbox";
import RelativeTime from "@/components/RelativeTime";
import { configureMailHeadersConsent } from "@/lib/mail-headers/actions";
import type { MailHeadersState, ReviewState } from "@/lib/mail-headers/model";

function featureStatus(state: MailHeadersState, review: ReviewState, permitted: boolean) {
  if (!permitted) return "Requires permission from an administrator.";
  if (!state.canRead) return "Requires Google connection with Gmail read access.";
  if (!state.enabled) return "Off.";
  if (!review.enabled) return "Off. Withdraw and authorize again to include this feature.";
  if (!review.workerAvailable) return "Pending activation by the administrator.";
  return "Active.";
}

function reviewError(code: string | null) {
  switch (code) {
    case "reconnect": return "Reconnect Google to restore mailbox reading.";
    case "rate_limited": return "Google limited requests. The review was deferred.";
    case "deadline": return "The review reached its time budget. No partial results were saved.";
    case "unavailable": return "The last review could not finish. It will be tried later.";
    default: return null;
  }
}

function Feature({ name, description, review, status, showError }: {
  name: string; description: string; review?: ReviewState; status: string; showError: boolean;
}) {
  const error = showError ? reviewError(review?.lastError ?? null) : null;
  return (
    <li className="min-w-0 rounded-xl border border-neutral-200 p-3">
      <h3 className="text-xs font-semibold text-ink">{name}</h3>
      <p className="mt-1 text-xs text-neutral-500">{description}</p>
      <p className="mt-2 text-xs font-medium text-ink">{status}</p>
      {review?.lastReviewAt && <p className="mt-1 text-xs text-neutral-500">Last reviewed <RelativeTime date={review.lastReviewAt} /></p>}
      {error && <p className="mt-1 text-xs text-neutral-600">{error}</p>}
    </li>
  );
}

export default function MailHeadersConsentSettings({ state, stateError }: {
  state: MailHeadersState | null;
  stateError?: "migration" | "unavailable";
}) {
  const router = useRouter();
  const help = useId();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState("");
  const status = (review: ReviewState | undefined, permitted = true) =>
    state && review ? featureStatus(state, review, permitted) : "Status unavailable.";
  return (
    <section className="vq-card-static rounded-[14px] bg-white p-5 sm:p-6" aria-labelledby="settings-mail-headers">
      <h2 id="settings-mail-headers" className="text-[15px] font-semibold text-ink">Mail header consent</h2>
      <p id={help} className="mt-1 max-w-[720px] text-xs text-neutral-500">
        Allow Vanquish to review sender and recipient details, dates and thread IDs from your connected Gmail.
        This consent does not cover message content, stored subjects, attachments or AI.
      </p>
      <label className="mt-2 flex min-h-11 items-center gap-2 text-xs text-ink">
        <Checkbox checked={state?.enabled === true} aria-describedby={help}
          disabled={pending || !state || (!state.canRead && !state.enabled)}
          onChange={(event) => {
            const enabled = event.target.checked;
            setMessage("");
            start(async () => {
              try {
                const result = await configureMailHeadersConsent(enabled);
                setMessage(result.message);
                if (result.ok) router.refresh();
              } catch {
                setMessage("Could not update mail header consent. Try again.");
              }
            });
          }} />
        Allow Vanquish to read my email headers
      </label>
      {!state && <p className="text-xs text-neutral-500">{stateError === "migration"
        ? "Mail header consent is unavailable until the database update is installed."
        : "Could not load mail header consent. Try refreshing."}</p>}
      {state?.lastError === "revoked" && <p className="text-xs text-neutral-600">Access changed. Reconnect Google and authorize again. Company detection also needs administrator permission.</p>}
      {state && !state.canRead && state.lastError !== "revoked" && (
        <a href="#settings-connections" className="text-xs font-semibold text-cyan-800 underline">Connect or reconnect Google to allow Gmail reading.</a>
      )}
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        <Feature name="Company detection" description={state?.company.capped
          ? "Last scan reached the newest 500-email limit; older emails in the window were not scanned."
          : "Finds companies to review from recent correspondence."}
          review={state?.company} status={status(state?.company, state?.company.permitted === true)}
          showError={state?.enabled === true && state.company.permitted} />
        <Feature name="Unanswered email reminders"
          description="Reviews recent threads from People for messages unanswered for five days. Reminders are private. Coverage is partial."
          review={state?.followup} status={status(state?.followup)} showError={state?.enabled === true} />
      </ul>
      <a href="#mail-headers-withdrawal" className="mt-3 inline-block text-xs font-semibold text-cyan-800 underline">How to withdraw access</a>
      <p id="mail-headers-withdrawal" tabIndex={-1} className="mt-1 text-xs text-neutral-500">
        Uncheck the box above to stop background header reviews. Existing suggestions, reminders and history are kept.
        Relationship sync has its own settings below.
      </p>
      <p role="status" className={message ? "mt-2 text-xs text-cyan-800" : "sr-only"}>{message}</p>
    </section>
  );
}
