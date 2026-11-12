// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import MailHeadersConsentSettings from "./MailHeadersConsentSettings";
import { configureMailHeadersConsent } from "@/lib/mail-headers/actions";
import { mailHeadersStateError, type MailHeadersState } from "@/lib/mail-headers/model";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/lib/mail-headers/actions", () => ({ configureMailHeadersConsent: vi.fn() }));

const base: MailHeadersState = {
  enabled: false, canRead: true, lastError: null,
  company: { permitted: true, capped: false, enabled: false, workerAvailable: true, lastReviewAt: null, lastError: null },
  followup: { enabled: false, workerAvailable: false, lastReviewAt: null, lastError: null },
};
const toggle = () => screen.getByRole<HTMLInputElement>("checkbox", { name: "Allow Vanquish to read my email headers" });
const feature = (name: string) => within(screen.getByRole("heading", { name }).closest("li")!);
const memberState = (update: Partial<MailHeadersState> = {}): MailHeadersState => ({ ...base, ...update });

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(configureMailHeadersConsent).mockResolvedValue({ ok: true, message: "Consent saved." });
});

afterEach(cleanup);

it("has one explicit off-by-default consent and a linked explanation of scope and withdrawal", async () => {
  render(<MailHeadersConsentSettings state={base} />);
  expect(screen.getAllByRole("checkbox")).toHaveLength(1);
  expect(toggle().checked).toBe(false);
  const help = document.getElementById(toggle().getAttribute("aria-describedby") ?? "");
  expect(help?.textContent).toMatch(/does not cover message content, stored subjects, attachments or AI/);
  expect(screen.getByRole("link", { name: "How to withdraw access" }).getAttribute("href")).toBe("#mail-headers-withdrawal");
  expect(document.getElementById("mail-headers-withdrawal")?.textContent).toContain("Existing suggestions, reminders and history are kept");
  expect(screen.getByRole("status").textContent).toBe("");
  expect(configureMailHeadersConsent).not.toHaveBeenCalled();
  fireEvent.click(toggle());
  await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Consent saved."));
  expect(configureMailHeadersConsent).toHaveBeenCalledWith(true);
  expect(refresh).toHaveBeenCalledTimes(1);
});

it("prevents another toggle while saving consent", async () => {
  let finish!: (result: { ok: true; message: string }) => void;
  vi.mocked(configureMailHeadersConsent).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  render(<MailHeadersConsentSettings state={base} />);
  fireEvent.click(toggle());
  await waitFor(() => expect(toggle().disabled).toBe(true));
  expect(configureMailHeadersConsent).toHaveBeenCalledTimes(1);
  finish({ ok: true, message: "Consent saved." });
  await waitFor(() => expect(toggle().disabled).toBe(false));
});

it("keeps reviews off without consent despite stale feature flags and a capable worker", () => {
  render(<MailHeadersConsentSettings state={memberState({ company: { ...base.company, enabled: true } })} />);
  expect(feature("Company detection").getByText("Off.")).toBeTruthy();
});

it("shows the separate company permission without hiding active reminders", () => {
  render(<MailHeadersConsentSettings state={memberState({
    enabled: true,
    company: { ...base.company, permitted: false, enabled: true },
    followup: { ...base.followup, enabled: true, workerAvailable: true },
  })} />);
  expect(feature("Company detection").getByText("Requires permission from an administrator.")).toBeTruthy();
  expect(feature("Unanswered email reminders").getByText("Active.")).toBeTruthy();
  expect(screen.getByText(/Coverage is partial/)).toBeTruthy();
});

it("does not label an internally disabled feature as active", () => {
  render(<MailHeadersConsentSettings state={memberState({ enabled: true })} />);
  expect(feature("Company detection").getByText(/Withdraw and authorize again/)).toBeTruthy();
});

it("uses worker availability as a boolean and reports bounded errors and the last review per feature", () => {
  render(<MailHeadersConsentSettings state={memberState({
    enabled: true,
    company: { ...base.company, enabled: true, capped: true, lastReviewAt: "2026-11-10T00:00:00Z", lastError: "raw-provider-detail" },
    followup: { ...base.followup, enabled: true, lastReviewAt: "2026-11-11T00:00:00Z", lastError: "rate_limited" },
  })} />);
  expect(feature("Company detection").getByText("Active.")).toBeTruthy();
  expect(feature("Company detection").getByText(/newest 500-email limit/)).toBeTruthy();
  expect(feature("Company detection").getByText(/Last reviewed/)).toBeTruthy();
  expect(feature("Unanswered email reminders").getByText("Pending activation by the administrator.")).toBeTruthy();
  expect(feature("Unanswered email reminders").getByText(/Last reviewed/)).toBeTruthy();
  expect(feature("Unanswered email reminders").getByText(/Google limited requests/)).toBeTruthy();
  expect(screen.queryByText(/raw-provider-detail/)).toBeNull();
});

it("reports a single revocation and distinguishes missing SQL from ordinary errors", () => {
  const view = render(<MailHeadersConsentSettings state={memberState({ lastError: "revoked", canRead: false,
    company: { ...base.company, lastError: "reconnect" },
    followup: { ...base.followup, lastError: "reconnect" },
  })} />);
  expect(screen.getAllByText(/Reconnect Google and authorize again/i)).toHaveLength(1);
  expect(screen.queryByText("Reconnect Google to restore mailbox reading.")).toBeNull();
  expect(toggle().disabled).toBe(true);
  view.rerender(<MailHeadersConsentSettings state={null} stateError={mailHeadersStateError("PGRST202")} />);
  expect(screen.getByText(/until the database update is installed/)).toBeTruthy();
  expect(toggle().disabled).toBe(true);
  view.rerender(<MailHeadersConsentSettings state={null} stateError={mailHeadersStateError("42501")} />);
  expect(screen.getByText(/Try refreshing/)).toBeTruthy();
});

it("requires a Gmail read connection to opt in but permits withdrawal after losing it", async () => {
  const view = render(<MailHeadersConsentSettings state={memberState({ canRead: false })} />);
  expect(toggle().disabled).toBe(true);
  expect(feature("Unanswered email reminders").getByText("Requires Google connection with Gmail read access.")).toBeTruthy();
  view.rerender(<MailHeadersConsentSettings state={memberState({ enabled: true, canRead: false })} />);
  expect(toggle().disabled).toBe(false);
  fireEvent.click(toggle());
  await waitFor(() => expect(configureMailHeadersConsent).toHaveBeenCalledWith(false));
});

it("Settings uses one consent RPC and keeps relationship sync and manual scouting separate", () => {
  const page = readFileSync("src/app/(dashboard)/settings/page.tsx", "utf8");
  expect(page.match(/<MailHeadersConsentSettings\b/g)).toHaveLength(1);
  expect(page).toContain('rpc("my_mail_headers_consent_state")');
  expect(page).not.toMatch(/<EmailFollowupSettings\b|rpc\("my_email_followup_state"\)|rpc\("my_company_scouting_state"\)/);
  expect(page).toContain("<RelationshipSyncSettings");
  expect(page).toContain("<ScoutingSettings");
});
