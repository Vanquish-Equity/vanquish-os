import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
const m = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  access: vi.fn(),
  refresh: vi.fn(),
  defs: [] as unknown[],
  options: [] as unknown[],
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc: m.rpc, from: m.from }),
}));
vi.mock("@/lib/auth/access", () => ({ getAccess: m.access }));
vi.mock("next/cache", () => ({ revalidatePath: m.refresh }));
import {
  definitionInput,
  typedValue,
  filterInput,
  type FieldDefinition,
  type DefinitionInput,
} from "./model";
import {
  customFieldsEnabled,
  loadRecordFields,
  saveRecordField,
  saveFieldDefinition,
  searchFieldRecords,
} from "./actions";
import CustomFieldsGate from "@/components/custom-fields/CustomFieldsGate";
import FieldInput from "@/components/custom-fields/FieldInput";
import CustomFieldsRecord from "@/components/custom-fields/CustomFieldsRecord";
import CustomFieldsAdmin from "@/components/custom-fields/CustomFieldsAdmin";
import CustomFieldFilter from "@/components/custom-fields/CustomFieldFilter";
const id = "f7000000-0000-0000-0000-000000000101",
  record = "f7000000-0000-0000-0000-000000000102",
  option = "f7000000-0000-0000-0000-000000000103";
