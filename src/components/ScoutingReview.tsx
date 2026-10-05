"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import RelativeTime from "@/components/RelativeTime";
import { acceptSuggestion, decideContactRequest, dismissSuggestion } from "@/lib/scouting/actions";

export type Suggestion = {
  id: string;
  domain: string;
  suggested_name: string;
  thread_count: number;
  two_way: boolean;
  last_seen_at: string;
  contacts: { email: string; name: string }[];
};
export type ContactRequest = { id: string; email: string; name: string; company: { id: string; name: string } | null };

function SuggestionCard({ suggestion, onDone }: { suggestion: Suggestion; onDone: (message: string) => void }) {
  const [name, setName] = useState(suggestion.suggested_name);
  const [pending, startTransition] = useTransition();
  const run = (action: () => Promise<{ ok: boolean; message?: string }>) =>
    startTransition(async () => {
      const result = await action();
      onDone(result.message ?? (result.ok ? "Done." : "Could not save the change."));
    });
  return (
    <div className="vq-card-static flex flex-col gap-3 rounded-[14px] bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[11px] text-neutral-400">{suggestion.domain}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11.5px] text-neutral-500">
            <span>
              {suggestion.thread_count} thread{suggestion.thread_count === 1 ? "" : "s"}
            </span>
            {suggestion.two_way && <span className="rounded-full bg-[#f0fafb] px-2 py-0.5 text-[10.5px] font-semibold text-cyan-800">You replied</span>}
            <span>
              Last email <RelativeTime date={suggestion.last_seen_at} />
            </span>
          </div>
        </div>
      </div>
      <label className="text-[11px] font-semibold text-ink">
        Company name
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={200}
          className="mt-1 block w-full rounded-lg border border-neutral-200 px-3 py-2 text-[13px] font-normal"
        />
      </label>
      {suggestion.contacts.length > 0 && (
        <div className="text-[11.5px] text-neutral-500">
          <span className="font-semibold text-neutral-600">Contacts: </span>
          {suggestion.contacts.map((contact) => contact.name || contact.email).join(", ")}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending || !name.trim()}
          onClick={() => run(() => acceptSuggestion(suggestion.id, name))}
          className="rounded-lg bg-ink px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-40"
        >
          Create company
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => dismissSuggestion(suggestion.id))}
          className="rounded-lg border border-neutral-200 px-3 py-1.5 text-[12px] font-semibold text-ink hover:border-cyan-300 disabled:opacity-40"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

export default function ScoutingReview({ suggestions, requests }: { suggestions: Suggestion[]; requests: ContactRequest[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const done = (text: string) => {
    setMessage(text);
    router.refresh();
  };
  const decide = (id: string, accept: boolean) =>
    startTransition(async () => {
      const result = await decideContactRequest(id, accept);
      done(result.ok ? (accept ? "Added to People." : "Declined.") : result.message ?? "Could not save the change.");
    });

  return (
    <>
      {requests.length > 0 && (
        <section className="vq-card-static rounded-[14px] bg-white p-5" aria-labelledby="contact-requests">
          <h2 id="contact-requests" className="text-[14.5px] font-semibold text-ink">Contact requests</h2>
          <p className="mt-1 text-[12px] text-neutral-500">
            People from companies you created from email scouting. Only you see these; accepting adds them to People.
          </p>
          <ul className="mt-3 divide-y divide-neutral-100 rounded-xl border border-neutral-100">
            {requests.map((request) => (
              <li key={request.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-[12px]">
                <div className="min-w-[180px] flex-1">
                  <div className="font-semibold text-ink">{request.name}</div>
                  <div className="truncate text-neutral-500">
                    {request.email}
                    {request.company ? ` · ${request.company.name}` : ""}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => decide(request.id, true)}
                  className="rounded-lg bg-ink px-2.5 py-1.5 text-[11px] font-semibold text-white disabled:opacity-40"
                >
                  Accept
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => decide(request.id, false)}
                  className="rounded-lg border border-neutral-200 px-2.5 py-1.5 text-[11px] font-semibold text-ink hover:border-cyan-300 disabled:opacity-40"
                >
                  Decline
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="suggested-companies">
        <h2 id="suggested-companies" className="text-[14.5px] font-semibold text-ink">Suggested companies</h2>
        <p className="mb-3 mt-1 text-[12px] text-neutral-500">
          From your own mailbox (last 30 days): companies you write with that aren&apos;t in Companies yet. Only you see
          these.
        </p>
        {suggestions.length === 0 ? (
          <div className="vq-card-static rounded-[14px] bg-white p-6 text-center text-[12.5px] text-neutral-400">
            No suggestions right now.
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {suggestions.map((suggestion) => (
              <SuggestionCard key={suggestion.id} suggestion={suggestion} onDone={done} />
            ))}
          </div>
        )}
      </section>
      {message && <p role="status" className="text-[11.5px] text-cyan-800">{message}</p>}
    </>
  );
}
