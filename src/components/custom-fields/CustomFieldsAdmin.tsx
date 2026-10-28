"use client";
import { useEffect, useState, startTransition, useTransition } from "react";
import SelectMenu from "@/components/SelectMenu";
import Checkbox from "@/components/Checkbox";
import {
  loadFieldSchema,
  saveFieldDefinition,
  saveFieldOption,
} from "@/lib/custom-fields/actions";
import {
  OBJECTS,
  TYPES,
  type FieldObject,
  type FieldDefinition,
  type FieldOption,
  type FieldType,
} from "@/lib/custom-fields/model";
const field =
  "min-h-11 w-full min-w-0 rounded-xl border border-neutral-200 px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-cyan-300";
function OptionForm({
  definition,
  option,
  onReload,
}: {
  definition: FieldDefinition;
  option?: FieldOption;
  onReload: () => Promise<void>;
}) {
  const [label, setLabel] = useState(option?.label ?? ""),
    [order, setOrder] = useState(option?.sort_order ?? 0),
    [pending, run] = useTransition(),
    [status, setStatus] = useState("");
  return (
    <form
      className="mt-3 flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(async () => {
          const r = await saveFieldOption({
            id: option?.id ?? null,
            definitionId: definition.id,
            label,
            order,
            version: option?.version ?? 0,
          });
          if (!r.ok) setStatus(r.message);
          else {
            setLabel("");
            await onReload();
          }
        });
      }}
    >
      <label className="min-w-0 flex-1 text-xs">
        {option ? "Rename option" : "New option"}
        <input
          className={field}
          value={label}
          maxLength={80}
          disabled={pending || definition.archived}
          required
          onChange={(e) => setLabel(e.target.value)}
        />
      </label>
      <label className="w-24 text-xs">
        Order
        <input
          className={field}
          type="number"
          min={0}
          max={999}
          value={order}
          disabled={pending || definition.archived}
          onChange={(e) => setOrder(Number(e.target.value))}
        />
      </label>
      <button
        disabled={pending || definition.archived}
        className="min-h-11 rounded-full border px-4 text-xs"
      >
        {option ? "Save option name" : "Add option"}
      </button>
      {status && (
        <p role="status" className="basis-full text-xs">
          {status}
        </p>
      )}
    </form>
  );
}
function DefinitionForm({
  object,
  definition,
  onReload,
}: {
  object: FieldObject;
  definition?: FieldDefinition;
  onReload: () => Promise<void>;
}) {
  const [name, setName] = useState(definition?.name ?? ""),
    [type, setType] = useState<FieldType>(definition?.field_type ?? "text"),
    [order, setOrder] = useState(definition?.sort_order ?? 0),
    [archived, setArchived] = useState(definition?.archived ?? false),
    [filterable, setFilterable] = useState(definition?.filterable ?? false),
    [pending, run] = useTransition(),
    [status, setStatus] = useState("");
  return (
    <div className="min-w-0">
      <form
        className="mt-4 space-y-3 border-t pt-4"
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            const r = await saveFieldDefinition({
              id: definition?.id ?? null,
              object,
              name,
              type,
              order,
              archived,
              filterable,
              version: definition?.version ?? 0,
            });
            if (!r.ok) setStatus(r.message);
            else {
              await onReload();
              setName("");
              setStatus("Definition saved.");
            }
          });
        }}
      >
        <label className="block text-xs">
          Shared field name
          <input
            className={field}
            value={name}
            maxLength={80}
            required
            disabled={pending}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label htmlFor="cf-type" className="block text-xs">
          Type (immutable once created)
        </label>
        <SelectMenu
          id="cf-type"
          value={type}
          disabled={pending || !!definition}
          buttonClassName="min-h-11"
          options={TYPES.map((t) => ({ value: t, label: t }))}
          onChange={(v) => setType(v as FieldType)}
        />
        <label className="block text-xs">
          Order
          <input
            className={field}
            type="number"
            min={0}
            max={999}
            value={order}
            disabled={pending}
            onChange={(e) => setOrder(Number(e.target.value))}
          />
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <Checkbox
            checked={filterable}
            disabled={pending}
            onChange={(e) => setFilterable(e.target.checked)}
          />
          Allow bounded filtering (maximum 10 per object)
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <Checkbox
            checked={archived}
            disabled={pending}
            onChange={(e) => setArchived(e.target.checked)}
          />
          Archived — retain values and hide from records
        </label>
        <button
          disabled={pending}
          className="min-h-11 rounded-full bg-ink px-4 text-sm text-white"
        >
          {definition ? "Save definition" : "Create definition"}
        </button>
        {status && (
          <p role="status" className="text-xs">
            {status}
          </p>
        )}
      </form>
      {definition &&
        ["single_select", "multi_select"].includes(definition.field_type) && (
          <div className="mt-4 border-t pt-3">
            <h3 className="text-sm font-semibold">
              Shared options (maximum 50)
            </h3>
            <p className="text-xs text-neutral-500">
              Names can change; stable option IDs preserve selected values. Do
              not put private record data here.
            </p>
            {definition.options.map((o) => (
              <OptionForm
                key={o.id + ":" + o.version}
                definition={definition}
                option={o}
                onReload={onReload}
              />
            ))}
            {definition.options.length < 50 && (
              <OptionForm
                key={"new:" + definition.version}
                definition={definition}
                onReload={onReload}
              />
            )}
          </div>
        )}
    </div>
  );
}
export default function CustomFieldsAdmin() {
  const [object, setObject] = useState<FieldObject>("people"),
    [defs, setDefs] = useState<FieldDefinition[] | null>(null),
    [selected, setSelected] = useState("");
  useEffect(() => {
    let live = true;
    startTransition(async () => {
      const r = await loadFieldSchema(object, true);
      if (live) setDefs(r.ok ? r.definitions : null);
    });
    return () => {
      live = false;
    };
  }, [object]);
  async function reload() {
    const r = await loadFieldSchema(object, true);
    setDefs(r.ok ? r.definitions : null);
  }
  if (!defs) return null;
  const def = defs.find((d) => d.id === selected);
  return (
    <section
      aria-label="Admin custom field definitions"
      className="vq-card-static min-w-0 rounded-[14px] bg-white p-5 motion-reduce:[&_*]:animate-none motion-reduce:[&_*]:transition-none"
    >
      <h2 className="text-[15px] font-semibold">Custom field definitions</h2>
      <p className="my-3 text-xs text-neutral-500">
        Admin only. Shared schema for People, Companies and Deals; Portfolio/LP
        fields are excluded. Maximum 30 definitions per object, including
        archived ones. Fields never change Deal stage.
      </p>
      <label htmlFor="cf-object" className="block text-xs">
        Object
      </label>
      <SelectMenu
        id="cf-object"
        buttonClassName="min-h-11"
        value={object}
        options={OBJECTS.map((o) => ({ value: o, label: o }))}
        onChange={(v) => {
          setDefs(null);
          setObject(v as FieldObject);
          setSelected("");
        }}
      />
      <label htmlFor="cf-definition" className="mt-3 block text-xs">
        Definition
      </label>
      <SelectMenu
        id="cf-definition"
        buttonClassName="min-h-11"
        value={selected}
        options={[
          { value: "", label: "New definition" },
          ...defs.map((d) => ({
            value: d.id,
            label: d.name + (d.archived ? " · archived" : ""),
          })),
        ]}
        onChange={setSelected}
      />
      <DefinitionForm
        key={
          object + ":" + selected + ":" + defs.map((d) => d.version).join(",")
        }
        object={object}
        definition={def}
        onReload={reload}
      />
    </section>
  );
}
