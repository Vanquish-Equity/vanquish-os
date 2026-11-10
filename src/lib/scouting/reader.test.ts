import { describe, expect, it, vi } from "vitest";
import { GoogleError, type GoogleClient } from "../google/transport";
import { readCompanyScan, type CompanyScanContext } from "./reader";

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
});
