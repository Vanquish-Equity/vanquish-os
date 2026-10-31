import { beforeEach, describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
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
vi.mock("next/navigation",()=>({useRouter:()=>({refresh(){}})}));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidate }));
import { parseSpec, templateInput, type Spec } from "./spec";
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
import ViewsPanel from "@/components/customization/ViewsPanel";
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
