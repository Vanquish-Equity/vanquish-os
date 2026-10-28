import { describe, expect, it } from "vitest";
import { accountLabel, greetingFor, greetingName, sidebarCookieName } from "./entrance";

describe("accountLabel", () => {
  it("shows the part before @ in capitals", () => {
    expect(accountLabel("membera@synthetic.test")).toBe("MEMBERA");
    expect(accountLabel("memberb@synthetic.test")).toBe("MEMBERB");
  });
  it("uses an edited profile name in the account menu", () => {
    expect(accountLabel("membera@synthetic.test", "Synthetic Member")).toBe("SYNTHETIC MEMBER");
    expect(accountLabel("membera@synthetic.test", "  ")).toBe("MEMBERA");
  });
});

describe("greetingFor", () => {
  it("follows the local hour", () => {
    expect(greetingFor(5)).toBe("Good morning");
    expect(greetingFor(11)).toBe("Good morning");
    expect(greetingFor(12)).toBe("Good afternoon");
    expect(greetingFor(17)).toBe("Good afternoon");
    expect(greetingFor(18)).toBe("Good evening");
    expect(greetingFor(2)).toBe("Good evening");
  });
});

describe("greetingName", () => {
  it("prefers the member display name, then the provider name, never the email", () => {
    expect(greetingName("Alpha", "Alpha Test Sample")).toBe("Alpha");
    expect(greetingName("Gamma Delta", null)).toBe("Gamma Delta");
    expect(greetingName(null, "Beta Pérez")).toBe("Beta");
    expect(greetingName("  ", undefined)).toBe("");
  });
});

describe("sidebarCookieName", () => {
  it("is stable per member, case-insensitive, and does not contain the email", () => {
    const a = sidebarCookieName("membera@synthetic.test");
    expect(a).toBe(sidebarCookieName(" MEMBERA@synthetic.test "));
    expect(a).not.toBe(sidebarCookieName("memberd@synthetic.test"));
    expect(a).toMatch(/^vq_sidebar_[0-9a-z]+$/);
  });
});
