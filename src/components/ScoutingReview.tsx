"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import Checkbox from "@/components/Checkbox";
import RelativeTime from "@/components/RelativeTime";
import { decideCompanySuggestions, decideContactRequest } from "@/lib/scouting/actions";

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

function SuggestionCard({ suggestion, name, selected, pending, error, onSelect, onName, onDismiss }: {
  suggestion: Suggestion;
  name: string;
  selected: boolean;
  pending: boolean;
  error?: string;
  onSelect: (selected: boolean) => void;
  onName: (name: string) => void;
  onDismiss: () => void;
}) {
  return (
    <li id={`suggestion-${suggestion.id}`} className="vq-card-static flex flex-col gap-3 rounded-[14px] bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <label className="inline-flex min-h-9 cursor-pointer items-center gap-2 text-[12px] font-semibold text-ink">
          <Checkbox checked={selected} disabled={pending} onChange={(event) => onSelect(event.target.checked)}
            aria-label={`Select ${suggestion.suggested_name} (${suggestion.domain})`} />
          Select
        </label>
        <div className="min-w-0 flex-1">
          <div className="break-all text-[11px] text-neutral-500">{suggestion.domain}</div>
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
          onChange={(event) => onName(event.target.value)}
          disabled={pending}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `suggestion-error-${suggestion.id}` : undefined}
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
      {error && <p id={`suggestion-error-${suggestion.id}`} className="text-[12px] text-red-700">{error}</p>}
      <button
        type="button"
        disabled={pending}
        onClick={onDismiss}
        className="min-h-9 self-start rounded-lg border border-neutral-200 px-3 text-[12px] font-semibold text-ink hover:border-cyan-300 disabled:opacity-40"
      >
        Dismiss
      </button>
    </li>
  );
}

type BatchReceipt = { id: string; label: string; ok: boolean; message: string };

function CompanySuggestions({ suggestions, refresh }: { suggestions: Suggestion[]; refresh: () => void }) {
  const [selection, setSelection] = useState<Set<string>>(() => new Set());
  const [names, setNames] = useState<Record<string, string>>({});
  const [outcomes, setOutcomes] = useState<BatchReceipt[]>([]);
  const [batchError, setBatchError] = useState<string>();
  const [pending, startTransition] = useTransition();
  // Hide successful rows immediately while server revalidation catches up.
  const [processed, setProcessed] = useState<Set<string>>(() => new Set());
  const remaining = suggestions.filter(({ id }) => !processed.has(id));
  const selected = remaining.filter(({ id }) => selection.has(id));
  const allSelected = remaining.length > 0 && selected.length === remaining.length;
  const rowErrors = new Map(outcomes.filter(({ ok }) => !ok).map(({ id, message }) => [id, message]));

  function run(decision: "create" | "dismiss", items: Suggestion[]) {
    if (pending || !items.length) return;
    const submitted = items.map(({ id, domain, suggested_name }) => ({
      id, name: names[id] ?? suggested_name, domain,
    }));
    startTransition(async () => {
      setBatchError(undefined);
      setOutcomes([]);
      let result: Awaited<ReturnType<typeof decideCompanySuggestions>>;
      try {
        result = await decideCompanySuggestions(decision, submitted.map(({ id, name }) => ({ id, name })));
      } catch {
        setBatchError("Couldn't confirm the results. Refresh To review before trying again.");
        return;
      }
      if (!result.ok) {
        setBatchError(result.message);
        return;
      }
      const byId = new Map(submitted.map((row) => [row.id, row]));
      setOutcomes(result.rows.map((row) => {
        const input = byId.get(row.id);
        return { ...row, label: input ? `${input.name.trim() || input.domain} (${input.domain})` : row.id };
      }));
      const successes = result.rows.filter(({ ok }) => ok).map(({ id }) => id);
      if (!successes.length) return;
      setProcessed((current) => new Set([...current, ...successes]));
      setSelection((current) => new Set([...current].filter((id) => !successes.includes(id))));
      refresh();
    });
  }

  return (
    <section aria-labelledby="suggested-companies">
      <h2 id="suggested-companies" className="text-[14.5px] font-semibold text-ink">Suggested companies</h2>
      <p className="mb-3 mt-1 text-[12px] text-neutral-500">
        From your own mailbox (last 30 days): companies you write with that aren&apos;t in Companies yet. Only you see these.
      </p>
      {remaining.length === 0 ? (
        <div className="vq-card-static rounded-[14px] bg-white p-6 text-center text-[12.5px] text-neutral-400">
          No suggestions right now.
        </div>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-neutral-100 bg-white p-2.5">
            <label className="inline-flex min-h-9 cursor-pointer items-center gap-2 px-1.5 text-[12px] font-semibold text-ink">
              <Checkbox checked={allSelected} aria-checked={selected.length > 0 && !allSelected ? "mixed" : allSelected}
                disabled={pending} onChange={(event) => setSelection(event.target.checked ? new Set(remaining.map(({ id }) => id)) : new Set())} />
              Select all
            </label>
            <span className="px-1 text-[12px] text-neutral-600">{selected.length} selected</span>
            <button type="button" disabled={pending || !selected.length} onClick={() => run("create", selected)}
              className="min-h-9 rounded-lg bg-ink px-3 text-[12px] font-semibold text-white disabled:opacity-40">
              Create selected
            </button>
            <button type="button" disabled={pending || !selected.length} onClick={() => run("dismiss", selected)}
              className="min-h-9 rounded-lg border border-neutral-200 px-3 text-[12px] font-semibold text-ink hover:border-cyan-300 disabled:opacity-40">
              Dismiss selected
            </button>
          </div>
          <ul className="grid gap-3 md:grid-cols-2">
            {remaining.map((suggestion) => (
              <SuggestionCard key={suggestion.id} suggestion={suggestion} name={names[suggestion.id] ?? suggestion.suggested_name}
                selected={selection.has(suggestion.id)} pending={pending} error={rowErrors.get(suggestion.id)}
                onName={(name) => setNames((current) => ({ ...current, [suggestion.id]: name }))}
                onSelect={(checked) => setSelection((current) => {
                  const next = new Set(current);
                  if (checked) next.add(suggestion.id); else next.delete(suggestion.id);
                  return next;
                })}
                onDismiss={() => run("dismiss", [suggestion])} />
            ))}
          </ul>
        </>
      )}
      <div role="status" aria-atomic="true">
        {pending && <p className="mt-3 text-[12px] text-neutral-600">Saving decisions…</p>}
        {batchError && <p className="mt-3 text-[12px] text-red-700">{batchError}</p>}
        {outcomes.length > 0 && (
          <div className="mt-3 rounded-xl border border-neutral-100 bg-white p-3 text-[12px]">
            <p className="font-semibold text-ink">{outcomes.filter(({ ok }) => ok).length} saved; {rowErrors.size} failed.</p>
            <ul className="mt-1 space-y-0.5">
              {outcomes.map(({ id, label, ok, message }) => (
                <li key={id} className={ok ? "break-words text-neutral-600" : "break-words text-red-700"}>
                  {label}: {message}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
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
              <li key={request.id} id={`contact-request-${request.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-[12px]">
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

      <CompanySuggestions suggestions={suggestions} refresh={() => router.refresh()} />
      {message && <p role="status" className="text-[11.5px] text-cyan-800">{message}</p>}
    </>
  );
}