const def: FieldDefinition = {
  id,
  object_type: "people",
  field_type: "text",
  name: "Synthetic field",
  version: 1,
  sort_order: 0,
  archived: false,
  filterable: true,
  options: [
    {
      id: option,
      definition_id: id,
      label: "Synthetic option",
      sort_order: 0,
      version: 1,
    },
  ],
};
const definition: DefinitionInput = {
  id: null,
  object: "people",
  name: "Synthetic field",
  type: "text",
  order: 0,
  archived: false,
  filterable: false,
  version: 0,
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(Error("No provider calls permitted")),
  );
  m.defs = [def];
  m.options = def.options;
  m.access.mockResolvedValue({
    status: "member",
    email: "fields.member@synthetic.test",
    permissions: new Set(),
  });
  m.rpc.mockImplementation(async (name: string) => ({
    data: name === "custom_fields_state" ? true : [],
    error: null,
  }));
  m.from.mockImplementation((table: string) => {
    const q = {
      select: vi.fn(),
      eq: vi.fn(),
      order: vi.fn(),
      limit: vi.fn(),
      in: vi.fn(),
      then: undefined as unknown,
    };
    for (const key of ["select", "eq", "order", "limit", "in"] as const)
      q[key].mockReturnValue(q);
    q.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({
        data:
          table === "custom_field_definitions"
            ? m.defs
            : table === "custom_field_options"
              ? m.options
              : [],
        error: null,
      }).then(resolve);
    return q;
  });
});
afterEach(() => vi.unstubAllGlobals());
describe("typed custom fields, no query language or external providers", () => {
  it("all new client panels render no HTML initially, preserving SSR baseline", () => {
    expect(
      renderToStaticMarkup(
        <CustomFieldsRecord object="people" recordId={record} />,
      ),
    ).toBe("");
    expect(renderToStaticMarkup(<CustomFieldsAdmin />)).toBe("");
    expect(renderToStaticMarkup(<CustomFieldFilter object="deals" />)).toBe("");
  });
  it("missing migration or flag keeps old behavior with no new table reads", async () => {
    m.rpc.mockResolvedValue({ data: null, error: { code: "42883" } });
    expect(await customFieldsEnabled()).toBe(false);
    expect((await loadRecordFields("people", record)).ok).toBe(false);
    expect(m.from).not.toHaveBeenCalled();
  });
  it("preserves false, numeric zero and empty text distinctly from clear", () => {
    expect(typedValue({ ...def, field_type: "boolean" }, false).p_boolean).toBe(
      false,
    );
    expect(typedValue({ ...def, field_type: "number" }, "0").p_number).toBe(
      "0",
    );
    expect(typedValue(def, "").p_text).toBe("");
    expect(typedValue(def, "ignored", true)).toMatchObject({
      p_set: false,
      p_text: null,
    });
  });
  it.each([
    "1000000000.0001",
    "-1000000000.0001",
    "0.00001",
    "NaN",
    "Infinity",
    "1e2",
  ])("rejects invalid numeric %s without rounding", (v) =>
    expect(() => typedValue({ ...def, field_type: "number" }, v)).toThrow(),
  );
  it("accepts finite numeric bounds and exactly four decimals", () =>
    expect(
      typedValue({ ...def, field_type: "number" }, "-999999999.1234").p_number,
    ).toBe("-999999999.1234"));
  it.each(["2026-02-30", "1899-12-31", "2201-01-01", "2026-1-1"])(
    "rejects invalid date %s",
    (v) =>
      expect(() => typedValue({ ...def, field_type: "date" }, v)).toThrow(),
  );
  it("bounds text, option ownership, duplicate and oversized multi selections", () => {
    expect(() => typedValue(def, "x".repeat(2001))).toThrow();
    expect(() =>
      typedValue({ ...def, field_type: "single_select" }, record),
    ).toThrow();
    expect(() =>
      typedValue({ ...def, field_type: "multi_select" }, [option, option]),
    ).toThrow();
    expect(() =>
      typedValue(
        { ...def, field_type: "multi_select" },
        Array(21).fill(option),
      ),
    ).toThrow();
  });
  it("stable option IDs survive a renamed display label", () => {
    const d = { ...def, field_type: "single_select" as const };
    expect(typedValue(d, option)).toEqual(
      typedValue(
        {
          ...d,
          options: [{ ...d.options[0], label: "Synthetic renamed option" }],
        },
        option,
      ),
    );
  });
  it.each([
    "investments",
    "investor_positions",
    "capital_events",
    "lp_tasks",
    "documents",
  ])("excludes object %s rather than widening definitions", (object) =>
    expect(() =>
      definitionInput({ ...definition, object: object as "people" }),
    ).toThrow(),
  );
  it("rejects unknown keys, overlong names and non-whitelisted type/operator/sort", () => {
    expect(() =>
      definitionInput({
        ...definition,
        filters: { execute: "bad" },
      } as DefinitionInput),
    ).toThrow();
    expect(() =>
      definitionInput({ ...definition, name: "x".repeat(81) }),
    ).toThrow();
    expect(() => filterInput(def, "eq OR true", "text", "record")).toThrow();
    expect(() => filterInput(def, "eq", "text", "value;DROP")).toThrow();
  });
  it("only admin may save a definition; regular parent editors need no new permission", async () => {
    expect((await saveFieldDefinition(definition)).ok).toBe(false);
    expect(m.rpc).not.toHaveBeenCalled();
    expect(
      (
        await saveRecordField({
          object: "people",
          recordId: record,
          definitionId: id,
          version: 1,
          token: null,
          value: "Synthetic value",
          clear: false,
        })
      ).ok,
    ).toBe(true);
    expect(m.rpc).toHaveBeenCalledWith(
      "custom_field_set_value",
      expect.objectContaining({ p_record: record, p_text: "Synthetic value" }),
    );
  });
  it("Postgres rejection wins over a passing server validation and leaks no raw details", async () => {
    m.rpc.mockImplementation(async (name: string) =>
      name === "custom_field_set_value"
        ? {
            data: null,
            error: { code: "42501", details: "Synthetic hidden record detail" },
          }
        : { data: true, error: null },
    );
    const r = await saveRecordField({
      object: "people",
      recordId: record,
      definitionId: id,
      version: 1,
      token: null,
      value: "Synthetic valid input",
      clear: false,
    });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain("hidden record detail");
    expect(m.refresh).not.toHaveBeenCalled();
  });
  it("paused server gate omits the client widgets and their load actions", async () => {
    m.rpc.mockResolvedValue({ data: false, error: null });
    expect(
      CustomFieldsGate({
        enabled: await customFieldsEnabled(),
        children: <CustomFieldFilter object="people" />,
      }),
    ).toBeNull();
    expect(m.rpc).toHaveBeenCalledTimes(1);
    expect(m.rpc).toHaveBeenCalledWith("custom_fields_state");
    expect(m.from).not.toHaveBeenCalled();
  });
  it("multi-select group is named by its visible label, not label-for on a div", () => {
    const html = renderToStaticMarkup(
      <>
        <label id="synthetic-field-label">Synthetic multiple</label>
        <FieldInput
          id="synthetic-multiple"
          labelledBy="synthetic-field-label"
          definition={{ ...def, field_type: "multi_select" }}
          value={[]}
          onChange={() => {}}
        />
      </>,
    );
    expect(html).toContain('aria-labelledby="synthetic-field-label"');
    expect(html).toContain('role="group"');
    expect(html).not.toContain('for="synthetic-multiple"');
  });
  it("a schema-version race at the SQL write returns a clear reload message", async () => {
    m.rpc.mockImplementation(async (name: string) =>
      name === "custom_field_set_value"
        ? {
            data: null,
            error: { code: "40001", message: "Field schema changed; reload" },
          }
        : { data: true, error: null },
    );
    const r = await saveRecordField({
      object: "people",
      recordId: record,
      definitionId: id,
      version: 1,
      token: null,
      value: "Synthetic value",
      clear: false,
    });
    expect(r).toMatchObject({
      ok: false,
      message: expect.stringContaining("schema changed"),
    });
    expect(m.refresh).not.toHaveBeenCalled();
  });
  it("deal writes revalidate the actual pipeline route, never /deals", async () => {
    m.defs = [{ ...def, object_type: "deals" }];
    const r = await saveRecordField({
      object: "deals",
      recordId: record,
      definitionId: id,
      version: 1,
      token: null,
      value: "Synthetic value",
      clear: false,
    });
    expect(r.ok).toBe(true);
    expect(m.refresh).toHaveBeenCalledWith("/pipeline");
    expect(m.refresh).not.toHaveBeenCalledWith("/deals");
  });
  it("stale definition version never reaches the write RPC and explains the reload", async () => {
    const result = await saveRecordField({
      object: "people",
      recordId: record,
      definitionId: id,
      version: 2,
      token: null,
      value: "Synthetic value",
      clear: false,
    });
    expect(result).toMatchObject({
      ok: false,
      message: expect.stringContaining("schema changed"),
    });
    expect(
      (
        await saveRecordField({
          object: "people",
          recordId: record,
          definitionId: id,
          version: 2,
          token: null,
          value: "Synthetic value",
          clear: false,
        })
      ).ok,
    ).toBe(false);
    expect(
      m.rpc.mock.calls.some((c) => c[0] === "custom_field_set_value"),
    ).toBe(false);
  });
  it("passes literal text as a bound typed argument, never SQL/table syntax", async () => {
    const text = "Synthetic '; DROP TABLE x --";
    await searchFieldRecords({
      object: "people",
      definitionId: id,
      operator: "eq",
      value: text,
      sort: "record",
    });
    expect(m.rpc).toHaveBeenCalledWith(
      "custom_field_search",
      expect.objectContaining({ p_text: text, p_operator: "eq", p_limit: 100 }),
    );
    expect(
      m.from.mock.calls.every((c) =>
        ["custom_field_definitions", "custom_field_options"].includes(c[0]),
      ),
    ).toBe(true);
  });
  it("rejects query injection operators before the filter RPC", async () => {
    expect(
      (
        await searchFieldRecords({
          object: "people",
          definitionId: id,
          operator: "eq OR true",
          value: "Synthetic",
          sort: "record",
        })
      ).ok,
    ).toBe(false);
    expect(m.rpc.mock.calls.some((c) => c[0] === "custom_field_search")).toBe(
      false,
    );
  });
});
