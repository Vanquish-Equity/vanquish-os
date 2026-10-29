"use client";
import { useState, useEffect, startTransition, useTransition } from "react";
import Link from "next/link";
import SelectMenu from "@/components/SelectMenu";
import FieldInput from "./FieldInput";
import {
  loadFieldSchema,
  searchFieldRecords,
} from "@/lib/custom-fields/actions";
import {
  operators,
  type FieldObject,
  type FieldDefinition,
} from "@/lib/custom-fields/model";
export default function CustomFieldFilter({ object }: { object: FieldObject }) {
  const [defs, setDefs] = useState<FieldDefinition[] | null>(null),
    [selected, setSelected] = useState(""),
    [op, setOp] = useState("eq"),
    [sort, setSort] = useState("record"),
    [value, setValue] = useState<unknown>(""),
    [results, setResults] = useState<
      { id: string; name: string; href: string }[] | null
    >(null),
    [partial, setPartial] = useState(false),
    [status, setStatus] = useState(""),
    [pending, run] = useTransition();
  useEffect(() => {
    let live = true;
    startTransition(async () => {
      const r = await loadFieldSchema(object);
      if (live)
        setDefs(r.ok ? r.definitions.filter((d) => d.filterable) : null);
    });
    return () => {
      live = false;
    };
  }, [object]);
  if (!defs) return null;
  const def = defs.find((d) => d.id === selected);
  return (
    <section
      aria-label="Custom field filters"
      className="vq-card-static min-w-0 rounded-[14px] bg-white p-4 motion-reduce:[&_*]:animate-none motion-reduce:[&_*]:transition-none"
    >
      <details>
        <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold">
          Custom field matches
        </summary>
        <p className="my-2 text-xs text-neutral-500">
          One field at a time; up to 100 authorized matches. This does not alter
          or save the existing list/view.
        </p>
        {!defs.length ? (
          <p className="text-sm">No filterable fields configured.</p>
        ) : (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!def) return;
              run(async () => {
                setResults(null);
                const r = await searchFieldRecords({
                  object,
                  definitionId: def.id,
                  operator: op,
                  value,
                  sort,
                });
                if (!r.ok) {
                  setStatus(r.message);
                  return;
                }
                setResults(r.records);
                setPartial(r.partial);
                setStatus("");
              });
            }}
          >
            <label htmlFor={"cf-filter-" + object} className="block text-xs">
              Field
            </label>
            <SelectMenu
              id={"cf-filter-" + object}
              buttonClassName="min-h-11"
              value={selected}
              disabled={pending}
              placeholder="Choose field"
              options={defs.map((d) => ({ value: d.id, label: d.name }))}
              onChange={(id) => {
                const d = defs.find((d) => d.id === id)!;
                setSelected(id);
                setOp(operators(d.field_type)[0]);
                setSort("record");
                setValue(d.field_type === "boolean" ? false : "");
                setResults(null);
              }}
            />
            {def && (
              <>
                <label htmlFor={"cf-op-" + object} className="block text-xs">
                  Operator
                </label>
                <SelectMenu
                  id={"cf-op-" + object}
                  buttonClassName="min-h-11"
                  value={op}
                  disabled={pending}
                  options={operators(def.field_type).map((v) => ({
                    value: v,
                    label:
                      v === "eq"
                        ? "Equals"
                        : v === "lt"
                          ? "Less than"
                          : v === "gt"
                            ? "Greater than"
                            : "Contains (literal)",
                  }))}
                  onChange={(v) => {
                    setOp(v);
                    setResults(null);
                  }}
                />
                <label
                  htmlFor={"cf-operand-" + object}
                  className="block text-xs"
                >
                  Value
                </label>
                <FieldInput
                  id={"cf-operand-" + object}
                  definition={
                    def.field_type === "multi_select"
                      ? { ...def, field_type: "single_select" }
                      : def
                  }
                  value={value}
                  onChange={(v) => {
                    setValue(v);
                    setResults(null);
                  }}
                  disabled={pending}
                />
                <label htmlFor={"cf-sort-" + object} className="block text-xs">
                  Order
                </label>
                <SelectMenu
                  id={"cf-sort-" + object}
                  buttonClassName="min-h-11"
                  value={sort}
                  disabled={pending}
                  options={[
                    { value: "record", label: "Record ID (stable)" },
                    ...(def.field_type !== "multi_select"
                      ? [
                          { value: "value_asc", label: "Value ascending" },
                          { value: "value_desc", label: "Value descending" },
                        ]
                      : []),
                  ]}
                  onChange={(v) => {
                    setSort(v);
                    setResults(null);
                  }}
                />
                <button
                  disabled={pending}
                  className="min-h-11 rounded-full border px-4 text-sm"
                >
                  Find authorized matches
                </button>
              </>
            )}
          </form>
        )}
        {status && (
          <p role="status" className="mt-2 text-sm">
            {status}
          </p>
        )}
        {results && (
          <div className="mt-3 space-y-2">
            {partial && (
              <p role="status" className="text-sm">
                Partial: first 100 matches. Refine the field filter.
              </p>
            )}
            {results.length === 0 && (
              <p className="text-sm">No authorized matches.</p>
            )}
            <div className="vq-card-grid space-y-2">
              {results.map((r) => (
                <Link
                  className="vq-card block min-h-11 rounded-[14px] bg-white p-3 text-sm text-cyan-800 focus-visible:ring-2 focus-visible:ring-cyan-300"
                  key={r.id}
                  href={r.href}
                >
                  {r.name}
                </Link>
              ))}
            </div>
          </div>
        )}
      </details>
    </section>
  );
}
