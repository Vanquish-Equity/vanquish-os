"use client";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
  startTransition,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { useRouter } from "next/navigation";
import SelectMenu from "@/components/SelectMenu";
import Checkbox from "@/components/Checkbox";
import { deleteViewAction } from "@/lib/views/actions";
import {
  loadViews,
  saveView,
  viewData,
  type LegacyView,
} from "@/lib/customization/actions";
import {
  builtins,
  parseSpec,
  type Definition,
  type Spec,
  type ViewData,
  type ViewObject,
  type ViewRow,
} from "@/lib/customization/spec";
import {
  MAX_COLUMNS,
  columnLabel,
  customColumn,
  defaultSpec,
  isCustom,
  nextSort,
  sameSpec,
  sortRows,
  toggleColumn as toggleColumnSafe,
} from "@/lib/customization/view-helpers";
import Popover, { Chevron, pillClass } from "./Popover";
import ViewsTable, { cellValue } from "./ViewsTable";
import ViewsKanban from "./ViewsKanban";

// Every visible word lives here so the whole screen can be translated in one place.
const T = {
  region: "Views",
  viewLabel: "View:",
  columns: "Columns",
  saveView: "Save view",
  saveChanges: "Save changes",
  options: "More",
  optionsLabel: "View options",
  all: { people: "All people", pipeline: "All deals" },
  myViews: "My views",
  teamViews: "Shared with the team",
  sharedTag: "Shared",
  noViews: "No views yet. Arrange the list and press Save view.",
  columnsHint: "Choose your columns, then press Save view to see the list.",
  alwaysShown: "Always shown",
  onlyOneCustom: "Only one custom field per view for now",
  maxColumns: `You can show up to ${MAX_COLUMNS} columns.`,
  advanced: "Advanced",
  groupBy: "Group by",
  layout: "Layout",
  none: "None",
  layoutList: "List",
  layoutBoard: "Board",
  name: "Name",
  share: "Share with the team",
  shareHelp: "Everyone on the team can use this view. Nobody else can edit it.",
  save: "Save",
  saving: "Saving…",
  saved: "View saved.",
  updated: "View updated.",
  deleted: "View deleted.",
  renamed: "View renamed.",
  nameRequired: "Give your view a name.",
  duplicate: "You already have a view with that name.",
  limit: "You have 50 views. Delete one to save another.",
  tryAgain: "Something went wrong. Please try again.",
  loading: "Loading…",
  loadError: "We couldn't load this view.",
  retry: "Try again",
  layoutOff: "This view uses a layout that isn't available right now.",
  rename: "Rename",
  deleteView: "Delete this view",
  deleteAsk: (name: string) =>
    `Delete “${name}”? Your people and deals are not affected.`,
  deleteYes: "Delete",
  keep: "Keep it",
};

// Keyboard help inside a list of buttons: arrows, Home and End move focus.
function arrowKeys(event: KeyboardEvent<HTMLElement>) {
  const items = [
    ...event.currentTarget.querySelectorAll<HTMLElement>("[data-item]"),
  ];
  if (!items.length) return;
  const at = items.indexOf(document.activeElement as HTMLElement);
  let next = -1;
  if (event.key === "ArrowDown") next = (at + 1) % items.length;
  if (event.key === "ArrowUp") next = (at - 1 + items.length) % items.length;
  if (event.key === "Home") next = 0;
  if (event.key === "End") next = items.length - 1;
  if (next >= 0) {
    event.preventDefault();
    items[next].focus();
  }
}

const itemClass = (current: boolean) =>
  `flex min-h-11 w-full items-center justify-between gap-2 rounded-[9px] px-2.5 py-2 text-left text-[12.5px] transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400 ${
    current
      ? "bg-[#f0fafb] font-semibold text-cyan-800"
      : "text-neutral-700 hover:bg-neutral-50"
  }`;

