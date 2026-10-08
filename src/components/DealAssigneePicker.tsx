"use client";

import Checkbox from "@/components/Checkbox";
import { useState } from "react";
import { useRouter } from "next/navigation";
import DealAssigneeAvatars from "@/components/DealAssigneeAvatars";
import { setDealAssigneeAction } from "@/lib/deals/assignee-actions";
import type { DealMember } from "@/lib/deals/assignee-types";

export default function DealAssigneePicker({ dealId, members, initial, readOnly = false }: { dealId: string; members: DealMember[]; initial: DealMember[]; readOnly?: boolean }) {
  const router = useRouter();
  const [assigned, setAssigned] = useState(initial);
  const [busyEmail, setBusyEmail] = useState<string | null>(null);
  const [error, setError] = useState("");
  return <div className="rounded-xl border border-neutral-200 p-5"><div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold text-ink">Assigned team members</h3><DealAssigneeAvatars members={assigned} /></div>
    {!readOnly && <><p className="mt-1 text-xs text-neutral-500">Select everyone working on this Deal. Changes appear on the Pipeline cards.</p>
      <div className="mt-3 grid max-h-40 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2">{members.map((member) => {
        const selected = assigned.some((person) => person.email === member.email);
        return <label key={member.email} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-neutral-50"><Checkbox checked={selected} disabled={busyEmail !== null} onChange={async () => {
          setBusyEmail(member.email); const result = await setDealAssigneeAction(dealId, member.email, !selected); setBusyEmail(null);
          if (!result.ok) setError(result.message); else { setAssigned((current) => selected ? current.filter((person) => person.email !== member.email) : [...current, member]); setError(""); router.refresh(); }
        }} /><span className="truncate">{member.name}</span></label>;
      })}</div></>}
    {readOnly && !assigned.length && <p className="mt-2 text-xs text-neutral-500">No assigned team members.</p>}
    {error && <p role="alert" className="mt-2 text-xs text-red-600">{error}</p>}
  </div>;
}
