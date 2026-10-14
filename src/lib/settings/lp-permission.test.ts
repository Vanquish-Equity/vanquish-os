import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import AdminSettings from "../../components/AdminSettings";
import { setMemberPermission } from "./admin-actions";
import { toPermissionSet } from "../auth/permissions";
const state = vi.hoisted(() => ({ permissions: [] as string[], rpc: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../auth/access", () => ({ getAccess: async () => ({ status: "member", email: "admin@synthetic.test", permissions: new Set(["admin"]) }) }));
vi.mock("../supabase/server", () => ({ createClient: async () => ({ rpc: state.rpc }) }));
describe("LP Admin settings and Members & access", () => {
  it("reads the same permission grant that the Admin action writes, including revocation", async () => {
    state.permissions = [];
    state.rpc.mockImplementation(async (_name, args) => { state.permissions = args.p_enabled ? [args.p_permission] : []; return { error: null }; });
    function render() { return renderToStaticMarkup(createElement(AdminSettings, { me: "admin@synthetic.test", members: [{ email: "member@synthetic.test", name: "Synthetic Member", active: true, permissions: state.permissions }], domains: [] })); }
    expect(render()).toMatch(/aria-label="LP scouting" aria-checked="false"/);
    expect(await setMemberPermission("member@synthetic.test", "lp_scouting", true)).toEqual({ ok: true });
    expect(state.rpc).toHaveBeenCalledWith("admin_set_member_permission", { p_email: "member@synthetic.test", p_permission: "lp_scouting", p_enabled: true });
    expect(render()).toMatch(/aria-label="LP scouting" aria-checked="true"/);
    expect(toPermissionSet(state.permissions).has("lp_scouting")).toBe(true);
    await setMemberPermission("member@synthetic.test", "lp_scouting", false);
    expect(render()).toMatch(/aria-label="LP scouting" aria-checked="false"/);
    expect(toPermissionSet(state.permissions).has("lp_scouting")).toBe(false);
  });
});
