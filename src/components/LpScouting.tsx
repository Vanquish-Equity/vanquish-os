"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import Checkbox from "./Checkbox";
import SelectMenu from "./SelectMenu";
import {
  saveLpScouting,
  scanLpNow,
  decideLp,
  decideLpContact,
  saveLpKeyword,
} from "@/lib/lp-scouting/actions";
export type LpSuggestion = {
  id: string;
  email: string;
  name: string;
  confidence: string;
  signal_count: number;
  last_seen_at: string;
  evidence: unknown;
  status: string;
};
export type LpSettings = {
  enabled: boolean;
  contact_mode: string;
  share_metadata: boolean;
  window_days: number;
  message_cap: number;
  last_scanned_at: string | null;
};
export default function LpScouting({
  settings,
  suggestions,
  contacts,
  companies,
  keywords,
  admin,
  jobs,
}: {
  settings: LpSettings;
  suggestions: LpSuggestion[];
  contacts: { id: string; name: string; email: string }[];
  companies: { id: string; name: string }[];
  keywords: {
    phrase: string;
    kind: string;
    strong: boolean;
    enabled: boolean;
  }[];
  admin: boolean;
  jobs: {
    id: string;
    service: string;
    status: string;
    error_code: string | null;
  }[];
}) {
  const [enabled, setEnabled] = useState(settings.enabled),
    [mode, setMode] = useState(settings.contact_mode),
    [metadata, setMetadata] = useState(settings.share_metadata),
    [days, setDays] = useState(settings.window_days),
    [cap, setCap] = useState(settings.message_cap),
    [pending, start] = useTransition(),
    [message, setMessage] = useState("");
  const [names, setNames] = useState<Record<string, string>>({}),
    [company, setCompany] = useState<Record<string, string>>({}),
    [board, setBoard] = useState<Record<string, boolean>>({});
  const [phrase, setPhrase] = useState(""),
    [kind, setKind] = useState("mail"),
    [strong, setStrong] = useState(false);
  function run(action: () => Promise<{ ok: boolean; message?: string }>) {
    start(async () => {
      try {
        const result = await action();
        setMessage(result.message ?? "Saved.");
      } catch {
        setMessage("Could not complete the action. Refresh and try again.");
      }
    });
  }
  const input =
    "w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm focus:outline-cyan-400";
  return (
    <div className="mx-auto max-w-5xl space-y-5 px-4 py-6 sm:px-7">
      <h1 className="text-2xl font-semibold">LP scouting</h1>
      <p className="text-sm text-neutral-500">
        Private suggestions from your connected Google account. Approval creates
        a potential LP in People; it never creates a commitment.{" "}
        <Link href="/lp-board" className="text-cyan-800 underline">
          My LPs
        </Link>
      </p>
      <section className="vq-card-static space-y-4 p-5">
        <h2 className="font-semibold">Your consent and limits</h2>
        <label className="flex items-center gap-2">
          <Checkbox
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          Enable LP scouting
        </label>
        <label className="flex items-center gap-2">
          <Checkbox
            checked={metadata}
            onChange={(e) => setMetadata(e.target.checked)}
          />
          Include subjects, meeting titles and filenames in private evidence
        </label>
        <p className="text-xs text-neutral-500">
          Bodies and attachment contents are excluded. Pausing prevents new
          scans; use Integration health to withdraw existing source data.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label htmlFor="lp-mode">
              Additional contacts after LP approval
            </label>
            <SelectMenu
              id="lp-mode"
              value={mode}
              onChange={setMode}
              options={[
                { value: "request", label: "Ask me first" },
                { value: "skip", label: "Skip contacts" },
                { value: "auto", label: "Add same-organization contacts" },
              ]}
            />
          </div>
          <label>
            Lookback days
            <input
              className={input}
              type="number"
              min={1}
              max={90}
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
            />
          </label>
          <label>
            Records per service
            <input
              className={input}
              type="number"
              min={10}
              max={500}
              value={cap}
              onChange={(e) => setCap(Number(e.target.value))}
            />
          </label>
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            disabled={pending}
            onClick={() =>
              run(() => saveLpScouting(enabled, mode, metadata, days, cap))
            }
            className="rounded-xl bg-ink px-4 py-2 text-white disabled:opacity-50"
          >
            Save settings
          </button>
          <button
            disabled={pending || !settings.enabled}
            onClick={() => run(scanLpNow)}
            className="rounded-xl border px-4 py-2 disabled:opacity-50"
          >
            Process one batch now
          </button>
          <Link
            href="/integrations"
            className="px-3 py-2 text-cyan-800 underline"
          >
            Integration health
          </Link>
        </div>
        <p className="text-xs">
          Last scan: {settings.last_scanned_at ?? "Never"}. Manual processing
          handles a bounded batch; remaining work requires another batch or the
          enabled worker.
        </p>
      </section>
      <p role="status" aria-live="polite" className="text-sm text-cyan-800">
        {pending ? "Working…" : message}
      </p>
      <section className="space-y-3">
        <h2 className="font-semibold">Suggestions · latest 100</h2>
        {!suggestions.length && <p>No suggestions awaiting review.</p>}
        {suggestions.map((s) => (
          <article key={s.id} className="vq-card-static space-y-3 p-5">
            <div className="flex flex-wrap justify-between gap-2">
              <p className="break-all font-semibold">{s.email}</p>
              <span className="text-sm">
                {s.confidence} · {s.signal_count} signals
              </span>
            </div>
            <p className="text-xs text-neutral-500">
              Confidence is a rule label, not an investment assessment. Last
              signal: {s.last_seen_at}
            </p>
            <details>
              <summary className="cursor-pointer text-sm">Evidence</summary>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all text-xs">
                {JSON.stringify(s.evidence, null, 2)}
              </pre>
            </details>
            <div className="grid gap-3 sm:grid-cols-2">
              <label>
                Name
                <input
                  className={input}
                  maxLength={200}
                  value={names[s.id] ?? s.name}
                  onChange={(e) =>
                    setNames({ ...names, [s.id]: e.target.value })
                  }
                />
              </label>
              <div>
                <label htmlFor={`company-${s.id}`}>
                  Existing company (optional)
                </label>
                <SelectMenu
                  id={`company-${s.id}`}
                  value={company[s.id] ?? ""}
                  onChange={(v) => setCompany({ ...company, [s.id]: v })}
                  options={[
                    { value: "", label: "No company link" },
                    ...companies.map((c) => ({ value: c.id, label: c.name })),
                  ]}
                />
              </div>
            </div>
            <label className="flex items-center gap-2">
              <Checkbox
                checked={board[s.id] ?? false}
                onChange={(e) =>
                  setBoard({ ...board, [s.id]: e.target.checked })
                }
              />
              Add to my LP board’s first list
            </label>
            <div className="flex gap-3">
              <button
                disabled={pending}
                className="rounded-xl bg-ink px-4 py-2 text-white"
                onClick={() =>
                  run(() =>
                    decideLp(
                      s.id,
                      true,
                      names[s.id] ?? s.name,
                      board[s.id] ?? false,
                      company[s.id] ?? "",
                    ),
                  )
                }
              >
                Approve LP
              </button>
              <button
                disabled={pending}
                className="rounded-xl border px-4 py-2"
                onClick={() =>
                  run(() => decideLp(s.id, false, s.name, false, ""))
                }
              >
                Dismiss
              </button>
            </div>
          </article>
        ))}
      </section>
      <section className="vq-card-static space-y-3 p-5">
        <h2 className="font-semibold">Private contact requests</h2>
        {!contacts.length && <p className="text-sm">No pending requests.</p>}
        {contacts.map((c) => (
          <div key={c.id} className="flex flex-wrap items-center gap-3">
            <span className="break-all text-sm">
              {c.name} · {c.email}
            </span>
            <button
              disabled={pending}
              onClick={() => run(() => decideLpContact(c.id, true))}
            >
              Add to People
            </button>
            <button
              disabled={pending}
              onClick={() => run(() => decideLpContact(c.id, false))}
            >
              Decline
            </button>
          </div>
        ))}
      </section>
      <section className="vq-card-static p-5">
        <h2 className="font-semibold">Recent scan jobs · latest 20</h2>
        {jobs.map((j) => (
          <p key={j.id} className="text-sm">
            {j.service} · {j.status}
            {j.error_code ? ` · ${j.error_code}` : ""}
          </p>
        ))}
      </section>
      {admin && (
        <section className="vq-card-static space-y-3 p-5">
          <h2 className="font-semibold">Admin keywords</h2>
          <div className="flex flex-wrap gap-2">
            {keywords.map((k) => (
              <button
                key={k.kind + k.phrase}
                disabled={pending}
                className="rounded-xl border px-3 py-2 text-xs"
                onClick={() =>
                  run(() =>
                    saveLpKeyword(k.phrase, k.kind, k.strong, !k.enabled),
                  )
                }
              >
                {k.phrase} · {k.kind} · {k.strong ? "strong" : "normal"} ·{" "}
                {k.enabled ? "enabled" : "disabled"}
              </button>
            ))}
          </div>
          <label>
            Phrase
            <input
              className={input}
              minLength={3}
              maxLength={100}
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
            />
          </label>
          <SelectMenu
            value={kind}
            onChange={setKind}
            options={[
              { value: "mail", label: "Email" },
              { value: "calendar", label: "Calendar" },
            ]}
          />
          <label className="flex items-center gap-2">
            <Checkbox
              checked={strong}
              onChange={(e) => setStrong(e.target.checked)}
            />
            Strong investor-specific phrase
          </label>
          <button
            disabled={pending || phrase.trim().length < 3}
            onClick={() => run(() => saveLpKeyword(phrase, kind, strong, true))}
          >
            Save keyword
          </button>
        </section>
      )}
    </div>
  );
}