function ViewMenu({
  kind,
  label,
  selected,
  views,
  legacy,
  me,
  disabled,
  onPick,
  onPickLegacy,
}: {
  kind: ViewObject;
  label: string;
  selected: string;
  views: ViewRow[];
  legacy: LegacyView[];
  me: string;
  disabled: boolean;
  onPick: (id: string) => void;
  onPickLegacy: (view: LegacyView) => void;
}) {
  const mine = views.filter((v) => v.owner === me),
    mineOld = legacy.filter((v) => v.owner === me),
    team = views.filter((v) => v.owner !== me),
    teamOld = legacy.filter((v) => v.owner !== me);
  const none = !views.length && !legacy.length;
  return (
    <Popover
      label={T.viewLabel}
      disabled={disabled}
      onKeyDown={arrowKeys}
      panelClassName="sm:w-72"
      trigger={
        <>
          <span className="font-normal text-neutral-500">{T.viewLabel}</span>
          <span className="max-w-[12rem] truncate">{label}</span>
          <Chevron />
        </>
      }
    >
      {({ close }) => (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            data-item
            aria-current={selected === "" ? "true" : undefined}
            onClick={() => {
              onPick("");
              close();
            }}
            className={itemClass(selected === "")}
          >
            {T.all[kind]}
          </button>
          {[
            [T.myViews, mine, mineOld],
            [T.teamViews, team, teamOld],
          ].map(([heading, v1, v0]) =>
            (v1 as ViewRow[]).length + (v0 as LegacyView[]).length ? (
              <div
                key={heading as string}
                role="group"
                aria-label={heading as string}
              >
                <p className="px-2.5 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400">
                  {heading as string}
                </p>
                {(v1 as ViewRow[]).map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    data-item
                    aria-current={selected === v.id ? "true" : undefined}
                    onClick={() => {
                      onPick(v.id);
                      close();
                    }}
                    className={itemClass(selected === v.id)}
                  >
                    <span className="truncate">{v.name}</span>
                    {v.is_shared && v.owner === me && (
                      <span className="text-[10.5px] font-normal text-neutral-400">
                        {T.sharedTag}
                      </span>
                    )}
                  </button>
                ))}
                {(v0 as LegacyView[]).map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    data-item
                    onClick={() => {
                      onPickLegacy(v);
                      close();
                    }}
                    className={itemClass(false)}
                  >
                    <span className="truncate">{v.name}</span>
                  </button>
                ))}
              </div>
            ) : null,
          )}
          {none && (
            <p className="px-2.5 pb-1 text-[11.5px] text-neutral-500">
              {T.noViews}
            </p>
          )}
        </div>
      )}
    </Popover>
  );
}

export function ColumnsContent({
  kind,
  spec,
  fields,
  kanban,
  applied,
  onChange,
}: {
  kind: ViewObject;
  spec: Spec;
  fields: Omit<Definition, "options">[];
  kanban: boolean;
  applied: boolean;
  onChange: (next: Spec) => void;
}) {
  const [message, setMessage] = useState("");
  const custom = customColumn(spec.columns);
  function toggle(key: string, on: boolean) {
    setMessage("");
    const next = toggleColumnSafe(spec, key, on);
    if (!next.ok) {
      setMessage(next.reason === "max" ? T.maxColumns : T.onlyOneCustom);
      return;
    }
    onChange(next.spec);
  }
  const single = fields.filter((f) => f.field_type === "single_select");
  return (
    <div className="flex flex-col">
      <fieldset>
        <legend className="sr-only">{T.columns}</legend>
        {builtins(kind).map((k) => (
          <label
            key={k}
            className="flex min-h-11 items-center gap-2.5 text-[12.5px]"
          >
            <Checkbox
              checked={spec.columns.includes(k)}
              disabled={k === "name"}
              onChange={(e) => toggle(k, e.target.checked)}
            />
            <span>{columnLabel(k)}</span>
            {k === "name" && (
              <span className="text-[10.5px] text-neutral-400">
                {T.alwaysShown}
              </span>
            )}
          </label>
        ))}
        {fields.map((f) => {
          const key = "cf:" + f.id,
            blocked = !!custom && custom !== key;
          return (
            <label
              key={f.id}
              className={`flex min-h-11 items-center gap-2.5 text-[12.5px] ${blocked ? "text-neutral-400" : ""}`}
            >
              <Checkbox
                checked={spec.columns.includes(key)}
                disabled={blocked}
                onChange={(e) => toggle(key, e.target.checked)}
              />
              <span className="min-w-0">
                <span className="block truncate">{f.name}</span>
                {blocked && (
                  <span className="block text-[10.5px]">{T.onlyOneCustom}</span>
                )}
              </span>
            </label>
          );
        })}
      </fieldset>
      {message && (
        <p role="status" className="pb-1 text-[11.5px] text-neutral-600">
          {message}
        </p>
      )}
      {!applied && (
        <p className="pt-1 text-[11.5px] text-neutral-500">{T.columnsHint}</p>
      )}
      {kanban && single.length > 0 && (
        <details className="mt-2 border-t border-neutral-100 pt-2">
          <summary className="flex min-h-11 cursor-pointer items-center text-[12px] font-semibold text-neutral-600">
            {T.advanced}
          </summary>
          <div className="flex flex-col gap-2 pb-1">
            <span className="text-[11.5px]">{T.groupBy}</span>
            <SelectMenu
              value={spec.group ?? ""}
              options={[
                { value: "", label: T.none },
                ...single.map((f) => ({
                  value: "cf:" + f.id,
                  label: f.name,
                })),
              ]}
              onChange={(group) => {
                if (!group)
                  return onChange({ ...spec, group: null, mode: "table" });
                const rest = spec.columns.filter((c) => !isCustom(c));
                onChange({
                  ...spec,
                  columns: [...rest, group],
                  sort: isCustom(spec.sort.key)
                    ? { key: "name", direction: "asc" }
                    : spec.sort,
                  group,
                });
              }}
              buttonClassName="min-h-11"
            />
            <span className="text-[11.5px]">{T.layout}</span>
            <SelectMenu
              value={spec.mode}
              options={[
                { value: "table", label: T.layoutList },
                ...(spec.group
                  ? [{ value: "kanban", label: T.layoutBoard }]
                  : []),
              ]}
              onChange={(mode) =>
                onChange({ ...spec, mode: mode as Spec["mode"] })
              }
              buttonClassName="min-h-11"
            />
          </div>
        </details>
      )}
    </div>
  );
}

