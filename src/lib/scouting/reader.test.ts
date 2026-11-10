import { afterEach, describe, expect, it, vi } from "vitest";
import { GoogleError, type GoogleClient } from "../google/transport";
import { readCompanyScan, normalizeCompanyScanRows, CompanyScanDeadlineError, type CompanyScanContext } from "./reader";

import * as detector from "./detect";
import type { DetectedCompany } from "./detect";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

const now = new Date("2026-11-06T12:00:00Z");
const context: CompanyScanContext = {
  ownEmail: "owner@synthetic.test", ignoredDomains: [], websites: [], contacts: [],
};
const scope = "https://www.googleapis.com/auth/gmail.readonly";
const at = String(now.getTime() - 3600000);
function message(id: string, from = "owner@synthetic.test", to = "Founder <founder@venture.test>") {
  return { id, threadId: id, internalDate: at, payload: { headers: [
    { name: "From", value: from }, { name: "To", value: to }, { name: "Cc", value: "" },
  ] } };
}
function client(request: ReturnType<typeof vi.fn>, scopes = [scope]) {
  return { scopes, request } as GoogleClient;
}
const pathUrl = (path: string) => new URL(path, "https://fixture.synthetic.test");

function recordsClient(records: ReturnType<typeof message>[]) {
  return client(vi.fn(async (_service, path: string) => pathUrl(path).pathname === "/messages"
    ? { messages: records.map(({ id }) => ({ id })) }
    : records.find(({ id }) => pathUrl(path).pathname.endsWith(`/${id}`))));
}
const detectedRow = (overrides: Partial<DetectedCompany> = {}): DetectedCompany => ({
  domain: "good.test", suggestedName: "Good", threadCount: 2, twoWay: true,
  firstSeen: new Date(Number(at)).toISOString(), lastSeen: new Date(Number(at)).toISOString(), contacts: [], ...overrides,
});

