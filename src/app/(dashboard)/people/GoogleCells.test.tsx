// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ mail: vi.fn(), meeting: vi.fn() }));
vi.mock("@/lib/google/mail-actions", () => ({ lastEmailDatesForContacts: mocks.mail }));
vi.mock("@/lib/google/calendar-actions", () => ({ nextMeetingsForContacts: mocks.meeting }));
vi.mock("@/components/RelativeTime", () => ({
  default: ({ date }: { date: string }) => <span>rel:{date}</span>,
}));

import { GoogleLookups, LastEmailCell, NextMeetingCell } from "./GoogleCells";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function mount(emails: string[]) {
  const el = document.createElement("div");
  const root = createRoot(el);
  await act(async () => {
    root.render(
      <GoogleLookups emails={emails} lastEmail nextMeeting>
        <LastEmailCell email={emails[0]} />
        <NextMeetingCell email={emails[0]} />
      </GoogleLookups>,
    );
  });
  return { el, root };
}

describe("People Google columns", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows placeholders, then fills the cells from the browser lookups", async () => {
    let release!: (v: unknown) => void;
    mocks.meeting.mockResolvedValue({ ok: true, data: { "a@x.com": { start: "2030-01-01T10:00:00Z", summary: "Call" } } });
    mocks.mail.mockReturnValue(new Promise((r) => (release = r)));
    const { el } = await mount(["a@x.com"]);
    expect(el.querySelectorAll('[aria-label="Loading"]').length).toBe(1);
    await act(async () => release({ ok: true, data: { "a@x.com": { date: "2030-01-02", subject: "Hi" } } }));
    expect(el.textContent).toContain("rel:2030-01-02");
    expect(el.querySelector("time")).not.toBeNull();
  });

  it("does not ask Google again for the same people within the cache window", async () => {
    mocks.meeting.mockResolvedValue({ ok: true, data: {} });
    mocks.mail.mockResolvedValue({ ok: true, data: {} });
    await mount(["cache@x.com"]);
    await mount(["cache@x.com"]);
    expect(mocks.mail).toHaveBeenCalledTimes(1);
    expect(mocks.meeting).toHaveBeenCalledTimes(1);
  });

  it("leaves the cells empty and retries later when a lookup fails", async () => {
    mocks.meeting.mockResolvedValue({ ok: false });
    mocks.mail.mockRejectedValue(new Error("boom"));
    const { el } = await mount(["fail@x.com"]);
    expect(el.querySelectorAll('[aria-label="Loading"]').length).toBe(0);
    await mount(["fail@x.com"]);
    expect(mocks.mail).toHaveBeenCalledTimes(2);
  });
});
