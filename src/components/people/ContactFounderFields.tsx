"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveFounderProfile } from "@/lib/people/founder-profile-actions";
import { FOUNDER_FIELDS, type FounderProfile } from "@/lib/people/founder-profile";

export default function ContactFounderFields({ personId, fields, available }: {
  personId: string; fields: FounderProfile; available: boolean;
}) {
  const id = useId();
  const router = useRouter();
  const [values, setValues] = useState(fields);
  const [notice, setNotice] = useState("");
  const [pending, start] = useTransition();
  return <section className="vq-card-static rounded-[14px] bg-white p-4">
    <h2 className="text-sm font-semibold">Location and origin</h2>
    {!available ? <p className="mt-2 text-sm text-neutral-600">Location and origin are unavailable until the database update is applied.</p> : <>
      <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
        {FOUNDER_FIELDS.map(({ key, label }) => <div key={key} className="min-w-0">
          <dt className="text-xs text-neutral-500">{label}</dt><dd className="mt-1 break-words">{fields[key] ?? "Not set"}</dd>
        </div>)}
      </dl>
      <details className="mt-3">
        <summary className="min-h-9 cursor-pointer py-2 text-sm font-semibold text-cyan-800">Edit location and origin</summary>
        <form className="mt-2 space-y-3" onSubmit={(event) => {
          event.preventDefault(); setNotice("");
          start(async () => {
            try {
              const result = await saveFounderProfile(personId, values);
              setNotice(result.ok ? "Location and origin saved." : result.message);
              if (result.ok) router.refresh();
            } catch { setNotice("Location and origin could not be saved."); }
          });
        }}>
          {FOUNDER_FIELDS.map(({ key, label, max }) => <div key={key}>
            <label htmlFor={`${id}-${key}`} className="text-xs font-medium">{label}</label>
            <input id={`${id}-${key}`} value={values[key] ?? ""} maxLength={max} disabled={pending}
              onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))}
              className="mt-1 block min-h-11 w-full rounded-xl border border-neutral-200 bg-white px-3 text-sm" />
          </div>)}
          <p className="text-xs text-neutral-500">Optional, entered by a member. Origin describes where the person is from; no location is inferred from email.</p>
          <button type="submit" disabled={pending} className="min-h-11 rounded-full border border-neutral-200 px-4 text-xs font-semibold">
            {pending ? "Saving…" : "Save location and origin"}
          </button>
          <p role="status" className="text-xs text-neutral-600">{notice}</p>
        </form>
      </details>
    </>}
  </section>;
}
