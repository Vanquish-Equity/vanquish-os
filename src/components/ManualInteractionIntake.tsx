"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { proposeInteractionAction } from "@/lib/interactions/actions";
import { FormSelectMenu } from "@/components/SelectMenu";

export default function ManualInteractionIntake() {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<React.ReactNode>(null);
  const input = "w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-[12.5px] text-ink outline-none focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100";

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await proposeInteractionAction(data);
      if (!result.ok) { setFeedback(result.message); return; }
      formRef.current?.reset();
      setFeedback(result.outcome === "attached" && result.companyId
        ? <>Matched a known company. <Link className="text-cyan-700 underline" href={`/companies/${result.companyId}`}>Open company</Link>.</>
        : result.outcome === "review"
          ? "No safe single match. The interaction is in Review for a human decision."
          : "Only ignored or personal domains were supplied; nothing was added.");
      router.refresh();
    });
  }

  return <section className="vq-card-static rounded-[14px] bg-white p-5">
    <h2 className="text-[14px] font-semibold text-ink">Capture an interaction</h2>
    <p className="mt-1 text-[12px] text-neutral-500">Manually enter an email, call, or meeting. Known identities can be linked; uncertain ones wait here for review. This does not connect or read a mailbox.</p>
    <form ref={formRef} onSubmit={submit} className="mt-4 grid gap-3 sm:grid-cols-2">
      <label className="text-[11px] font-semibold text-neutral-600">Company name (if known)
        <input name="companyName" className={`${input} mt-1`} placeholder="Company or possible name" maxLength={200} />
      </label>
      <label className="text-[11px] font-semibold text-neutral-600">Participant emails
        <input name="participants" type="text" className={`${input} mt-1`} placeholder="name@company.com, ..." required />
      </label>
      <div className="sm:col-span-1"><span className="text-[11px] font-semibold text-neutral-600">Type</span><FormSelectMenu name="type" defaultValue="email" options={["email","meeting","call","note"].map(v=>({label:v,value:v}))} /></div>
      <label className="text-[11px] font-semibold text-neutral-600">When (optional)
        <input name="occurredAt" type="datetime-local" className={`${input} mt-1`} />
      </label>
      <label className="text-[11px] font-semibold text-neutral-600 sm:col-span-2">Subject
        <input name="subject" className={`${input} mt-1`} maxLength={500} placeholder="What was discussed?" />
      </label>
      <label className="text-[11px] font-semibold text-neutral-600 sm:col-span-2">Summary
        <textarea name="summary" rows={2} maxLength={4000} className={`${input} mt-1`} placeholder="Relevant context" />
      </label>
      <div className="flex flex-wrap items-center justify-between gap-3 sm:col-span-2">
        <span role="status" className="text-[11px] text-neutral-600">{feedback}</span>
        <button type="submit" disabled={pending} className="rounded-lg bg-ink px-4 py-2 text-[11.5px] font-semibold text-white disabled:opacity-50">{pending ? "Checking..." : "Record or send to Review"}</button>
      </div>
    </form>
  </section>;
}
