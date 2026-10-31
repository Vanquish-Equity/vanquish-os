import { beforeEach, describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import type { ReactElement, ReactNode } from "react";
const m = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  access: vi.fn(),
  revalidate: vi.fn(),
  rows: [] as unknown[],
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc: m.rpc, from: m.from }),
}));
vi.mock("@/lib/auth/access", () => ({
  getAccess: m.access,
  actionAccessError: async () => null,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }) }));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidate }));
import { parseSpec, templateInput, type RecordRow, type Spec } from "./spec";
import {
  saveView,
  moveCard,
  viewData,
  saveTemplate,
  applyTemplate,
} from "./actions";
import { customizationState } from "./state";
import { loadSavedViews } from "@/lib/views/queries";
import { loadPipelineSavedViews } from "@/lib/views/pipeline-queries";
import PeopleViewsBar from "@/components/PeopleViewsBar";
import PipelineViewsBar from "@/components/PipelineViewsBar";
import CustomFieldsGate from "@/components/custom-fields/CustomFieldsGate";
import ViewsPanel, {
  ColumnsContent,
  SaveForm,
  type Catalog,
} from "@/components/customization/ViewsPanel";
import ViewsTable from "@/components/customization/ViewsTable";
import { nextSort, sortRows, toggleColumn, ariaSort } from "./view-helpers";
import TemplatesAdmin from "@/components/customization/TemplatesAdmin";
import ApplyTemplate from "@/components/customization/ApplyTemplate";
const id = "fa100000-0000-0000-0000-000000000001",
  other = "fa100000-0000-0000-0000-000000000002";
