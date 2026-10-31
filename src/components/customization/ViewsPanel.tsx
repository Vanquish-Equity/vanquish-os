"use client";
import { useEffect, useState, useTransition, startTransition } from "react";
import Link from "next/link";
import SelectMenu from "@/components/SelectMenu";
import Checkbox from "@/components/Checkbox";
import { deleteViewAction } from "@/lib/views/actions";
import {
  loadViews,
  saveView,
  viewData,
  moveCard,
} from "@/lib/customization/actions";
import {
  builtins,
  type ViewObject,
  type Spec,
  type ViewRow,
  type Definition,
  type ViewData,
  type RecordRow,
} from "@/lib/customization/spec";
const initial: Spec = {
  version: 1,
  columns: ["name", "company"],
  sort: { key: "name", direction: "asc" },
  group: null,
  mode: "table",
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
          definition.options.find((o) => o.id === selected)?.label ??
          "No value";
        if (
          !window.confirm(
            `Move ${row.name}: set ${definition.name} to ${label}? This changes only this custom field; Deal stage stays unchanged.`,
          )
        )
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
            setStatus(r.message);
            return;
          }
          await reload();
        });
      }}
    >
      <label className="block text-xs" htmlFor={"move-" + row.id}>
        Move by field
      </label>
      <SelectMenu
        id={"move-" + row.id}
        value={selected}
        disabled={pending}
        options={[
          { value: "", label: "No value" },
          ...definition.options.map((o) => ({ value: o.id, label: o.label })),
        ]}
        onChange={setSelected}
        buttonClassName="min-h-11"
      />
      <button
        disabled={pending}
        className="min-h-11 rounded-full border px-3 text-xs"
      >
        Confirm field move
      </button>
      {status && (
        <p role="status" className="text-xs">
          {status}
        </p>
      )}
    </form>
  );
}
export default function ViewsPanel({
  kind,
  kanban,
}: {
  kind: ViewObject;
  kanban: boolean;
}) {
  const [views, setViews] = useState<ViewRow[]>([]),
    [fields, setFields] = useState<Omit<Definition, "options">[]>([]),
    [me, setMe] = useState(""),
    [ready, setReady] = useState(false),
    [selected, setSelected] = useState(""),
    [name, setName] = useState(""),
    [shared, setShared] = useState(false),
    [spec, setSpec] = useState<Spec>(initial),
    [custom, setCustom] = useState(""),
    [datasets, setDatasets] = useState<ViewData[]>([]),
    [page, setPage] = useState(0),
    [status, setStatus] = useState(""),
    [pending, run] = useTransition();
  async function refresh() {
    const r = await loadViews(kind);
    if (r.ok) {
      setViews(r.views);
      setFields(r.fields);
      setMe(r.me);
      setReady(true);
      if (r.limited)
        setStatus(
          "First 50 versioned views. Remove unused owned views through the existing view controls.",
        );
    }
  }
  useEffect(() => {
    let live = true;
    startTransition(async () => {
      const r = await loadViews(kind);
      if (live && r.ok) {
        setViews(r.views);
        setFields(r.fields);
        setMe(r.me);
        setReady(true);
      }
    });
    return () => {
      live = false;
    };
  }, [kind]);
  async function open(id = selected) {
    if (!id) return;
    setDatasets([]);
    setStatus("");
    const first = await viewData(id, [null]);
    if (!first.ok) {
      setStatus(first.message);
      return;
    }
    const base = first.data[0];
    let all = first.data;
    if (base.spec.group && base.definition) {
      const next = base.definition.options.slice(0, 3).map((o) => o.id);
      if (next.length) {
        const rest = await viewData(id, next);
        if (!rest.ok) {
          setStatus(rest.message);
          return;
        }
        all = [base, ...rest.data];
      }
    }
    setPage(0);
    setDatasets(all);
  }
  async function columnPage(next: number) {
    const d = datasets[0]?.definition;
    if (!d) return;
    const buckets = [null, ...d.options.map((o) => o.id)].slice(
      next * 4,
      next * 4 + 4,
    );
    const r = await viewData(selected, buckets);
    if (!r.ok) {
      setStatus(r.message);
      return;
    }
    setDatasets(r.data[0].spec.group ? r.data : [r.data[0]]);
    setPage(next);
  }
  if (!ready) return null;
  const current = views.find((v) => v.id === selected),
    editable = !current || current.owner === me,
    field = fields.find((f) => f.id === custom);
  const columns = [...builtins(kind), ...(field ? ["cf:" + field.id] : [])];
  function chooseField(id: string) {
    setCustom(id);
    setSpec((s) => ({
      ...s,
      columns: s.columns.filter((k) => !k.startsWith("cf:")),
      sort: s.sort.key.startsWith("cf:")
        ? { key: "name", direction: s.sort.direction }
        : s.sort,
      group: null,
      mode: "table",
    }));
  }
  function display(row: RecordRow, key: string, d: Definition | null) {
    if (key.startsWith("cf:"))
      return (
        d?.options.find((o) => o.id === row.field_value)?.label ??
        String(row.field_value ?? "—")
      );
    return String(row[key as keyof RecordRow] ?? "—");
  }
  return (
    <section
      aria-label="Versioned views"
      className="vq-card-static min-w-0 rounded-[14px] bg-white p-5 motion-reduce:[&_*]:transition-none"
    >
      <h2 className="text-sm font-semibold">Versioned views · v1</h2>
      <p className="my-2 text-xs text-neutral-500">
        First 50 versioned views. Existing saved filters remain unchanged. At
        most 100 rows, or 25 per grouped column and four columns per page. No
        hidden totals.
      </p>
      <label htmlFor={"view-" + kind} className="text-xs">
        View
      </label>
      <SelectMenu
        id={"view-" + kind}
        value={selected}
        disabled={pending}
        options={[
          { value: "", label: "New v1 view" },
          ...views.map((v) => ({
            value: v.id,
            label: v.name + (v.owner !== me ? " · shared/read only" : ""),
          })),
        ]}
        onChange={(id) => {
          setSelected(id);
          setDatasets([]);
          setPage(0);
          const v = views.find((v) => v.id === id);
          setName(v?.name ?? "");
          setShared(v?.is_shared ?? false);
          setSpec(v?.filters ?? initial);
          setCustom(
            v?.filters.columns.find((k) => k.startsWith("cf:"))?.slice(3) ??
              v?.filters.group?.slice(3) ??
              "",
          );
        }}
        buttonClassName="min-h-11"
      />
      {selected && editable && (
        <button
          type="button"
          className="my-2 ml-2 min-h-11 rounded-full border px-4 text-xs"
          disabled={pending}
          onClick={() => {
            if (
              !window.confirm(
                `Delete view ${current?.name}? Source records stay unchanged.`,
              )
            )
              return;
            run(async () => {
              const r = await deleteViewAction(selected, kind);
              if (!r.ok) {
                setStatus(r.message);
                return;
              }
              setSelected("");
              setDatasets([]);
              setSpec(initial);
              setName("");
              setCustom("");
              await refresh();
            });
          }}
        >
          Delete owned v1 view
        </button>
      )}
      {selected && (
        <button
          className="my-2 min-h-11 rounded-full border px-4 text-xs"
          disabled={pending}
          onClick={() => run(() => open())}
        >
          Open view
        </button>
      )}
      <details className="my-3">
        <summary className="min-h-11 cursor-pointer py-3 text-sm">
          Columns, order and sharing
        </summary>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              const r = await saveView({
                id: selected || null,
                kind,
                name,
                shared,
                spec,
              });
              setStatus(r.ok ? "View saved." : r.message);
              if (r.ok) await refresh();
            });
          }}
        >
          <label className="block text-xs">
            View name
            <input
              value={name}
              disabled={!editable || pending}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 min-h-11 w-full rounded-xl border px-3"
            />
          </label>
          <label className="flex min-h-11 items-center gap-2 text-xs">
            <Checkbox
              checked={shared}
              disabled={!editable || pending}
              onChange={(e) => setShared(e.target.checked)}
            />
            Shared with active members; source RLS still applies
          </label>
          <label htmlFor={"custom-" + kind} className="block text-xs">
            One custom field (optional)
          </label>
          <SelectMenu
            id={"custom-" + kind}
            value={custom}
            disabled={!editable || pending}
            options={[
              { value: "", label: "No custom field" },
              ...fields.map((f) => ({ value: f.id, label: f.name })),
            ]}
            onChange={chooseField}
            buttonClassName="min-h-11"
          />
          <fieldset className="space-y-1">
            <legend className="text-xs">
              Columns · name is required; maximum 8
            </legend>
            {columns.map((k) => (
              <label
                key={k}
                className="flex min-h-11 items-center gap-2 text-xs"
              >
                <Checkbox
                  checked={spec.columns.includes(k)}
                  disabled={!editable || pending || k === "name"}
                  onChange={(e) =>
                    setSpec((s) => ({
                      ...s,
                      columns: e.target.checked
                        ? [...s.columns, k]
                        : s.columns.filter((c) => c !== k),
                    }))
                  }
                />
                {k.startsWith("cf:") ? field?.name : k}
              </label>
            ))}
          </fieldset>
          <div className="space-y-1">
            {spec.columns.map((k, i) => (
              <div
                key={k}
                className="flex min-h-11 flex-wrap items-center gap-2 text-xs"
              >
                <span className="break-all">
                  {k.startsWith("cf:")
                    ? (field?.name ?? "Unavailable field")
                    : k}
                </span>
                <button
                  type="button"
                  className="min-h-11 rounded-full border px-3"
                  disabled={!editable || pending || i === 0}
                  onClick={() =>
                    setSpec((s) => {
                      const c = [...s.columns];
                      [c[i - 1], c[i]] = [c[i], c[i - 1]];
                      return { ...s, columns: c };
                    })
                  }
                >
                  Earlier
                </button>
                <button
                  type="button"
                  className="min-h-11 rounded-full border px-3"
                  disabled={
                    !editable || pending || i === spec.columns.length - 1
                  }
                  onClick={() =>
                    setSpec((s) => {
                      const c = [...s.columns];
                      [c[i + 1], c[i]] = [c[i], c[i + 1]];
                      return { ...s, columns: c };
                    })
                  }
                >
                  Later
                </button>
              </div>
            ))}
          </div>
          <label htmlFor={"sort-" + kind} className="block text-xs">
            Sort
          </label>
          <SelectMenu
            id={"sort-" + kind}
            value={spec.sort.key}
            disabled={!editable || pending}
            options={columns.map((k) => ({
              value: k,
              label: k.startsWith("cf:") ? (field?.name ?? "Custom field") : k,
            }))}
            onChange={(key) =>
              setSpec((s) => ({ ...s, sort: { ...s.sort, key } }))
            }
            buttonClassName="min-h-11"
          />
          <label htmlFor={"direction-" + kind} className="block text-xs">
            Direction
          </label>
          <SelectMenu
            id={"direction-" + kind}
            value={spec.sort.direction}
            disabled={!editable || pending}
            options={[
              { value: "asc", label: "Ascending" },
              { value: "desc", label: "Descending" },
            ]}
            onChange={(direction) =>
              setSpec((s) => ({
                ...s,
                sort: { ...s.sort, direction: direction as "asc" | "desc" },
              }))
            }
            buttonClassName="min-h-11"
          />
          <label htmlFor={"group-" + kind} className="block text-xs">
            Grouping
          </label>
          <SelectMenu
            id={"group-" + kind}
            value={spec.group ?? ""}
            disabled={!editable || pending}
            options={[
              { value: "", label: "None" },
              ...(field?.field_type === "single_select"
                ? [{ value: "cf:" + field.id, label: field.name }]
                : []),
            ]}
            onChange={(group) =>
              setSpec((s) => ({
                ...s,
                group: group || null,
                mode: group ? s.mode : "table",
              }))
            }
            buttonClassName="min-h-11"
          />
          <label htmlFor={"mode-" + kind} className="block text-xs">
            Layout
          </label>
          <SelectMenu
            id={"mode-" + kind}
            value={spec.mode}
            disabled={!editable || pending}
            options={[
              { value: "table", label: "Table" },
              ...(kanban && spec.group
                ? [{ value: "kanban", label: "Kanban by custom field" }]
                : []),
            ]}
            onChange={(mode) =>
              setSpec((s) => ({ ...s, mode: mode as "table" | "kanban" }))
            }
            buttonClassName="min-h-11"
          />
          <button
            className="min-h-11 rounded-full border px-4 text-xs"
            disabled={!editable || pending}
          >
            Save v1 view
          </button>
        </form>
      </details>
      {status && (
        <p role="status" className="my-3 text-sm">
          {status}
        </p>
      )}
      {datasets[0]?.spec.group && datasets[0]?.definition && (
        <div className="my-3 flex flex-wrap items-center gap-2 text-xs">
          <button
            className="min-h-11 rounded-full border px-3"
            disabled={pending || page === 0}
            onClick={() => run(() => columnPage(page - 1))}
          >
            Previous columns
          </button>
          <span>
            Column page {page + 1} · option catalog, not record counts
          </span>
          <button
            className="min-h-11 rounded-full border px-3"
            disabled={
              pending ||
              (page + 1) * 4 >= datasets[0].definition.options.length + 1
            }
            onClick={() => run(() => columnPage(page + 1))}
          >
            Next columns
          </button>
        </div>
      )}
      <div className="grid min-w-0 gap-3 md:grid-cols-2">
        {datasets.map((data, index) => (
          <section className="min-w-0" key={index}>
            {data.warning && (
              <p role="status" className="my-2 text-xs">
                A field or capability is unavailable. Its column/group was
                omitted; the authorized table remains available.
              </p>
            )}
            {data.spec.group && (
              <h3 className="mb-2 text-sm font-semibold">
                {
                  [
                    "No value",
                    ...(data.definition?.options.map((o) => o.label) ?? []),
                  ][page * 4 + index]
                }
              </h3>
            )}
            {data.partial && (
              <p className="mb-2 text-xs">
                Partial: first {data.spec.group ? 25 : 100} authorized rows.
              </p>
            )}
            {!data.rows.length && (
              <p className="text-xs">No authorized records in this column.</p>
            )}
            {data.spec.mode === "kanban" ? (
              <div className="vq-card-grid space-y-3">
                {data.rows.map((row) => (
                  <article
                    key={row.id}
                    className="vq-card-static rounded-[14px] bg-white p-3"
                  >
                    <Link
                      className="vq-card block min-h-11 rounded-[14px] bg-white p-3 text-sm focus-visible:ring-2 focus-visible:ring-cyan-300"
                      href={
                        kind === "pipeline"
                          ? `/companies/${row.company_id}/deals/${row.id}`
                          : `/people?q=${encodeURIComponent(row.name)}`
                      }
                    >
                      {row.name}
                    </Link>
                    {data.spec.columns
                      .filter((k) => k !== "name")
                      .map((k) => (
                        <p key={k} className="my-1 break-words text-xs">
                          {k.startsWith("cf:") ? data.definition?.name : k}:{" "}
                          {display(row, k, data.definition)}
                        </p>
                      ))}
                    {kanban && data.definition && (
                      <Move
                        key={row.id + ":" + row.token}
                        row={row}
                        view={selected}
                        definition={data.definition}
                        reload={open}
                      />
                    )}
                  </article>
                ))}
              </div>
            ) : (
              <div className="max-w-full overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr>
                      {data.spec.columns.map((k) => (
                        <th key={k} className="p-2">
                          {k.startsWith("cf:") ? data.definition?.name : k}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((row) => (
                      <tr key={row.id}>
                        {data.spec.columns.map((k) => (
                          <td
                            key={k}
                            className="max-w-48 break-words border-t p-2"
                          >
                            {display(row, k, data.definition)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ))}
      </div>
    </section>
  );
}
