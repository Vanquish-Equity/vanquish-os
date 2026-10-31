"use client";
// Grouped / board layout. Only mounted when the Kanban capability is on and the
// applied view groups by a custom field; with the capability off nothing here
// renders. Behavior is unchanged from the earlier panel: four columns per page,
// 25 rows per column, and a confirmed move that only edits the custom field.
import { useState, useTransition, startTransition, useEffect } from "react";
import Link from "next/link";
import SelectMenu from "@/components/SelectMenu";
import { viewData, moveCard } from "@/lib/customization/actions";
import type {
  Definition,
  RecordRow,
  ViewData,
  ViewObject,
} from "@/lib/customization/spec";

const T = {
  loadError: "We couldn't load this board. Try again.",
  moveTo: "Move to",
  noValue: "No value",
  move: "Move",
  confirm: (name: string, field: string, to: string) =>
    `Move ${name}: set ${field} to ${to}? Only this field changes.`,
  previous: "Previous columns",
  next: "Next columns",
  empty: "Nothing here.",
  partial: "Showing the first 25 here.",
  fieldGone: "A custom field is no longer available, so it was left out.",
};

function Move({
  row,
  view,
  definition,
  reload,
}: {
  row: RecordRow;
  view: string;
  definition: Definition;
  reload: () => Promise<void>;
}) {
  const [selected, setSelected] = useState(
    row.field_value == null ? "" : String(row.field_value),
  );
  const [pending, run] = useTransition();
  const [status, setStatus] = useState("");
  return (
    <form
      className="mt-3 space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        const label =
          definition.options.find((o) => o.id === selected)?.label ?? T.noValue;
        if (!window.confirm(T.confirm(row.name, definition.name, label)))
          return;
        run(async () => {
          const r = await moveCard({
            view,
            record: row.id,
            option: selected || null,
            version: definition.version,
            token: row.token,
            confirmed: true,
          });
          if (!r.ok) {
            setStatus(T.loadError);
            return;
          }
          await reload();
        });
      }}
    >
      <label className="block text-[11.5px]" htmlFor={"move-" + row.id}>
        {T.moveTo}
      </label>
      <SelectMenu
        id={"move-" + row.id}
        value={selected}
        disabled={pending}
        options={[
          { value: "", label: T.noValue },
          ...definition.options.map((o) => ({ value: o.id, label: o.label })),
        ]}
        onChange={setSelected}
        buttonClassName="min-h-11"
      />
      <button
        disabled={pending}
        className="min-h-11 rounded-full border border-neutral-200 px-4 text-[12px] font-semibold hover:border-cyan-400 disabled:opacity-40"
      >
        {T.move}
      </button>
      {status && (
        <p role="status" className="text-[11.5px]">
          {status}
        </p>
      )}
    </form>
  );
}

export default function ViewsKanban({
  kind,
  viewId,
  first,
  reload,
}: {
  kind: ViewObject;
  viewId: string;
  first: ViewData;
  reload: () => Promise<void>;
}) {
  const [datasets, setDatasets] = useState<ViewData[]>([first]),
    [page, setPage] = useState(0),
    [status, setStatus] = useState(""),
    [pending, run] = useTransition();
  useEffect(() => {
    let live = true;
    startTransition(async () => {
      const options = first.definition?.options.slice(0, 3).map((o) => o.id);
      if (!first.spec.group || !options?.length) {
        if (live) setDatasets([first]);
        return;
      }
      const rest = await viewData(viewId, options);
      if (!live) return;
      setPage(0);
      if (!rest.ok) {
        setDatasets([first]);
        setStatus(T.loadError);
        return;
      }
      setDatasets([first, ...rest.data]);
    });
    return () => {
      live = false;
    };
  }, [first, viewId]);
  const definition = datasets[0]?.definition;
  async function columnPage(next: number) {
    if (!definition) return;
    const buckets = [null, ...definition.options.map((o) => o.id)].slice(
      next * 4,
      next * 4 + 4,
    );
    const r = await viewData(viewId, buckets);
    if (!r.ok) {
      setStatus(T.loadError);
      return;
    }
    setDatasets(r.data[0].spec.group ? r.data : [r.data[0]]);
    setPage(next);
  }
  return (
    <div className="flex flex-col gap-3">
      {datasets[0]?.warning && (
        <p role="status" className="text-[11.5px] text-neutral-500">
          {T.fieldGone}
        </p>
      )}
      {status && (
        <p role="status" className="text-[12px]">
          {status}
        </p>
      )}
      {definition && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            className="min-h-11 rounded-full border border-neutral-200 px-4 text-[12px] font-semibold hover:border-cyan-400 disabled:opacity-40"
            disabled={pending || page === 0}
            onClick={() => run(() => columnPage(page - 1))}
          >
            {T.previous}
          </button>
          <button
            className="min-h-11 rounded-full border border-neutral-200 px-4 text-[12px] font-semibold hover:border-cyan-400 disabled:opacity-40"
            disabled={
              pending || (page + 1) * 4 >= definition.options.length + 1
            }
            onClick={() => run(() => columnPage(page + 1))}
          >
            {T.next}
          </button>
        </div>
      )}
      <div className="grid min-w-0 gap-3 md:grid-cols-2">
        {datasets.map((data, index) => (
          <section className="min-w-0" key={index}>
            <h3 className="mb-2 text-[13px] font-semibold">
              {
                [
                  T.noValue,
                  ...(data.definition?.options.map((o) => o.label) ?? []),
                ][page * 4 + index]
              }
            </h3>
            {data.partial && (
              <p className="mb-2 text-[11.5px] text-neutral-500">{T.partial}</p>
            )}
            {!data.rows.length && (
              <p className="text-[11.5px] text-neutral-500">{T.empty}</p>
            )}
            <div className="space-y-3">
              {data.rows.map((row) => (
                <article
                  key={row.id}
                  className="vq-card-static rounded-[14px] bg-white p-3"
                >
                  {kind === "pipeline" && row.company_id ? (
                    <Link
                      className="block min-h-11 text-[13px] font-semibold hover:text-cyan-700"
                      href={`/companies/${row.company_id}/deals/${row.id}`}
                    >
                      {row.name}
                    </Link>
                  ) : (
                    <p className="min-h-11 text-[13px] font-semibold">
                      {row.name}
                    </p>
                  )}
                  {data.definition && data.spec.mode === "kanban" && (
                    <Move
                      key={row.id + ":" + row.token}
                      row={row}
                      view={viewId}
                      definition={data.definition}
                      reload={reload}
                    />
                  )}
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
