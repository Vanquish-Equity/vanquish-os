"use client";
import { useState, useEffect, useTransition, startTransition } from "react";
import SelectMenu from "@/components/SelectMenu";
import Checkbox from "@/components/Checkbox";
import { loadTemplates, applyTemplate } from "@/lib/customization/actions";
import type { Template } from "@/lib/customization/spec";
export default function ApplyTemplate({
  company,
  deal = null,
}: {
  company: string;
  deal?: string | null;
}) {
  const [rows, setRows] = useState<Template[] | null>(null),
    [cards, setCards] = useState<{ id: string; title: string }[]>([]),
    [selected, setSelected] = useState(""),
    [card, setCard] = useState(""),
    [repeat, setRepeat] = useState(false),
    [request, setRequest] = useState(() => crypto.randomUUID()),
    [status, setStatus] = useState(""),
    [pending, run] = useTransition();
  useEffect(() => {
    let live = true;
    startTransition(async () => {
      const r = await loadTemplates(false, company);
      if (live && r.ok) {
        setRows(r.templates);
        setCards(r.cards);
      }
    });
    return () => {
      live = false;
    };
  }, [company]);
  if (!rows) return null;
  const t = rows.find((t) => t.id === selected);
  return (
    <section
      aria-label="Apply task template"
      className="vq-card-static min-w-0 rounded-[14px] bg-white p-5 motion-reduce:[&_*]:transition-none"
    >
      <h2 className="text-sm font-semibold">Apply a task/checklist template</h2>
      <p className="my-2 text-xs text-neutral-500">
        Manual, atomic and idempotent. This never changes Deal stage. An
        existing stage rule can create a similar task independently.
      </p>
      {!rows.length ? (
        <p className="text-xs">No active templates.</p>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!t) return;
            const target =
              cards.find((c) => c.id === card)?.title ?? "No checklist card";
            if (
              !window.confirm(
                `Apply ${t.name} to this ${deal ? "Deal" : "Company"}?\nTasks (${t.task_titles.length}): ${t.task_titles.join("; ")}\nChecklist (${t.checklist_titles.length}) on ${target}: ${t.checklist_titles.join("; ")}\n${repeat ? "Create another confirmed batch." : "Skip if already applied."}\nDeal stage remains unchanged.`,
              )
            )
              return;
            run(async () => {
              const r = await applyTemplate({
                template: t.id,
                version: t.version,
                company,
                deal,
                card: card || null,
                request,
                repeat,
                confirmed: true,
              });
              setStatus(
                r.ok
                  ? r.alreadyApplied
                    ? "Already applied; nothing duplicated."
                    : "Template applied atomically. Refresh Tasks or the board to see the new items."
                  : r.message,
              );
              if (r.ok) setRequest(crypto.randomUUID());
            });
          }}
        >
          <label
            htmlFor={"apply-template-" + company}
            className="block text-xs"
          >
            Template
          </label>
          <SelectMenu
            id={"apply-template-" + company}
            value={selected}
            disabled={pending}
            placeholder="Choose template"
            options={rows.map((t) => ({ value: t.id, label: t.name }))}
            onChange={(id) => {
              setSelected(id);
              setRequest(crypto.randomUUID());
            }}
            buttonClassName="min-h-11"
          />
          <label htmlFor={"apply-card-" + company} className="block text-xs">
            First 50 authorized Company-linked board cards · required for
            checklist items
          </label>
          <SelectMenu
            id={"apply-card-" + company}
            value={card}
            disabled={pending}
            options={[
              { value: "", label: "No checklist card" },
              ...cards.map((c) => ({ value: c.id, label: c.title })),
            ]}
            onChange={(id) => {
              setCard(id);
              setRequest(crypto.randomUUID());
            }}
            buttonClassName="min-h-11"
          />
          {t && (
            <p className="text-xs">
              {t.task_titles.length} tasks · {t.checklist_titles.length}{" "}
              checklist items · titles are defined by admin.
            </p>
          )}
          <label className="flex min-h-11 items-center gap-2 text-xs">
            <Checkbox
              checked={repeat}
              disabled={pending}
              onChange={(e) => {
                setRepeat(e.target.checked);
                setRequest(crypto.randomUUID());
              }}
            />
            Allow another batch after explicit confirmation (maximum 10)
          </label>
          <button
            className="min-h-11 rounded-full border px-4 text-xs"
            disabled={
              pending || !t || Boolean(t.checklist_titles.length && !card)
            }
          >
            Review and apply template
          </button>
        </form>
      )}
      {status && (
        <p role="status" className="mt-3 text-xs">
          {status}
        </p>
      )}
    </section>
  );
}
