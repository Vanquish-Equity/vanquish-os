"use client";

import Link from "next/link";
import { useActionState } from "react";
import { createStandaloneCompany } from "./actions";

const inputStyle = "rounded-xl border border-neutral-200 px-3 py-2 text-sm";

export default function CompanyForm() {
  const [error, action, pending] = useActionState(createStandaloneCompany, null);
  return (
    <form action={action} className="vq-card-static flex flex-col gap-4 rounded-[14px] bg-white p-5">
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Company name
        <input name="name" required maxLength={200} className={inputStyle} />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Website <span className="sr-only">(optional)</span>
        <input name="website" inputMode="url" autoComplete="url" maxLength={500} placeholder="Optional" className={inputStyle} />
      </label>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className="min-h-10 rounded-full bg-ink px-4 text-sm font-semibold text-white disabled:opacity-50">
          {pending ? "Creating…" : "Create company"}
        </button>
        <Link href="/companies" className="px-2 py-2 text-sm text-neutral-600">Cancel</Link>
      </div>
    </form>
  );
}
