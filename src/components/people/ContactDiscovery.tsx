"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { addSecondaryContactEmail, createDiscoveredPerson } from "@/lib/people/actions";
import { scanContactSuggestions } from "@/lib/people/contact-discovery-actions";
import type { ContactCandidate } from "@/lib/people/contact-discovery";

export default function ContactDiscovery({ companies, people }: {
  companies: { id: string; name: string }[];
  people: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [candidates, setCandidates] = useState<ContactCandidate[] | null>(null);
  const [selected, setSelected] = useState<ContactCandidate | null>(null);
  const [notice, setNotice] = useState("");
  const [warnings, setWarnings] = useState<(string | null)[]>([]);
  const [created, setCreated] = useState<string | null>(null);

  async function scan() {
    setPending(true); setNotice(""); setSelected(null); setCandidates(null); setWarnings([]); setCreated(null);
    try {
      const result = await scanContactSuggestions();
      if (!result.ok) { setNotice(result.message); return; }
      setCandidates(result.data.candidates);
      setWarnings(result.data.warnings);
      if (result.data.partial) setNotice("Partial scan. These results may not include every eligible contact.");
    } catch { setNotice("Contact discovery is unavailable right now."); }
    finally { setPending(false); }
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || pending) return;
    const form = new FormData(event.currentTarget);
    setPending(true); setNotice(""); setCreated(null);
    try {
      const result = mode === "existing"
        ? await addSecondaryContactEmail({ personId: String(form.get("person") ?? ""), email: selected.email })
        : await createDiscoveredPerson({
        name: String(form.get("name") ?? ""), email: selected.email, title: "", companyId: String(form.get("company") ?? "") || null, linkedinUrl: "",
        organizationName: String(form.get("organization") ?? ""),
      });
      if (!result.ok) { setNotice(result.message); return; }
      setCreated(result.personId ?? null);
      setCandidates((current) => current?.filter((row) => row.email !== selected.email) ?? null);
      setSelected(null);
      setNotice(mode === "existing" ? "Secondary email added." : "Contact added to People.");
      router.refresh();
    } catch { setNotice("Could not add this contact."); }
    finally { setPending(false); }
  }

  const button = "rounded-full border border-neutral-200 px-3.5 py-2 text-xs font-semibold hover:border-cyan-300 disabled:opacity-50";
  return <section aria-label="Contact discovery">
    <button type="button" className={button} aria-expanded={open} aria-controls="contact-discovery"
      onClick={() => {
        if (open) { setCandidates(null); setSelected(null); setNotice(""); setWarnings([]); setCreated(null); }
        setOpen(!open);
      }} disabled={pending}>Discover contacts</button>
    {open && <div id="contact-discovery" className="vq-card-static mt-2 space-y-3 rounded-[14px] bg-white p-4">
      <p className="text-sm text-neutral-600">Review suggestions from your sent Gmail and completed meetings on your primary Calendar from the last 30 days. Suggestions stay in this panel until you add a person to the shared CRM.</p>
      <button type="button" className={button} onClick={scan} disabled={pending}>{pending && !selected ? "Scanning…" : "Scan my Google account"}</button>
      <p role="status" className="text-sm text-neutral-600">{notice}{created && <> <Link className="text-cyan-800 underline" href={`/people/${created}`}>Open contact</Link></>}</p>
      {warnings.filter(Boolean).map((warning) => <p key={warning} className="text-xs text-neutral-600">{warning}</p>)}
      {candidates && !candidates.length && <p className="text-sm text-neutral-600">No new contacts found in the results checked.</p>}
      {candidates && candidates.length > 0 && <ul className="divide-y divide-neutral-100">
        {candidates.map((candidate) => <li key={candidate.email} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
          <div className="min-w-0"><p className="break-all">{candidate.email}</p><p className="text-xs text-neutral-600">{candidate.sources.join(" + ")}</p></div>
          <button type="button" className={button} disabled={pending} aria-label={`Review ${candidate.email}`}
            onClick={() => { setSelected(candidate); setMode("new"); setNotice(""); setCreated(null); }}>Review</button>
        </li>)}
      </ul>}
      {selected && <form key={selected.email} onSubmit={save} className="space-y-2 rounded-lg border border-neutral-200 p-3">
        <p className="break-all text-sm font-semibold">Add {selected.email} to People</p>
        <label className="block text-xs font-medium">Save as
          <select value={mode} onChange={(e) => setMode(e.target.value === "existing" ? "existing" : "new")} className="mt-1 block w-full rounded-lg border p-2">
            <option value="new">New person</option><option value="existing">Secondary email for an existing person</option>
          </select>
        </label>
        {mode === "existing" ? <label className="block text-xs font-medium">Person from the current People view
          <select required name="person" className="mt-1 block w-full rounded-lg border p-2">
            <option value="">Choose a person</option>
            {people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
          </select>
        </label> : <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-xs font-medium">Name
            <input autoFocus required name="name" maxLength={160} className="mt-1 block w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm" />
          </label>
          <label className="text-xs font-medium">Organization (optional)
            <input name="organization" maxLength={160} className="mt-1 block w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm" />
          </label>
          <label className="text-xs font-medium">Or link to an existing company
            <select name="company" className="mt-1 block w-full rounded-lg border p-2">
              <option value="">No linked company</option>
              {companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
            </select>
          </label>
        </div>}
        <div className="flex flex-wrap gap-2">
          <button className={button} disabled={pending}>{pending ? "Adding…" : mode === "existing" ? "Confirm and add email" : "Confirm and add person"}</button>
          <button type="button" className={button} disabled={pending} onClick={() => setSelected(null)}>Cancel</button>
        </div>
      </form>}
    </div>}
  </section>;
}