function ColumnsPopover(props: Parameters<typeof ColumnsContent>[0]) {
  return (
    <Popover label={T.columns} trigger={T.columns} panelClassName="sm:w-72">
      {() => <ColumnsContent {...props} />}
    </Popover>
  );
}

// One field, one button. Saves what the list shows now (columns and order).
export function SaveForm({
  blocked,
  onSubmit,
  onDone,
}: {
  blocked: boolean;
  onSubmit: (input: {
    name: string;
    shared: boolean;
  }) => Promise<string | null>;
  onDone: () => void;
}) {
  const id = useId();
  const [name, setName] = useState(""),
    [shared, setShared] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError(T.nameRequired);
    setBusy(true);
    setError("");
    const problem = await onSubmit({ name: name.trim(), shared });
    setBusy(false);
    if (problem) return setError(problem);
    onDone();
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label htmlFor={id} className="text-[11.5px] font-semibold">
          {T.name}
        </label>
        <input
          id={id}
          value={name}
          maxLength={80}
          autoComplete="off"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? id + "-error" : undefined}
          onChange={(e) => setName(e.target.value)}
          className="min-h-11 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm focus:outline-cyan-400"
        />
      </div>
      <div>
        <label className="flex min-h-11 items-center gap-2.5 text-[12.5px]">
          <Checkbox
            checked={shared}
            onChange={(e) => setShared(e.target.checked)}
          />
          {T.share}
        </label>
        <p className="text-[11.5px] text-neutral-500">{T.shareHelp}</p>
      </div>
      {blocked && <p className="text-[11.5px] text-neutral-600">{T.limit}</p>}
      {error && (
        <p
          id={id + "-error"}
          role="alert"
          className="text-[11.5px] text-red-700"
        >
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={busy || blocked}
        className={`${pillClass} justify-center`}
      >
        {busy ? T.saving : T.save}
      </button>
    </form>
  );
}

