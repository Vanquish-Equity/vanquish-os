"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import SelectMenu from "@/components/SelectMenu";
import { resolveManualInteractionAction } from "@/lib/review/actions";

type Company = { id: string; name: string };
type Deal = { id: string; company_id: string; name: string };

export default function ManualInteractionDecision({
  reviewItemId, companyName, emails, candidates, companies, deals,
}: {
  reviewItemId: string;
  companyName?: string | null;
  emails: string[];
  candidates: Company[];
  companies: Company[];
  deals: Deal[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [companyId, setCompanyId] = useState(candidates.length === 1 ? candidates[0].id : "");
  const [dealId, setDealId] = useState("");
  const [domain, setDomain] = useState("");
  const [error, setError] = useState("");
  const options = [...new Set(emails.map(e => e.split("@")[1]).filter(Boolean))]
    .filter(d => !["gmail.com","outlook.com","hotmail.com","yahoo.com","icloud.com","vanquishequity.com"].includes(d));
  const all = [...companies].sort((a,b) => (candidates.some(c=>c.id===b.id) ? 1 : 0) - (candidates.some(c=>c.id===a.id) ? 1 : 0) || a.name.localeCompare(b.name));

  function submit(action: "link" | "create" | "ignore") {
    if (action === "link" && !companyId) { setError("Choose the existing company."); return; }
    if (action === "create" && !companyName) { setError("A proposed company name is needed to create it."); return; }
    setError("");
    startTransition(async () => {
      const result = await resolveManualInteractionAction({
        reviewItemId, action,
        companyId: action === "link" ? companyId : undefined,
        dealId: action === "link" ? dealId : undefined,
        learnDomain: action !== "ignore" ? domain : undefined,
      });
      if (!result.ok) { setError(result.message); return; }
      router.refresh();
    });
  }

  return <div className="mt-4 space-y-3 border-t border-neutral-100 pt-4">
    {candidates.length > 0 && <p className="text-[11px] text-neutral-600">Possible matches: {candidates.map(c=>c.name).join(", ")}. Confirm before linking.</p>}
    <div className="grid gap-2 sm:grid-cols-2">
      <div><span className="text-[11px] font-semibold text-neutral-500">Existing company</span>
        <SelectMenu value={companyId} onChange={v=>{setCompanyId(v);setDealId("");}} options={[{value:"",label:"Choose company"},...all.map(c=>({value:c.id,label:c.name}))]} />
      </div>
      <div><span className="text-[11px] font-semibold text-neutral-500">Deal (optional)</span>
        <SelectMenu value={dealId} onChange={setDealId} disabled={!companyId} options={[{value:"",label:"Company level"},...deals.filter(d=>d.company_id===companyId).map(d=>({value:d.id,label:d.name}))]} />
      </div>
      <div className="sm:col-span-2"><span className="text-[11px] font-semibold text-neutral-500">Remember domain for future matches (optional)</span>
        <SelectMenu value={domain} onChange={setDomain} options={[{value:"",label:"Do not remember domain"},...options.map(d=>({value:d,label:d}))]} />
      </div>
    </div>
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" disabled={pending} onClick={()=>submit("link")} className="rounded-lg bg-ink px-3 py-2 text-[11px] font-semibold text-white disabled:opacity-50">Link to company</button>
      {companyName && <button type="button" disabled={pending} onClick={()=>submit("create")} className="rounded-lg border border-neutral-200 px-3 py-2 text-[11px] font-semibold text-neutral-700 disabled:opacity-50">Create {companyName}</button>}
      <button type="button" disabled={pending} onClick={()=>submit("ignore")} className="rounded-lg border border-neutral-200 px-3 py-2 text-[11px] text-neutral-500 disabled:opacity-50">Ignore</button>
      {error && <span role="alert" className="text-[11px] text-red-600">{error}</span>}
    </div>
  </div>;
}
