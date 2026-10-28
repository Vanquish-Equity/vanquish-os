"use client";
import SelectMenu from "@/components/SelectMenu";
import Checkbox from "@/components/Checkbox";
import type { FieldDefinition } from "@/lib/custom-fields/model";
export default function FieldInput({
  definition,
  value,
  onChange,
  disabled = false,
  id,
  labelledBy,
}: {
  definition: FieldDefinition;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean;
  id: string;
  labelledBy?: string;
}) {
  const input =
    "min-h-11 w-full min-w-0 rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-cyan-300";
  if (definition.field_type === "boolean")
    return (
      <label className="flex min-h-11 items-center gap-2">
        <Checkbox
          id={id}
          checked={value === true}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        True
      </label>
    );
  if (definition.field_type === "single_select")
    return (
      <SelectMenu
        id={id}
        buttonClassName="min-h-11"
        value={typeof value === "string" ? value : ""}
        placeholder="Select an option"
        options={definition.options.map((o) => ({
          value: o.id,
          label: o.label,
        }))}
        disabled={disabled}
        onChange={onChange}
      />
    );
  if (definition.field_type === "multi_select")
    return (
      <div
        id={id}
        className="max-h-52 overflow-auto rounded-xl border p-2"
        role="group"
        aria-labelledby={labelledBy}
        aria-label={labelledBy ? undefined : definition.name}
      >
        {definition.options.map((o) => (
          <label
            key={o.id}
            className="flex min-h-11 items-center gap-2 text-sm"
          >
            <Checkbox
              checked={Array.isArray(value) && value.includes(o.id)}
              disabled={disabled}
              onChange={(e) =>
                onChange(
                  e.target.checked
                    ? [...(Array.isArray(value) ? value : []), o.id]
                    : (Array.isArray(value) ? value : []).filter(
                        (v) => v !== o.id,
                      ),
                )
              }
            />
            <span className="break-words">{o.label}</span>
          </label>
        ))}
      </div>
    );
  if (definition.field_type === "text")
    return (
      <textarea
        id={id}
        className={input}
        value={typeof value === "string" ? value : ""}
        maxLength={2000}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  return (
    <input
      id={id}
      className={input}
      type={definition.field_type === "date" ? "date" : "text"}
      inputMode={definition.field_type === "number" ? "decimal" : undefined}
      value={
        typeof value === "string" || typeof value === "number"
          ? String(value)
          : ""
      }
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      placeholder={
        definition.field_type === "number"
          ? "Up to 4 decimal places"
          : undefined
      }
    />
  );
}