describe("readCompanyScan", () => {
  it("only requests the newest metadata headers inside the existing 30-day/category window", async () => {
    const request = vi.fn().mockResolvedValueOnce({ messages: [{ id: "first" }, { id: "second" }] })
      .mockResolvedValueOnce(message("first"))
      .mockResolvedValueOnce(message("second", "Founder <founder@venture.test>", "owner@synthetic.test"));
    const result = await readCompanyScan(client(request), context, now);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ domain: "venture.test", twoWay: true, threadCount: 2 });
    expect(result.capped).toBe(false);
    const list = pathUrl(request.mock.calls[0][1]);
    expect(list.searchParams.get("q")).toBe("after:1791374400 -in:spam -in:trash -in:chats -category:promotions -category:social -category:forums -category:updates");
    expect(list.searchParams.get("fields")).toBe("messages(id,threadId),nextPageToken");
    for (const [service, path, init] of request.mock.calls) {
      expect(service).toBe("gmail");
      expect(init?.method ?? "GET").toBe("GET");
      const params = pathUrl(path).searchParams;
      if (params.has("format")) {
        expect(params.get("format")).toBe("metadata");
        expect(params.getAll("metadataHeaders")).toEqual(["From", "To", "Cc"]);
        expect(params.get("fields")).toBe("id,threadId,internalDate,payload(headers(name,value))");
        expect(path).not.toMatch(/format=full|subject|body|filename|snippet/i);
      }
    }
  });

  it("reads at most 500 messages even when a provider page is oversized", async () => {
    const request = vi.fn(async (_service, path: string) => {
      const url = pathUrl(path);
      if (url.pathname === "/messages") return { messages: Array.from({ length: 700 }, (_, n) => ({ id: `id${n}` })), nextPageToken: "more" };
      return message(url.pathname.split("/").at(-1)!);
    });
    const result = await readCompanyScan(client(request), context, now);
    expect(request.mock.calls.filter(([, path]) => pathUrl(path).pathname !== "/messages")).toHaveLength(500);
    expect(request.mock.calls.filter(([, path]) => pathUrl(path).pathname === "/messages")).toHaveLength(1);
    expect(result.capped).toBe(true);
  });

  it("excludes ignored sites, known websites, linked-contact domains and known contacts using the existing detector", async () => {
    const domains = ["ignored.test", "site.test", "linked.test", "known.test", "unknown.test", "gmail.com", "synthetic.test"];
    const records = domains.flatMap((domain, n) => [message(`a${n}`, `person@${domain}`, context.ownEmail), message(`b${n}`, context.ownEmail, `person@${domain}`)]);
    const request = vi.fn(async (_service, path: string) => pathUrl(path).pathname === "/messages"
      ? { messages: records.map(({ id }) => ({ id })) }
      : records.find(({ id }) => pathUrl(path).pathname.endsWith(`/${id}`)));
    const result = await readCompanyScan(client(request), {
      ...context,
      ignoredDomains: ["IGNORED.TEST"],
      websites: ["https://app.site.test/about"],
      contacts: [{ email: "other@linked.test", companyLinked: true }, { email: "person@known.test", companyLinked: false }],
    }, now);
    expect(result.rows.map(({ domain }) => domain)).toEqual(["unknown.test"]);
  });

  it("skips vanished messages and invalid/future/out-of-window dates without persisting other metadata", async () => {
    const records = [message("valid1", "person@unknown.test", context.ownEmail), message("valid2", context.ownEmail, "person@unknown.test"),
      { ...message("invalid"), internalDate: "bad" }, { ...message("future"), internalDate: String(now.getTime() + 1) },
      { ...message("old"), internalDate: String(now.getTime() - 31 * 86400000) }];
    const request = vi.fn(async (_service, path: string) => {
      if (pathUrl(path).pathname === "/messages") return { messages: [{ id: "gone" }, ...records.map(({ id }) => ({ id }))] };
      if (pathUrl(path).pathname.endsWith("/gone")) throw new GoogleError("not_found", "Private upstream detail");
      return records.find(({ id }) => pathUrl(path).pathname.endsWith(`/${id}`));
    });
    const result = await readCompanyScan(client(request), context, now);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ domain: "unknown.test", threadCount: 2 });
    expect(JSON.stringify(result)).not.toContain("Private upstream detail");
  });

  it("rejects missing read scope and an incomplete directory before requesting Gmail", async () => {
    const request = vi.fn();
    await expect(readCompanyScan(client(request, []), context, now)).rejects.toMatchObject({ code: "permission" });
    await expect(readCompanyScan(client(request), { ...context, contacts: Array.from({ length: 10_001 }, () => ({ email: "person@unknown.test", companyLinked: false })) }, now))
      .rejects.toMatchObject({ code: "unavailable" });
    expect(request).not.toHaveBeenCalled();
  });

  it("stops rather than looping on a repeated page token and does not retry a failed metadata read", async () => {
    const pages = vi.fn().mockResolvedValue({ messages: [], nextPageToken: "same" });
    await expect(readCompanyScan(client(pages), context, now)).rejects.toMatchObject({ code: "unavailable" });
    expect(pages).toHaveBeenCalledTimes(2);
    const request = vi.fn().mockResolvedValueOnce({ messages: [{ id: "one" }] })
      .mockRejectedValueOnce(new GoogleError("unavailable", "Private upstream detail"));
    await expect(readCompanyScan(client(request), context, now)).rejects.toMatchObject({ code: "unavailable" });
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("normalizes the exact detector domain cases so good.test survives malformed neighbors", async () => {
    const addresses = ["münchen.de", "semi.test;", "my_company.co", "good.test"].map((domain) => `founder@${domain}`).join(", ");
    const result = await readCompanyScan(recordsClient([message("a", context.ownEmail, addresses), message("b", context.ownEmail, addresses)]), context, now);
    expect(result.rows.map(({ domain }) => domain)).toEqual(["xn--mnchen-3ya.de", "good.test"]);
    const committed: string[] = [];
    for (const row of result.rows) {
      expect(row.domain).toMatch(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/);
      committed.push(row.domain); // strict SQL-like sink; no Google or database writes.
    }
    expect(committed).toContain("good.test");
  });

  it("keeps the 500 highest-priority companies when three messages produce over 500 domains", async () => {
    const addresses = [...Array.from({ length: 600 }, (_, n) => `founder@company${String(n).padStart(3, "0")}.test`), "founder@priority.test"].join(", ");
    const result = await readCompanyScan(recordsClient([message("a", context.ownEmail, addresses), message("b", context.ownEmail, addresses),
      message("c", "founder@priority.test", context.ownEmail)]), context, now);
    expect(result.rows).toHaveLength(500);
    expect(result.rows[0]).toMatchObject({ domain: "priority.test", twoWay: true, threadCount: 3 });
    expect(result.rows.at(-1)?.domain).toBe("company498.test");
    expect(result.rows.some(({ domain }) => domain === "company499.test")).toBe(false);
    expect(result.capped).toBe(true);
  });

  it("bounds names of 201 characters from actual headers before the strict batch sink", async () => {
    const longName = "A".repeat(201); const address = `"${longName}" <founder@${"a".repeat(201)}.test>`;
    const result = await readCompanyScan(recordsClient([message("a", context.ownEmail, address), message("b", context.ownEmail, address)]), context, now);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].suggestedName).toHaveLength(200);
    expect(result.rows[0].contacts[0].name).toHaveLength(200);
  });

  it("removes future two-way evidence before calling the detector, even if it would create a company", async () => {
    const detect = vi.spyOn(detector, "detectCompanies");
    const records = [message("good1"), message("good2"),
      { ...message("future1", context.ownEmail, "founder@future.test"), internalDate: String(now.getTime() + 1) },
      { ...message("future2", "founder@future.test", context.ownEmail), internalDate: String(now.getTime() + 1) }];
    const result = await readCompanyScan(recordsClient(records), context, now);
    expect(result.rows.map(({ domain }) => domain)).toEqual(["venture.test"]);
    expect(detect).toHaveBeenCalledOnce();
    expect(detect.mock.calls[0][0].map(({ threadId }) => threadId)).toEqual(["good1", "good2"]);
  });

  it("does not start reads without request/checkpoint margin and stops between metadata groups", async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    const request = vi.fn();
    await expect(readCompanyScan(client(request), context, now, now.getTime() + 20_000)).rejects.toBeInstanceOf(CompanyScanDeadlineError);
    expect(request).not.toHaveBeenCalled();
    const slow = vi.fn(async (_service, path: string) => {
      if (pathUrl(path).pathname === "/messages") return { messages: Array.from({ length: 6 }, (_, n) => ({ id: `id${n}` })) };
      vi.setSystemTime(new Date(now.getTime() + 100_001));
      return message(path.split("/").at(-1)!.split("?")[0]);
    });
    await expect(readCompanyScan(client(slow), context, now, now.getTime() + 120_000)).rejects.toBeInstanceOf(CompanyScanDeadlineError);
    expect(slow).toHaveBeenCalledTimes(6); // list + first five; never starts the sixth metadata read.
  });

  it("checks the deadline after a slow final provider response instead of committing a late batch", async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    const request = vi.fn(async (_service, path: string) => {
      if (pathUrl(path).pathname === "/messages") return { messages: [{ id: "late" }] };
      vi.setSystemTime(new Date(now.getTime() + 120_001));
      return message("late");
    });
    await expect(readCompanyScan(client(request), context, now, now.getTime() + 120_000)).rejects.toBeInstanceOf(CompanyScanDeadlineError);
    expect(request).toHaveBeenCalledTimes(2);
  });

});


