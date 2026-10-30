"use client";
import { useState, useEffect, useTransition, startTransition } from "react";
import SelectMenu from "@/components/SelectMenu";
import Checkbox from "@/components/Checkbox";
import { loadTemplates, saveTemplate } from "@/lib/customization/actions";
import type { Template } from "@/lib/customization/spec";
export default function TemplatesAdmin() {
  const [rows, setRows] = useState<Template[] | null>(null),
    [selected, setSelected] = useState(""),
    [name, setName] = useState(""),
    [tasks, setTasks] = useState(""),
    [checklist, setChecklist] = useState(""),
    [archived, setArchived] = useState(false),
    [status, setStatus] = useState(""),
    [pending, run] = useTransition();
  useEffect(() => {
    let live = true;
    startTransition(async () => {
      const r = await loadTemplates(true);
      if (live && r.ok) setRows(r.templates);
    });
    return () => {
      live = false;
    };
  }, []);
  if (!rows) return null;
  const current = rows.find((t) => t.id === selected);
  const lines = (v: string) =>
    v
      .split("\n")
      .map((x) => x.trim())
      .filter(Boolean);
  return (
    <section
      aria-label="Admin task templates"
      className="vq-card-static min-w-0 rounded-[14px] bg-white p-5 motion-reduce:[&_*]:transition-none"
    >
      <h2 className="text-sm font-semibold">Task and checklist templates</h2>
      <p className="my-2 text-xs text-neutral-500">
        Admin-authored shared titles only. No record-content substitution.
        Maximum 50 templates, 25 tasks and 20 checklist items per template;
        archive retains history.
      </p>
      <label htmlFor="template-admin" className="text-xs">
        Template
      </label>
      <SelectMenu
        id="template-admin"
        value={selected}
        disabled={pending}
        options={[
          { value: "", label: "New template" },
          ...rows.map((t) => ({
            value: t.id,
            label: t.name + (t.archived ? " · archived" : ""),
          })),
        ]}
        onChange={(id) => {
          setSelected(id);
          const t = rows.find((t) => t.id === id);
          setName(t?.name ?? "");
          setTasks(t?.task_titles.join("\n") ?? "");
          setChecklist(t?.checklist_titles.join("\n") ?? "");
          setArchived(t?.archived ?? false);
        }}
        buttonClassName="min-h-11"
      />
      <form
        className="mt-3 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            const r = await saveTemplate({
              id: selected || null,
              name,
              tasks: lines(tasks),
              checklist: lines(checklist),
              archived,
              version: current?.version ?? 0,
            });
            setStatus(r.ok ? "Template saved." : r.message);
            if (r.ok) {
              const next = await loadTemplates(true);
              if (next.ok) setRows(next.templates);
            }
          });
        }}
      >
        <label className="block text-xs">
          Shared template name
          <input
            value={name}
            maxLength={80}
            disabled={pending}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 min-h-11 w-full rounded-xl border px-3"
          />
        </label>
        <label className="block text-xs">
          Task titles · one per line, up to 25
          <textarea
            value={tasks}
            disabled={pending}
            maxLength={6000}
            onChange={(e) => setTasks(e.target.value)}
            className="mt-1 min-h-28 w-full rounded-xl border p-3"
          />
        </label>
        <label className="block text-xs">
          Checklist titles · one per line, up to 20
          <textarea
            value={checklist}
            disabled={pending}
            maxLength={4500}
            onChange={(e) => setChecklist(e.target.value)}
            className="mt-1 min-h-28 w-full rounded-xl border p-3"
          />
        </label>
        <label className="flex min-h-11 items-center gap-2 text-xs">
          <Checkbox
            checked={archived}
            disabled={pending}
            onChange={(e) => setArchived(e.target.checked)}
          />
          Archived · keep prior applications
        </label>
        <button
          disabled={pending}
          className="min-h-11 rounded-full border px-4 text-xs"
        >
          Save template
        </button>
      </form>
      {status && (
        <p role="status" className="mt-3 text-xs">
          {status}
        </p>
      )}
    </section>
  );
}
