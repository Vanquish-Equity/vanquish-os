import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ saved: undefined as string | undefined }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => (state.saved === undefined ? undefined : { value: state.saved }) }) }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));
vi.mock("@/lib/auth/access", () => ({ requireMember: async () => ({ status: "member", email: "member@synthetic.test" }) }));

import Root from "./page";

const landed = async (saved: string | undefined) => {
  state.saved = saved;
  return Root().then(
    () => "no redirect",
    (error: Error) => error.message,
  );
};

describe("post-login landing page", () => {
  beforeEach(() => {
    state.saved = undefined;
  });

  it("sends every previously saved value to the right place", async () => {
    expect(await landed("/home")).toBe("redirect:/home");
    expect(await landed("/overview")).toBe("redirect:/home?tab=dashboard");
    expect(await landed("/pipeline")).toBe("redirect:/pipeline");
  });

  it("defaults to Home (Today) with no saved value or an unknown one", async () => {
    expect(await landed(undefined)).toBe("redirect:/home");
    expect(await landed("/reporting")).toBe("redirect:/home");
    expect(await landed("//evil.test")).toBe("redirect:/home");
  });
});
