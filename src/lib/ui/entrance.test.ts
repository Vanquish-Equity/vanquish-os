import { describe, expect, it } from "vitest";
import { accountLabel, greetingFor, greetingName, sidebarCookieName } from "./entrance";

describe("accountLabel", () => {
  it("shows the part before @ in capitals", () => {
    expect(accountLabel("marios@vanquishequity.com")).toBe("MARIOS");
    expect(accountLabel("pbp@vanquishequity.com")).toBe("PBP");
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
    expect(greetingName("Mario", "Mario Salas Sandí")).toBe("Mario");
    expect(greetingName("Juan Pablo", null)).toBe("Juan Pablo");
    expect(greetingName(null, "Pedro Pérez")).toBe("Pedro");
    expect(greetingName("  ", undefined)).toBe("");
  });
});

describe("sidebarCookieName", () => {
  it("is stable per member, case-insensitive, and does not contain the email", () => {
    const a = sidebarCookieName("marios@vanquishequity.com");
    expect(a).toBe(sidebarCookieName(" MARIOS@vanquishequity.com "));
    expect(a).not.toBe(sidebarCookieName("scott@vanquishequity.com"));
    expect(a).toMatch(/^vq_sidebar_[0-9a-z]+$/);
  });
});
