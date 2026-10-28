"use client";
import { useState, useEffect, startTransition, useTransition } from "react";
import { loadRecordFields, saveRecordField } from "@/lib/custom-fields/actions";
import type {
  FieldDefinition,
  FieldValue,
  FieldObject,
  RecordFields,
} from "@/lib/custom-fields/model";
import FieldInput from "./FieldInput";
function initial(d: FieldDefinition, v?: FieldValue): unknown {
  if (!v?.is_set)
    return d.field_type === "boolean"
      ? false
      : d.field_type === "multi_select"
        ? []
        : "";
  return (
    v.text_value ??
    v.number_value ??
    v.date_value ??
    v.boolean_value ??
    v.option_value ??
    v.multi_value ??
    ""
  );
}
function EditValue({
  definition,
  stored,
  object,
  recordId,
  editable,
  onReload,
}: {
  definition: FieldDefinition;
  stored?: FieldValue;
  object: FieldObject;
  recordId: string;
  editable: boolean;
  onReload: () => Promise<void>;
}) {
  const [value, setValue] = useState<unknown>(initial(definition, stored)),
    [pending, run] = useTransition(),
    [status, setStatus] = useState("");
  function save(clear = false) {
    run(async () => {
      setStatus("");
      const result = await saveRecordField({
        object,
        recordId,
        definitionId: definition.id,
        version: definition.version,
        token: stored?.token ?? null,
        value,
        clear,
      });
      if (!result.ok) {
        setStatus(result.message);
        await onReload();
        return;
      }
      await onReload();
      setStatus(clear ? "Value cleared." : "Value saved.");
    });
  }
  return (
    <form
      className="min-w-0 space-y-2 border-t border-neutral-100 py-4"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <label
        htmlFor={"cf-" + definition.id}
        className="block text-sm font-semibold"
      >
        {definition.name}
      </label>
      <p className="text-xs text-neutral-500">
        {definition.field_type} · {stored?.is_set ? "Stored value" : "Not set"}
      </p>
      <FieldInput
        id={"cf-" + definition.id}
        definition={definition}
        value={value}
        onChange={setValue}
        disabled={pending || !editable}
      />
      {editable && (
        <div className="flex flex-wrap gap-2">
          <button
            className="min-h-11 rounded-full border px-4 text-xs"
            disabled={pending}
          >
            Save field
          </button>
          <button
            type="button"
            className="min-h-11 rounded-full border px-4 text-xs"
            disabled={pending || !stored?.is_set}
            onClick={() => {
              if (
                window.confirm(
                  "Clear this custom field value? Its change will be audited.",
                )
              )
                save(true);
            }}
          >
            Clear field
          </button>
        </div>
      )}
      {status && (
        <p role="status" className="text-xs">
          {status}
        </p>
      )}
    </form>
  );
}
export default function CustomFieldsRecord({
  object,
  recordId,
}: {
  object: FieldObject;
  recordId: string;
}) {
  const [data, setData] = useState<RecordFields | null>(null);
  useEffect(() => {
    let live = true;
    startTransition(async () => {
      const result = await loadRecordFields(object, recordId);
      if (live) setData(result.ok ? result.data : null);
    });
    return () => {
      live = false;
    };
  }, [object, recordId]);
  async function reload() {
    const result = await loadRecordFields(object, recordId);
    setData(result.ok ? result.data : null);
  }
  if (!data) return null;
  return (
    <section
      aria-label="Custom fields"
      className="vq-card-static max-h-80 overflow-y-auto min-w-0 rounded-[14px] bg-white p-5 motion-reduce:[&_*]:animate-none motion-reduce:[&_*]:transition-none"
      onKeyDownCapture={(e) => {
        const button = e.currentTarget.querySelector<HTMLButtonElement>(
          '[aria-haspopup="listbox"][aria-expanded="true"]',
        );
        if (e.key === "Escape" && button) {
          e.preventDefault();
          e.stopPropagation();
          button.click();
          requestAnimationFrame(() => button.isConnected && button.focus());
        }
      }}
    >
      <h2 className="text-[15px] font-semibold">Custom fields</h2>
      {!data.canEdit && (
        <p className="my-2 text-sm">
          Read only — parent record editing is not permitted.
        </p>
      )}
      {data.definitions.length === 0 && (
        <p className="mt-3 text-sm text-neutral-500">
          No active custom fields for this object.
        </p>
      )}
      {data.definitions.map((d) => {
        const v = data.values.find((v) => v.definition_id === d.id);
        return (
          <EditValue
            key={d.id + ":" + d.version + ":" + (v?.token ?? "")}
            definition={d}
            stored={v}
            object={object}
            recordId={recordId}
            editable={data.canEdit}
            onReload={reload}
          />
        );
      })}
    </section>
  );
}
