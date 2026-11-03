"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import FieldInput from "@/components/custom-fields/FieldInput";
import { saveRecordField } from "@/lib/custom-fields/actions";
import type { FieldDefinition, FieldValue } from "@/lib/custom-fields/model";

export default function PeopleFieldCell({ definition, person, stored }: {
  definition: FieldDefinition; person: string; stored?: FieldValue;
}) {
  const id = useId();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState("");
  const initial = stored?.multi_value ?? stored?.option_value ?? stored?.text_value ?? stored?.number_value ??
    stored?.date_value ?? stored?.boolean_value ?? (definition.field_type === "multi_select" ? [] : definition.field_type === "boolean" ? false : "");
  const [value, setValue] = useState<unknown>(initial);
  const [pending, start] = useTransition();
  const optionIds = stored?.multi_value ?? (stored?.option_value ? [stored.option_value] : []);
  const labels = definition.options.filter((option) => optionIds.includes(option.id)).map((option) => option.label);
  function save(clear: boolean) {
    setStatus("");
    start(async () => {
      try {
        const result = await saveRecordField({ object: "people", recordId: person, definitionId: definition.id,
          version: definition.version, token: stored?.token ?? null, value, clear });
        if (!result.ok) { setStatus(result.message); return; }
        setEditing(false);
        router.refresh();
      } catch { setStatus("Could not confirm the save. Refresh before retrying."); }
    });
  }
  if (!editing) return <button type="button" aria-label={`Edit ${definition.name}`} onClick={() => { setValue(initial); setStatus(""); setEditing(true); }}
    className="flex min-h-10 w-full flex-wrap items-center gap-1 rounded px-2 py-1 text-left hover:bg-cyan-50">
    {labels.length ? labels.map((label) => <span key={label} className="rounded bg-cyan-50 px-1.5 py-0.5 text-cyan-900">{label}</span>)
      : stored?.is_set ? <span className="max-w-48 truncate">{String(initial)}</span> : <span className="text-neutral-400">—</span>}
  </button>;
  return <form className="min-w-44 space-y-1 px-2 py-2" onSubmit={(event) => { event.preventDefault(); save(false); }}>
    <label id={id + "-label"} htmlFor={definition.field_type === "multi_select" ? undefined : id} className="sr-only">{definition.name}</label>
    <FieldInput id={id} labelledBy={id + "-label"} definition={definition} value={value} onChange={setValue} disabled={pending} />
    <div className="flex flex-wrap gap-2 text-xs">
      <button disabled={pending} className="min-h-9 font-semibold text-cyan-800">Save</button>
      {stored?.is_set && <button disabled={pending} type="button" className="min-h-9" onClick={() => save(true)}>Clear</button>}
      <button disabled={pending} type="button" className="min-h-9" onClick={() => setEditing(false)}>Cancel</button>
    </div>
    {status && <p role="status" className="text-xs">{status}</p>}
  </form>;
}
