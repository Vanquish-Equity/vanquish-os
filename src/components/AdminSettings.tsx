"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteIgnoredDomain, saveIgnoredDomain, setMemberActive, setMemberPermission } from "@/lib/settings/admin-actions";

type Member = { email: string; name: string | null; active: boolean; permissions: string[] };
type Domain = { domain: string; reason: string };

function PermissionToggle({ label, enabled, disabled, onToggle }: { label: string; enabled: boolean; disabled: boolean; onToggle: () => void }) {
  return <button type="button" role="switch" aria-label={label} aria-checked={enabled} disabled={disabled} onClick={onToggle}
    className="flex items-center gap-2 text-[11px] text-neutral-700 disabled:opacity-40">
    <span aria-hidden="true" className={`relative h-5 w-9 rounded-full transition-colors ${enabled ? "bg-cyan-400" : "bg-neutral-200"}`}>
      <span className={`absolute left-[3px] top-[3px] h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform ${enabled ? "translate-x-4" : "translate-x-0"}`} />
    </span>{label}
  </button>;
}

export default function AdminSettings({ me, members, domains }: { me: string; members: Member[]; domains: Domain[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [domain, setDomain] = useState("");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  function run(action: () => Promise<{ ok: boolean; message?: string }>, success: string) {
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      setMessage(result.ok ? success : result.message ?? "Could not save the change.");
      if (result.ok) router.refresh();
    });
  }

  return (
    <section className="vq-card-static rounded-[14px] bg-white p-5 sm:p-6" aria-labelledby="settings-admin">
      <h2 id="settings-admin" className="text-[15px] font-semibold text-ink">Admin settings</h2>
      <p className="mt-1 text-[12px] text-neutral-500">Only members with the Admin permission can see or change these settings.</p>
      <h3 className="mt-5 text-[13px] font-semibold text-ink">Members & access</h3>
      <p className="mt-1 text-[11px] text-neutral-500">Portfolio and Documents grant access to sensitive areas. Your own account cannot be deactivated here.</p>
      <div className="mt-3 divide-y divide-neutral-100 rounded-xl border border-neutral-100">
        {members.map((member) => (
          <div key={member.email} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-3 text-[12px] sm:px-4">
            <div className="min-w-[190px] flex-1"><div className="font-semibold text-ink">{member.name || member.email.split("@")[0]}</div><div className="truncate text-neutral-500">{member.email}</div></div>
            <PermissionToggle label="Portfolio" enabled={member.permissions.includes("portfolio")} disabled={pending} onToggle={() => run(() => setMemberPermission(member.email, "portfolio", !member.permissions.includes("portfolio")), "Permission saved.")} />
            <PermissionToggle label="Documents" enabled={member.permissions.includes("documents")} disabled={pending} onToggle={() => run(() => setMemberPermission(member.email, "documents", !member.permissions.includes("documents")), "Permission saved.")} />
            <button type="button" disabled={pending || member.email === me} onClick={() => run(() => setMemberActive(member.email, !member.active), member.active ? "Member deactivated." : "Member activated.")}
              className="rounded-lg border border-neutral-200 px-2.5 py-1.5 text-[11px] font-semibold text-ink hover:border-cyan-300 disabled:opacity-40">{member.active ? "Deactivate" : "Activate"}</button>
          </div>
        ))}
      </div>
      <h3 className="mt-6 text-[13px] font-semibold text-ink">Ignored email domains</h3>
      <p className="mt-1 text-[11px] text-neutral-500">This list is ready for company detection when email sync is connected. It does not currently filter any emails.</p>
      <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); run(() => saveIgnoredDomain(domain, reason), "Domain saved."); setDomain(""); setReason(""); }}>
        <label className="min-w-[180px] flex-1 text-[11px] font-semibold text-ink">Domain
          <input value={domain} onChange={(event) => setDomain(event.target.value)} placeholder="example.com" required maxLength={253} className="mt-1 block w-full rounded-lg border border-neutral-200 px-3 py-2 text-[12px] font-normal" />
        </label>
        <label className="min-w-[180px] flex-1 text-[11px] font-semibold text-ink">Reason
          <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Internal, accounting, legal…" maxLength={200} className="mt-1 block w-full rounded-lg border border-neutral-200 px-3 py-2 text-[12px] font-normal" />
        </label>
        <button type="submit" disabled={pending} className="rounded-lg bg-ink px-3 py-2 text-[12px] font-semibold text-white disabled:opacity-40">Save domain</button>
      </form>
      {domains.length > 0 && <ul className="mt-3 divide-y divide-neutral-100 rounded-xl border border-neutral-100">
        {domains.map((entry) => <li key={entry.domain} className="flex items-center gap-3 px-3 py-2.5 text-[12px]">
          <span className="font-semibold text-ink">{entry.domain}</span><span className="min-w-0 flex-1 truncate text-neutral-500">{entry.reason}</span>
          <button type="button" disabled={pending} onClick={() => run(() => deleteIgnoredDomain(entry.domain), "Domain removed.")} className="text-[11px] font-semibold text-neutral-500 hover:text-ink disabled:opacity-40">Remove</button>
        </li>)}
      </ul>}
      <p className="mt-3 text-[11px] text-neutral-500">Company detection rules will appear here when mailbox sync and its review queue are connected.</p>
      {message && <p role="status" className="mt-3 text-[11px] text-cyan-800">{message}</p>}
    </section>
  );
}