const spec: Spec = {
  version: 1,
  columns: ["name", "company"],
  sort: { key: "name", direction: "asc" },
  group: null,
  mode: "table",
};
beforeEach(() => {
  vi.clearAllMocks();
  m.access.mockResolvedValue({
    status: "member",
    email: "views.unit@synthetic.test",
    permissions: new Set(),
  });
  m.rpc.mockResolvedValue({
    data: { views: false, kanban: false, templates: false },
    error: null,
  });
  m.from.mockImplementation(() => {
    const q = {
      select: vi.fn(),
      eq: vi.fn(),
      order: vi.fn(),
      limit: vi.fn(),
      then: undefined as unknown,
    };
    for (const k of ["select", "eq", "order", "limit"] as const)
      q[k].mockReturnValue(q);
    q.then = (f: (v: unknown) => unknown) =>
      Promise.resolve({ data: m.rows, error: null }).then(f);
    return q;
  });
  m.rows = [];
});
describe("strict versioned views", () => {
  it("retains column order and permits exactly one canonical CF identity", () => {
    const value = {
      ...spec,
      columns: ["cf:" + id, "name"],
      sort: { key: "cf:" + id, direction: "desc" },
      group: "cf:" + id,
      mode: "kanban",
    };
    expect(parseSpec("people", value)).toEqual(value);
  });
  it.each([
    { ...spec, execute: "select private" },
    { ...spec, version: 2 },
    { ...spec, columns: ["name", "notes"] },
    { ...spec, columns: ["name", "name"] },
    { ...spec, columns: ["name", ...Array(8).fill("company")] },
    { ...spec, sort: { ...spec.sort, sql: "bad" } },
    { ...spec, sort: { key: "name;DROP", direction: "asc" } },
    { ...spec, sort: { key: "name", direction: ["asc"] } },
    { ...spec, group: "company" },
    { ...spec, mode: "kanban" },
    { ...spec, columns: ["name", "cf:" + id, "cf:" + other] },
    { ...spec, columns: ["name", "cf:" + id.toUpperCase()] },
    { ...spec, unknown: "x".repeat(5000) },
  ])("rejects unsupported specification %#", (v) =>
    expect(() => parseSpec("people", v)).toThrow(),
  );
  it("different object column allowlists, no mailbox-derived or Portfolio columns", () => {
    expect(() =>
      parseSpec("pipeline", { ...spec, columns: ["name", "email"] }),
    ).toThrow();
    expect(() =>
      parseSpec("people", { ...spec, columns: ["name", "last_email"] }),
    ).toThrow();
    expect(() =>
      parseSpec("people", { ...spec, columns: ["name", "lp_commitments"] }),
    ).toThrow();
  });
  it("Postgres error wins without leaking raw error detail", async () => {
    m.rpc.mockResolvedValue({
      data: null,
      error: { message: "Synthetic hidden sentinel" },
    });
    const r = await saveView({
      id: null,
      kind: "people",
      name: "Synthetic view",
      shared: true,
      spec,
    });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain("hidden sentinel");
    expect(m.revalidate).not.toHaveBeenCalled();
  });
  it("does not send unknown spec keys to the RPC", async () => {
    expect(
      (
        await saveView({
          id: null,
          kind: "people",
          name: "Synthetic",
          shared: false,
          spec: { ...spec, bad: true },
        })
      ).ok,
    ).toBe(false);
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("bounds column queries to four distinct buckets", async () => {
    expect((await viewData(id, Array(5).fill(null))).ok).toBe(false);
    expect((await viewData(id, [null, null])).ok).toBe(false);
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("moves only after confirmation through the field RPC; no stage/provider call", async () => {
    const input = {
      view: id,
      record: other,
      option: null,
      version: 1,
      token: null,
      confirmed: false,
    };
    expect((await moveCard(input)).ok).toBe(false);
    expect(m.rpc).not.toHaveBeenCalled();
    expect((await moveCard({ ...input, confirmed: true })).ok).toBe(true);
    expect(m.rpc).toHaveBeenCalledWith(
      "move_customization_card",
      expect.objectContaining({
        p_record: other,
        p_confirmed: true,
        p_token: null,
      }),
    );
    expect(m.from).not.toHaveBeenCalled();
  });
});
describe("compatible v0 and flag-off DOM", () => {
  it("existing People/Pipeline v0 filters are identical and v1 rows are omitted from legacy controls", async () => {
    const v0 = {
      id,
      name: "Synthetic v0",
      owner: "views.unit@synthetic.test",
      is_shared: false,
      filters: {
        view: "lps",
        groupId: null,
        q: "Synthetic",
        cols: ["email"],
        hideTerminal: true,
        stage: "Synthetic stage",
        priority: null,
      },
    };
    m.rows = [v0, { ...v0, id: other, filters: spec }];
    const db = { from: m.from } as unknown as Parameters<
      typeof loadSavedViews
    >[0];
    expect(await loadSavedViews(db, "people")).toEqual([
      {
        id,
        name: v0.name,
        owner: v0.owner,
        isShared: false,
        filters: {
          view: "lps",
          groupId: null,
          q: "Synthetic",
          cols: ["email"],
        },
      },
    ]);
    expect((await loadPipelineSavedViews(db))[0].filters).toEqual({
      hideTerminal: true,
      stage: "Synthetic stage",
      priority: null,
    });
  });
  it("paused server gate preserves exact legacy controls HTML and mounts no new client components", () => {
    const old = (
      <>
        <PeopleViewsBar
          tabs={<span>People</span>}
          views={[]}
          groups={[]}
          filters={{ view: "all", groupId: null, q: null, cols: null }}
          me="views.unit@synthetic.test"
        />
        <PipelineViewsBar
          tabs={<span>Pipeline</span>}
          views={[]}
          stages={[]}
          priorities={[]}
          filters={{ hideTerminal: true, stage: null, priority: null }}
          me="views.unit@synthetic.test"
        />
      </>
    );
    const next = (
      <>
        {old}
        <CustomFieldsGate enabled={false}>
          <ViewsPanel kind="people" kanban={false} />
          <TemplatesAdmin />
          <ApplyTemplate company={id} />
        </CustomFieldsGate>
      </>
    );
    expect(renderToStaticMarkup(next)).toBe(renderToStaticMarkup(old));
    expect(m.rpc).not.toHaveBeenCalled();
    expect(m.from).not.toHaveBeenCalled();
  });
  it("missing migration falls back to all off", async () => {
    m.rpc.mockRejectedValue(Error("Synthetic missing migration"));
    expect(await customizationState()).toEqual({
      views: false,
      kanban: false,
      templates: false,
    });
  });
});
describe("bounded manual templates", () => {
  const t = {
    id: null,
    name: "Synthetic template",
    tasks: ["Synthetic task"],
    checklist: ["Synthetic checklist"],
    archived: false,
    version: 0,
  };
  it.each([
    { ...t, tasks: Array(26).fill("Synthetic") },
    { ...t, checklist: Array(21).fill("Synthetic") },
    { ...t, tasks: ["x".repeat(201)] },
    { ...t, tasks: [], checklist: [] },
    { ...t, owner: "forged" },
  ])("rejects invalid template %#", (v) =>
    expect(() => templateInput(v)).toThrow(),
  );
  it("uses the admin RPC, never broadens direct checklist access", async () => {
    expect((await saveTemplate(t)).ok).toBe(true);
    expect(m.rpc).toHaveBeenCalledWith(
      "save_task_template",
      expect.objectContaining({ p_tasks: t.tasks, p_checklist: t.checklist }),
    );
    expect(m.from).not.toHaveBeenCalled();
  });
  it("preserves request identity on an explicit retry; does not retry itself", async () => {
    const input = {
      template: id,
      company: other,
      deal: null,
      card: null,
      version: 1,
      request: id,
      repeat: false,
      confirmed: true,
    };
    m.rpc
      .mockResolvedValueOnce({ data: null, error: { code: "unavailable" } })
      .mockResolvedValueOnce({ data: { alreadyApplied: true }, error: null });
    expect((await applyTemplate(input)).ok).toBe(false);
    expect(m.rpc).toHaveBeenCalledTimes(1);
    expect(await applyTemplate(input)).toMatchObject({
      ok: true,
      alreadyApplied: true,
    });
    expect(m.rpc.mock.calls.map((c) => c[1].p_request)).toEqual([id, id]);
  });
});

// ---- Simple views (bar, popovers, header sorting) ----
const catalog: Catalog = {
  views: [],
  fields: [
    {
      id,
      name: "Synthetic stage field",
      field_type: "single_select",
      version: 1,
    },
    { id: other, name: "Synthetic score", field_type: "number", version: 1 },
  ],
  me: "views.unit@synthetic.test",
  legacy: [],
  limited: false,
};
const BANNED = /Versioned|versioned|\bv1\b|\bv0\b|RLS|\bspec\b|allowlist|RPC/;
function walk(node: ReactNode, out: ReactElement[] = []): ReactElement[] {
  if (Array.isArray(node)) node.forEach((n) => walk(n, out));
  else if (node && typeof node === "object" && "props" in node) {
    out.push(node as ReactElement);
    walk((node as ReactElement<{ children?: ReactNode }>).props.children, out);
  }
  return out;
}
const rowOf = (n: string, company: string | null): RecordRow => ({
  id: n,
  name: n,
  company,
  company_id: null,
  stage: null,
  email: null,
  linkedin: null,
  token: null,
  field_value: null,
});

describe("simple views UI", () => {
  it("default state is a single compact line: View, Columns, Save view", () => {
    const html = renderToStaticMarkup(
      <ViewsPanel kind="people" kanban={false} initialCatalog={catalog} />,
    );
    expect(html).toContain("View:");
    expect(html).toContain("All people");
    expect(html).toContain(">Columns<");
    expect(html).toContain(">Save view<");
    expect(html.match(/aria-haspopup="dialog"/g)).toHaveLength(3);
    for (const absent of ["<table", "<form", "<h2", "<select", "<input"])
      expect(html).not.toContain(absent);
    expect(html).not.toContain("[&amp;~*]:hidden");
    expect(html).toContain('data-active="false"');
    expect(html).not.toMatch(BANNED);
    const deals = renderToStaticMarkup(
      <ViewsPanel kind="pipeline" kanban={false} initialCatalog={catalog} />,
    );
    expect(deals).toContain("All deals");
  });
  it("renders nothing until the catalog has loaded (and never when gated off)", () => {
    expect(
      renderToStaticMarkup(<ViewsPanel kind="people" kanban={false} />),
    ).toBe("");
  });
  it("sorts on one header click, flips on the second, and exposes aria-sort", () => {
    const calls: string[] = [];
    const props = {
      kind: "people" as const,
      columns: ["name", "company"],
      sort: { key: "name", direction: "asc" as const },
      rows: [rowOf("A", "Z Co")],
      definition: null,
      partial: false,
      warning: false,
      pendingField: false,
      sortedLocally: false,
      fieldName: null,
      onSort: (k: string) => calls.push(k),
    };
    const tree = ViewsTable(props);
    const buttons = walk(tree).filter((e) => e.type === "button");
    expect(buttons).toHaveLength(2);
    (buttons[1].props as { onClick: () => void }).onClick();
    expect(calls).toEqual(["company"]);
    const html = renderToStaticMarkup(<ViewsTable {...props} />);
    expect(html).toContain('aria-sort="ascending"');
    expect(html).toContain('aria-sort="none"');
    expect(
      renderToStaticMarkup(
        <ViewsTable {...props} sort={{ key: "name", direction: "desc" }} />,
      ),
    ).toContain('aria-sort="descending"');
    const s1 = nextSort({ key: "name", direction: "asc" }, "company");
    expect(s1).toEqual({ key: "company", direction: "asc" });
    expect(nextSort(s1, "company").direction).toBe("desc");
    expect(ariaSort(s1, "company")).toBe("ascending");
  });
  it("sorting keeps empty values last in both directions", () => {
    const rows = [rowOf("b", null), rowOf("c", "Y"), rowOf("a", "X")];
    const v = (r: RecordRow) => r.company;
    const get = (r: (typeof rows)[number], k: string) =>
      k === "company" ? v(r) : r.name;
    expect(
      sortRows(rows, { key: "company", direction: "asc" }, get).map(
        (r) => r.id,
      ),
    ).toEqual(["a", "c", "b"]);
    expect(
      sortRows(rows, { key: "company", direction: "desc" }, get).map(
        (r) => r.id,
      ),
    ).toEqual(["c", "a", "b"]);
  });
  it("tells people the list is partial in plain words", () => {
    const html = renderToStaticMarkup(
      <ViewsTable
        kind="people"
        columns={["name"]}
        sort={{ key: "name", direction: "asc" }}
        rows={[]}
        definition={null}
        partial
        warning={false}
        pendingField={false}
        sortedLocally={false}
        fieldName={null}
        onSort={() => {}}
      />,
    );
    expect(html).toContain(
      "Showing the first 100 people. Use search to narrow down.",
    );
  });
  it("saving asks for one field: the name; sharing is a small opt-in", () => {
    const html = renderToStaticMarkup(
      <SaveForm
        blocked={false}
        onSubmit={async () => null}
        onDone={() => {}}
      />,
    );
    const inputs = html.match(/<input[^>]*>/g) ?? [];
    expect(inputs.filter((i) => !i.includes('type="checkbox"'))).toHaveLength(
      1,
    );
    expect(inputs.filter((i) => i.includes('type="checkbox"'))).toHaveLength(1);
    expect(html).not.toContain('checked=""');
    expect(html).toContain("Share with the team");
    expect(html).toContain(
      "Everyone on the team can use this view. Nobody else can edit it.",
    );
    expect(html).toContain(">Save<");
    expect(html).not.toMatch(BANNED);
  });
  it("allows one custom field: the other one is disabled with a short reason", () => {
    const withOne = {
      ...spec,
      columns: ["name", "cf:" + id],
    };
    const html = renderToStaticMarkup(
      <ColumnsContent
        kind="people"
        spec={withOne}
        fields={catalog.fields}
        kanban={false}
        applied
        onChange={() => {}}
      />,
    );
    expect(html).toContain("Only one custom field per view for now");
    expect(html.match(/Only one custom field/g)).toHaveLength(1);
    expect(html.match(/disabled=""/g)).toHaveLength(2); // Name + the other field
    expect(html).toContain("Always shown");
    expect(toggleColumn(withOne, "cf:" + other, true)).toEqual({
      ok: false,
      reason: "custom",
    });
    expect(toggleColumn(withOne, "name", false)).toEqual({
      ok: false,
      reason: "locked",
    });
    const full = {
      ...spec,
      columns: ["name", "company", "email", "linkedin", "stage", "x", "y", "z"],
    };
    expect(toggleColumn(full, "cf:" + id, true)).toEqual({
      ok: false,
      reason: "max",
    });
  });
  it("unchecking the sorted column falls back to name", () => {
    const r = toggleColumn(
      {
        ...spec,
        columns: ["name", "email"],
        sort: { key: "email", direction: "desc" },
      },
      "email",
      false,
    );
    expect(r.ok && r.spec.sort).toEqual({ key: "name", direction: "asc" });
  });
  it("Kanban is invisible unless the capability is on", () => {
    const render = (kanban: boolean) =>
      renderToStaticMarkup(
        <ColumnsContent
          kind="people"
          spec={spec}
          fields={catalog.fields}
          kanban={kanban}
          applied={false}
          onChange={() => {}}
        />,
      );
    for (const word of ["Advanced", "Group by", "Layout", "Board", "Kanban"])
      expect(render(false)).not.toContain(word);
    expect(render(true)).toContain("Advanced");
    expect(render(true)).toContain("Group by");
  });
  it("every visible string avoids technical words", () => {
    for (const f of ["ViewsPanel.tsx", "ViewsTable.tsx", "ViewsKanban.tsx"]) {
      const src = readFileSync(`src/components/customization/${f}`, "utf8");
      const block = src.match(/const T = \{[\s\S]*?\n\};/)?.[0] ?? "";
      expect(block.length, f).toBeGreaterThan(100);
      expect(block, f).not.toMatch(BANNED);
    }
  });
  it("the page-level hide rule only applies while a view is applied", () => {
    const src = readFileSync(
      "src/components/customization/ViewsPanel.tsx",
      "utf8",
    );
    expect(src).toContain('active ? "[&~*]:hidden" : ""');
  });
});

describe("saving a view: friendly outcomes, no raw errors", () => {
  it("returns the new id and maps only the duplicate name to a message", async () => {
    m.rpc.mockResolvedValueOnce({ data: other, error: null });
    expect(
      await saveView({
        id: null,
        kind: "people",
        name: "A",
        shared: false,
        spec,
      }),
    ).toEqual({ ok: true, id: other });
    m.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "23505", message: "Synthetic hidden sentinel" },
    });
    const dup = await saveView({
      id: null,
      kind: "people",
      name: "A",
      shared: false,
      spec,
    });
    expect(dup).toEqual({
      ok: false,
      message: "You already have a view with that name.",
      reason: "duplicate",
    });
    expect(JSON.stringify(dup)).not.toContain("sentinel");
  });
});