// Rename and delete for the person's own view; delete asks inline first.
function OptionsForm({
  name,
  onRename,
  onDelete,
  onDone,
}: {
  name: string;
  onRename: (name: string) => Promise<string | null>;
  onDelete: () => Promise<string | null>;
  onDone: () => void;
}) {
  const id = useId();
  const [value, setValue] = useState(name),
    [asking, setAsking] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function rename(e: FormEvent) {
    e.preventDefault();
    if (!value.trim()) return setError(T.nameRequired);
    setBusy(true);
    const problem = await onRename(value.trim());
    setBusy(false);
    if (problem) return setError(problem);
    onDone();
  }
  async function remove() {
    setBusy(true);
    const problem = await onDelete();
    setBusy(false);
    if (problem) return setError(problem);
    onDone();
  }
  return (
    <div className="flex flex-col gap-3">
      <form onSubmit={rename} className="flex flex-col gap-1">
        <label htmlFor={id} className="text-[11.5px] font-semibold">
          {T.rename}
        </label>
        <div className="flex gap-2">
          <input
            id={id}
            value={value}
            maxLength={80}
            autoComplete="off"
            onChange={(e) => setValue(e.target.value)}
            className="min-h-11 min-w-0 flex-1 rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm focus:outline-cyan-400"
          />
          <button type="submit" disabled={busy} className={pillClass}>
            {T.save}
          </button>
        </div>
      </form>
      {asking ? (
        <div className="flex flex-col gap-2 border-t border-neutral-100 pt-3">
          <p className="text-[12px]">{T.deleteAsk(name)}</p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={remove}
              className={`${pillClass} border-red-200 text-red-700 hover:border-red-400`}
            >
              {T.deleteYes}
            </button>
            <button
              type="button"
              onClick={() => setAsking(false)}
              className={pillClass}
            >
              {T.keep}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAsking(true)}
          className={`${pillClass} justify-center`}
        >
          {T.deleteView}
        </button>
      )}
      {error && (
        <p role="alert" className="text-[11.5px] text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

export type Catalog = {
  views: ViewRow[];
  fields: Omit<Definition, "options">[];
  me: string;
  legacy: LegacyView[];
  limited: boolean;
};

export default function ViewsPanel({
  kind,
  kanban,
  initialCatalog,
}: {
  kind: ViewObject;
  kanban: boolean;
  // Only for tests and previews: skips the first load.
  initialCatalog?: Catalog;
}) {
  const router = useRouter();
  const [catalog, setCatalog] = useState<Catalog | null>(
      initialCatalog ?? null,
    ),
    [selected, setSelected] = useState(""),
    [legacyName, setLegacyName] = useState(""),
    [spec, setSpec] = useState<Spec>(() => defaultSpec(kind)),
    [data, setData] = useState<ViewData | null>(null),
    [phase, setPhase] = useState<"idle" | "loading" | "error">("idle"),
    [notice, setNotice] = useState(""),
    [, run] = useTransition();
  const seq = useRef(0);

  const refresh = useCallback(async () => {
    const r = await loadViews(kind);
    if (!r.ok) return null;
    const next: Catalog = {
      views: r.views,
      fields: r.fields,
      me: r.me,
      legacy: r.legacy,
      limited: r.limited,
    };
    setCatalog(next);
    return next;
  }, [kind]);

  useEffect(() => {
    if (initialCatalog) return;
    startTransition(async () => {
      await refresh();
    });
  }, [refresh, initialCatalog]);

  const load = useCallback(async (id: string) => {
    const mine = ++seq.current;
    setPhase("loading");
    setData(null);
    const r = await viewData(id, [null]);
    if (mine !== seq.current) return;
    if (!r.ok) return setPhase("error");
    setData(r.data[0]);
    if (r.data[0].warning) setSpec(r.data[0].spec);
    setPhase("idle");
  }, []);

  const applied = useMemo(
    () => catalog?.views.find((v) => v.id === selected),
    [catalog, selected],
  );
  if (!catalog) return null;
  const { views, fields, me, legacy } = catalog;
  const own = !!applied && applied.owner === me;
  const dirty = !!applied && !sameSpec(spec, applied.filters);
  const active = !!selected && phase !== "error";
  const field = fields.find((f) => "cf:" + f.id === customColumn(spec.columns));
  const workCf = customColumn(spec.columns),
    dataCf = data ? customColumn(data.spec.columns) : undefined;
  const label = applied?.name || legacyName || T.all[kind];

  function choose(id: string) {
    setNotice("");
    setLegacyName("");
    setSelected(id);
    const v = views.find((x) => x.id === id);
    setSpec(v ? v.filters : defaultSpec(kind));
    setData(null);
    setPhase("idle");
    seq.current++;
    if (id) run(() => load(id));
  }
  function chooseLegacy(v: LegacyView) {
    choose("");
    setLegacyName(v.name);
    router.push(v.href);
  }
  async function create(input: { name: string; shared: boolean }) {
    if (
      views.some(
        (v) =>
          v.owner === me &&
          v.name.trim().toLowerCase() === input.name.trim().toLowerCase(),
      )
    )
      return T.duplicate;
    try {
      parseSpec(kind, spec);
    } catch {
      return T.tryAgain;
    }
    const r = await saveView({
      id: null,
      kind,
      shared: input.shared,
      name: input.name,
      spec,
    });
    if (!r.ok) return "reason" in r ? r.message : T.tryAgain;
    const next = await refresh();
    setNotice(T.saved);
    const created =
      r.id ??
      next?.views.find((v) => v.owner === me && v.name === input.name.trim())
        ?.id;
    if (created) {
      setSelected(created);
      setLegacyName("");
      run(() => load(created));
    }
    return null;
  }
  async function update() {
    if (!applied) return;
    setNotice("");
    const r = await saveView({
      id: applied.id,
      kind,
      name: applied.name,
      shared: applied.is_shared,
      spec,
    });
    if (!r.ok) return setNotice(T.tryAgain);
    await refresh();
    setNotice(T.updated);
    run(() => load(applied.id));
  }
  async function rename(name: string) {
    if (!applied) return T.tryAgain;
    if (
      views.some(
        (v) =>
          v.id !== applied.id &&
          v.owner === me &&
          v.name.trim().toLowerCase() === name.toLowerCase(),
      )
    )
      return T.duplicate;
    const r = await saveView({
      id: applied.id,
      kind,
      name,
      shared: applied.is_shared,
      spec: applied.filters,
    });
    if (!r.ok) return "reason" in r ? r.message : T.tryAgain;
    await refresh();
    setNotice(T.renamed);
    return null;
  }
  async function remove() {
    if (!applied) return T.tryAgain;
    const r = await deleteViewAction(applied.id, kind);
    if (!r.ok) return T.tryAgain;
    await refresh();
    choose("");
    setNotice(T.deleted);
    return null;
  }

  const showBoard = !!data && !!data.spec.group;
  const rows =
    data && !showBoard
      ? data.spec.sort.key === spec.sort.key &&
        data.spec.sort.direction === spec.sort.direction
        ? data.rows
        : sortRows(data.rows, spec.sort, (r, k) =>
            cellValue(r, k, data.definition),
          )
      : [];
  const sortedLocally =
    !!data &&
    data.partial &&
    (data.spec.sort.key !== spec.sort.key ||
      data.spec.sort.direction !== spec.sort.direction);

  return (
    <section
      aria-label={T.region}
      data-vq-views=""
      data-active={active ? "true" : "false"}
      // While a view is applied its list stands in for the page's own list and
      // filters, so everything after this section is hidden (not removed).
      className={`flex flex-col gap-3 motion-reduce:[&_*]:transition-none ${active ? "[&~*]:hidden" : ""}`}
    >
      <div className="relative flex flex-wrap items-center gap-2">
        <ViewMenu
          kind={kind}
          label={label}
          selected={selected}
          views={views}
          legacy={legacy}
          me={me}
          disabled={false}
          onPick={choose}
          onPickLegacy={chooseLegacy}
        />
        <ColumnsPopover
          kind={kind}
          spec={spec}
          fields={fields}
          kanban={kanban}
          applied={!!applied}
          onChange={(next) => {
            setNotice("");
            setSpec(next);
          }}
        />
        <Popover
          label={T.saveView}
          trigger={T.saveView}
          panelClassName="sm:w-72"
        >
          {({ close }) => (
            <SaveForm
              blocked={catalog.limited}
              onSubmit={create}
              onDone={close}
            />
          )}
        </Popover>
        {own && dirty && (
          <button
            type="button"
            onClick={() => run(update)}
            className={pillClass}
          >
            {T.saveChanges}
          </button>
        )}
        {own && applied && (
          <Popover
            label={T.optionsLabel}
            triggerAriaLabel={T.optionsLabel}
            trigger={<span aria-hidden="true">⋯</span>}
            panelClassName="sm:w-72"
          >
            {({ close }) => (
              <OptionsForm
                key={applied.id}
                name={applied.name}
                onRename={rename}
                onDelete={remove}
                onDone={close}
              />
            )}
          </Popover>
        )}
        {notice && (
          <p role="status" className="text-[12px] text-neutral-600">
            {notice}
          </p>
        )}
      </div>
      {selected && phase === "loading" && (
        <div
          role="status"
          className="vq-card-static rounded-[14px] bg-white px-4 py-6 text-[12.5px] text-neutral-500"
        >
          <span className="motion-safe:animate-pulse">{T.loading}</span>
        </div>
      )}
      {selected && phase === "error" && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 text-[12.5px]"
        >
          <span>{T.loadError}</span>
          <button
            type="button"
            className={pillClass}
            onClick={() => run(() => load(selected))}
          >
            {T.retry}
          </button>
        </div>
      )}
      {data && showBoard && !kanban && (
        <p role="status" className="text-[12.5px] text-neutral-600">
          {T.layoutOff}
        </p>
      )}
      {data && showBoard && kanban && (
        <ViewsKanban
          kind={kind}
          viewId={selected}
          first={data}
          reload={() => load(selected)}
        />
      )}
      {data && !showBoard && (
        <ViewsTable
          kind={kind}
          columns={spec.columns}
          sort={spec.sort}
          rows={rows}
          definition={data.definition}
          partial={data.partial}
          warning={data.warning}
          pendingField={!!workCf && workCf !== dataCf}
          sortedLocally={sortedLocally}
          fieldName={field?.name ?? null}
          onSort={(key) => {
            setNotice("");
            setSpec((s) => ({ ...s, sort: nextSort(s.sort, key) }));
          }}
        />
      )}
    </section>
  );
}