describe("company scan SQL batch contract", () => {
  it("bounds contact counts/names/emails and rejects malformed address shapes independently", () => {
    const contacts = [
      { email: "a".repeat(250) + "@x.test", name: "too long email" },
      { email: "bad@@shape.test", name: "bad" }, { email: "bad address@shape.test", name: "bad" },
      ...Array.from({ length: 15 }, (_, n) => ({ email: `contact${n}@synthetic.test`, name: "🧪".repeat(201) })),
    ];
    const [row] = normalizeCompanyScanRows([detectedRow({ contacts })], now);
    expect(row.contacts).toHaveLength(10);
    expect(row.contacts[0].email).toBe("contact0@synthetic.test");
    expect(row.contacts.at(-1)?.email).toBe("contact9@synthetic.test");
    expect(Array.from(row.contacts[0].name)).toHaveLength(200);
    const boundary = "a".repeat(247) + "@x.test";
    expect(normalizeCompanyScanRows([detectedRow({ contacts: [{ email: boundary, name: "Boundary" }] })], now)[0].contacts[0].email).toHaveLength(254);
  });

  it("rejects oversized/invalid domains, empty names, invalid dates and invalid counts without dropping good rows", () => {
    const invalid: Partial<DetectedCompany>[] = [
      { domain: "a".repeat(249) + ".test" }, { domain: "my_company.co" }, { domain: "semi.test;" }, { suggestedName: "   " },
      { firstSeen: "invalid" }, { lastSeen: "invalid" }, { firstSeen: "2026-09-01T00:00:00Z" },
      { lastSeen: "2026-11-06T12:00:00.001Z" }, { firstSeen: "2026-11-06T11:30:00Z" },
      { threadCount: 0 }, { threadCount: 501 }, { threadCount: 1.5 }, { twoWay: null as unknown as boolean },
    ];
    for (const row of invalid) {
      expect(normalizeCompanyScanRows([detectedRow(row), detectedRow({ domain: "survivor.test" })], now).map(({ domain }) => domain))
        .toEqual(["survivor.test"]);
    }
    expect(normalizeCompanyScanRows([detectedRow({ domain: "münchen.de" }), detectedRow({ domain: "xn--mnchen-3ya.de" })], now)).toHaveLength(1);
  });
});
