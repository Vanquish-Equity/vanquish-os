"use client";

import { useState, useTransition } from "react";
import { exportShownPeople } from "@/lib/people/founder-profile-actions";

export default function PeopleProfileExport({ ids }: { ids: string[] }) {
  const [pending, start] = useTransition();
  const [notice, setNotice] = useState("");
  return <div>
    <button type="button" disabled={pending || !ids.length} className="min-h-9 rounded-full border border-neutral-200 px-3.5 text-xs font-semibold disabled:opacity-40"
      onClick={() => start(async () => {
        setNotice("");
        try {
          const result = await exportShownPeople(ids);
          if (!result.ok) { setNotice(result.message); return; }
          const url = URL.createObjectURL(new Blob([result.csv], { type: "text/csv;charset=utf-8" }));
          const download = document.createElement("a");
          download.href = url; download.download = "people-shown.csv"; download.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch { setNotice("Export unavailable. Try again."); }
      })}>{pending ? "Preparing CSV…" : "Export shown (CSV)"}</button>
    <p role="status" className="mt-1 text-xs text-neutral-600">{notice}</p>
  </div>;
}
