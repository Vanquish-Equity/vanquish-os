"use client";

import { useState, useTransition } from "react";
import SelectMenu from "@/components/SelectMenu";
import { savePersonOrganization } from "@/lib/people/actions";

export default function ContactOrganization({ personId, companyId, organizationName, companies }: {
  personId: string; companyId: string; organizationName: string; companies: { id: string; name: string }[];
}) {
  const [company, setCompany] = useState(companyId);
  const [name, setName] = useState(organizationName);
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  return <form className="space-y-3" onSubmit={(event) => {
    event.preventDefault();
    setMessage("");
    start(async () => {
      const result = await savePersonOrganization({ personId, companyId: company, organizationName: name });
      setMessage(result.ok ? "Organization saved." : result.message);
    });
  }}>
    <div>
      <label htmlFor="contact-company" className="mb-1 block text-xs font-medium">Link a CRM company</label>
      <SelectMenu id="contact-company" value={company} options={[{ value: "", label: "No linked company" }, ...companies.map(({ id, name }) => ({ value: id, label: name }))]} onChange={(value) => { setCompany(value); if (value) setName(""); }} />
    </div>
    {!company && <label className="block text-xs font-medium">Organization name
      <input className="mt-1 block min-h-11 w-full rounded-xl border border-neutral-200 px-3 text-sm" value={name} onChange={(event) => setName(event.target.value)} maxLength={160} placeholder="Family office, firm, or other affiliation" />
    </label>}
    <button type="submit" disabled={pending} className="min-h-11 rounded-full border border-neutral-200 px-4 text-xs font-semibold">{pending ? "Saving…" : "Save organization"}</button>
    <p role="status" className="text-xs text-neutral-600">{message}</p>
  </form>;
}
