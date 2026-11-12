import { readFileSync } from "node:fs";
import { FREE_MAIL_DOMAINS } from "../scouting/detect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type GoogleClient } from "../google/transport";
import { FollowupDeadlineError, normalizeFollowupRows, readFollowupBatch, type FollowupContext, type FollowupRow } from "./reader";

const now = new Date("2026-11-11T00:01:00.000Z");
const ownEmail = "owner@workspace-synthetic.test";
const sender = "contact@external.synthetic.test";
const personId = "70000000-0000-4000-8000-000000000001";
const scope = "https://www.googleapis.com/auth/gmail.readonly";
const ctx: FollowupContext = { ownEmail, windowDays: 14, memberEmails: ["other@elsewhere-synthetic.test"],
  contacts: [sender, "billing@external.synthetic.test", "same@workspace-synthetic.test", "sub@mail.workspace-synthetic.test", "other@elsewhere-synthetic.test"]
    .map((email) => ({ email, personId })), pendingThreads: [] };
const at = (days: number, hours = 0) => Date.UTC(2026, 10, 11 - days, hours);

function msg(id: string, threadId = "thread", from = sender, days = 5, labels = ["INBOX"], extra: Record<string, string> = {}, mimeType = "text/plain") {
  return { id, threadId, internalDate: String(at(days, days ? 23 : 0)), labelIds: labels,
    payload: { mimeType, headers: Object.entries({ From: `Synthetic Name <${from}>`, To: ownEmail, ...extra }).map(([name, value]) => ({ name, value })) } };
}
function fixture(threads: Record<string, unknown[]>, listed = Object.keys(threads)) {
  const request = vi.fn(async (_service: string, url: string, options?: Parameters<GoogleClient["request"]>[2]) => {
    void options;
    if (url.startsWith("/threads?")) return { threads: listed.map((id) => ({ id })) };
    const id = new URL(url, "https://synthetic.test").pathname.split("/").at(-1)!;
    return JSON.stringify({ id, messages: threads[id] });
  });
  return { client: { scopes: [scope], request } as GoogleClient, request };
}
afterEach(() => vi.useRealTimers());

describe("header-only follow-up reader", () => {
  it("reads a five-UTC-day-old latest inbound even before five elapsed 24-hour periods", async () => {
    const { client, request } = fixture({ thread: [msg("inbound")] });
    expect(await readFollowupBatch(client, ctx, now)).toEqual([{ kind: "inbound", threadId: "thread",
      messageId: "inbound", at: new Date(at(5, 23)).toISOString(), sender, personId }]);
    const list = new URL(request.mock.calls[0][1], "https://synthetic.test").searchParams;
    expect(list.get("q")).toContain(`in:inbox after:${at(14) / 1000 - 1}`);
    expect(list.get("q")).toContain(`before:${at(4) / 1000}`);
    expect(list.get("q")).toContain("-filename:ics");
    expect(list.get("fields")).toBe("threads(id)");
    const detail = new URL(request.mock.calls[1][1], "https://synthetic.test").searchParams;
    expect(detail.get("format")).toBe("metadata");
    expect(detail.getAll("metadataHeaders")).toEqual(["From", "List-Unsubscribe", "Precedence", "Auto-Submitted"]);
    expect(detail.get("fields")).toBe("id,messages(id,threadId,internalDate,labelIds,payload(mimeType,parts(mimeType,parts(mimeType)),headers(name,value)))");
  });

  it.each([
    ["automatic sender", msg("m", "thread", "billing@external.synthetic.test")],
    ["list unsubscribe", msg("m", "thread", sender, 5, ["INBOX"], { "List-Unsubscribe": "" })],
    ["bulk precedence", msg("m", "thread", sender, 5, ["INBOX"], { Precedence: "bulk" })],
    ["list precedence", msg("m", "thread", sender, 5, ["INBOX"], { Precedence: "LIST" })],
    ["auto submitted", msg("m", "thread", sender, 5, ["INBOX"], { "Auto-Submitted": "auto-replied" })],
    ["own domain", msg("m", "thread", "same@workspace-synthetic.test")],
    ["own subdomain", msg("m", "thread", "sub@mail.workspace-synthetic.test")],
    ["another app member", msg("m", "thread", "other@elsewhere-synthetic.test")],
    ["unknown sender", msg("m", "thread", "unknown@external.synthetic.test")],
    ["not inbox", msg("m", "thread", sender, 5, ["IMPORTANT"])],
    ["excluded category", msg("m", "thread", sender, 5, ["INBOX", "CATEGORY_UPDATES"])],
    ["calendar invite", msg("m", "thread", sender, 5, ["INBOX"], {}, "text/calendar; method=REQUEST")],
    ["too young", msg("m", "thread", sender, 4)],
    ["outside first window", msg("m", "thread", sender, 15)],
    ["invalid ID", msg("bad/id")],
    ["invalid timestamp", { ...msg("m"), internalDate: "invalid" }],
    ["future timestamp", msg("m", "thread", sender, -1)],
    ["wrong thread", msg("m", "wrong")],
    ["malformed message", null],
    ["malformed header", { ...msg("m"), payload: { headers: [null] } }],
    ["multiple From addresses", msg("m", "thread", sender, 5, ["INBOX"], { From: `${sender}, x@external.synthetic.test` })],
  ])("ignores %s without losing a valid neighbor", async (_reason, bad) => {
    const { client } = fixture({ thread: [bad], good: [msg("valid", "good")] });
    expect((await readFollowupBatch(client, ctx, now)).map((r) => r.threadId)).toEqual(["good"]);
  });

  it("ignores a nested calendar part and rejects an ambiguous exact match", async () => {
    const nested = msg("m");
    const { client } = fixture({ thread: [{ ...nested, payload: { ...nested.payload, parts: [{ parts: [{ mimeType: "text/calendar" }] }] } }],
      ambiguous: [msg("m", "ambiguous", "unique@external.synthetic.test")] });
    expect(await readFollowupBatch(client, { ...ctx, contacts: [...ctx.contacts,
      { email: "unique@external.synthetic.test", personId },
      { email: "unique@external.synthetic.test", personId: "70000000-0000-4000-8000-000000000002" }] }, now)).toEqual([]);
  });

  it("uses the latest non-draft and closes only known pending threads with Gmail SENT proof", async () => {
    const { client } = fixture({
      thread: [msg("draft", "thread", ownEmail, 0, ["DRAFT"]), msg("sent", "thread", ownEmail, 1, ["SENT"]), msg("original")],
      newThread: [msg("old", "newThread"), msg("sent", "newThread", ownEmail, 1, ["SENT"])],
      spoof: [msg("spoofed", "spoof", ownEmail, 1, ["INBOX"]), msg("old", "spoof")],
    }, ["newThread"]);
    const rows = await readFollowupBatch(client, { ...ctx, pendingThreads: ["thread", "spoof"] }, now);
    expect(rows).toEqual([{ kind: "reply", threadId: "thread", messageId: "sent", at: new Date(at(1,23)).toISOString() }]);
  });

  it("does not fall back to older inbound when the latest message is excluded or its date is ambiguous", async () => {
    const { client } = fixture({ thread: [msg("old"), msg("new", "thread", sender, 3, ["INBOX", "CATEGORY_PROMOTIONS"])],
      tie: [msg("old", "tie"), msg("new", "tie")] });
    expect(await readFollowupBatch(client, ctx, now)).toEqual([]);
  });

  it("respects the later 30-day window and case-insensitive exact match", async () => {
    const { client } = fixture({ thread: [msg("m", "thread", sender.toUpperCase(), 30, ["INBOX"], { "Auto-Submitted": "no" })],
      old: [msg("m", "old", sender, 31)] });
    expect((await readFollowupBatch(client, { ...ctx, windowDays: 30 }, now)).map((r) => r.threadId)).toEqual(["thread"]);
  });

  it("enforces 40 new and 20 pending reads even for an oversized listing", async () => {
    const ids = Array.from({ length: 70 }, (_, n) => `new${n}`);
    const pending = Array.from({ length: 20 }, (_, n) => `pending${n}`);
    const { client, request } = fixture(Object.fromEntries([...ids, ...pending].map((id) => [id, [msg("m", id)]])), ids);
    expect(await readFollowupBatch(client, { ...ctx, pendingThreads: pending }, now)).toHaveLength(40);
    expect(request).toHaveBeenCalledTimes(61);
  });

  it("rejects an oversized thread and a context without read scope", async () => {
    const { client, request } = fixture({ thread: Array.from({ length: 201 }, (_, n) => ({ ...msg(`m${n}`), internalDate: String(at(5,23)+n) })) });
    expect(await readFollowupBatch(client, ctx, now)).toEqual([]);
    request.mockClear();
    await expect(readFollowupBatch({ ...client, scopes: [] }, ctx, now)).rejects.toMatchObject({ code: "permission" });
    expect(request).not.toHaveBeenCalled();
  });

  it("does not start a provider request with no budget", async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    const { client, request } = fixture({ thread: [msg("m")] });
    await expect(readFollowupBatch(client, ctx, now, now.getTime() + 19_999)).rejects.toBeInstanceOf(FollowupDeadlineError);
    expect(request).not.toHaveBeenCalled();
  });

  it("rejects late final metadata rather than publishing a partial batch", async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    const { client, request } = fixture({ thread: [msg("m")] });
    request.mockImplementationOnce(async () => ({ threads: [{ id: "thread" }] }))
      .mockImplementationOnce(async () => {
        vi.setSystemTime(now.getTime() + 60_001); return JSON.stringify({ id: "thread", messages: [msg("m")] });
      });
    await expect(readFollowupBatch(client, ctx, now, now.getTime() + 60_000)).rejects.toBeInstanceOf(FollowupDeadlineError);
  });

  it("normalizes only contract keys, drops invalid rows and caps 60 unique observations", () => {
    const good: FollowupRow = { kind: "inbound", threadId: "good", messageId: "m", at: new Date(at(5)).toISOString(), sender, personId };
    const input = [
      { ...good, threadId: "bad/id" }, { ...good, messageId: "bad/id" }, { ...good, at: "invalid" },
      { ...good, at: new Date(at(-1)).toISOString() }, { ...good, sender: `${"x".repeat(255)}@external.synthetic.test` },
      { ...good, personId: "not-uuid" }, { ...good, sender: "invalid" },
      { ...good, at: new Date(at(4)).toISOString() }, { ...good, at: new Date(at(15)).toISOString() },
      { ...good, sender: sender.toUpperCase(), extra: "not serialized" }, good,
      ...Array.from({ length: 70 }, (_, n) => ({ ...good, threadId: `extra${n}` })),
    ];
    const rows = normalizeFollowupRows(input, now, 14);
    expect(rows).toHaveLength(60);
    expect(rows[0]).toEqual(good);
    expect(rows[1].threadId).toBe("extra0");
    expect(rows.at(-1)?.threadId).toBe("extra58");
  });
});

it("skips oversized or malformed metadata without losing a valid thread", async () => {
  const { client, request } = fixture({ big: [], malformed: [], good: [msg("ok", "good")] });
  const original = request.getMockImplementation()!;
  request.mockImplementation((service, path) => {
    if (path.startsWith("/threads/big?")) return Promise.reject(new Error("File exceeds the processing size limit."));
    if (path.startsWith("/threads/malformed?")) return Promise.resolve("{not-json");
    return original(service, path);
  });
  expect((await readFollowupBatch(client, ctx, now)).map((row) => row.threadId)).toEqual(["good"]);
});

it("never emits future or invalid reply observations", () => {
  const reply: FollowupRow = { kind: "reply", threadId: "thread", messageId: "sent", at: new Date(at(-1)).toISOString() };
  expect(normalizeFollowupRows([reply, { ...reply, threadId: "invalid", at: "not-a-date" }], now, 30)).toEqual([]);
});
it("does not start thread requests when the listing uses the remaining reader budget", async () => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  const { client, request } = fixture({ thread: [msg("m")] });
  request.mockImplementationOnce(async () => {
    vi.setSystemTime(now.getTime() + 50_001);
    return { threads: [{ id: "thread" }] };
  });
  await expect(readFollowupBatch(client, ctx, now, now.getTime() + 60_000)).rejects.toBeInstanceOf(FollowupDeadlineError);
  expect(request).toHaveBeenCalledTimes(1);
});

it.each(["gmail.com","outlook.com"])("permits exact CRM contacts on a shared free provider %s", async (domain) => {
  const contact = `fixture-contact@${domain}`;
  const member = `fixture-member@${domain}`;
  const { client } = fixture({ thread: [msg("m", "thread", contact)], member: [msg("m", "member", member)] });
  expect((await readFollowupBatch(client, { ...ctx, ownEmail: `fixture-owner@${domain}`,
    contacts: [contact, member].map((email) => ({ email, personId })), memberEmails: [member] }, now)).map((r) => r.kind === "inbound" ? r.sender : null))
    .toEqual([contact]);
});

it("finds a known sender behind more than forty unrelated Inbox threads", async () => {
  const crowded = Array.from({ length: 65 }, (_, n) => ({ id: `noise${n}`, sender: "unknown@external.synthetic.test" }))
    .concat({ id: "known", sender });
  const { client, request } = fixture({ known: [msg("valid", "known")] });
  const detail = request.getMockImplementation()!;
  request.mockImplementation(async (service, path, options) => {
    if (!path.startsWith("/threads?")) return detail(service, path, options);
    const q = new URL(path, "https://synthetic.test").searchParams.get("q") ?? "";
    const candidates = q.includes(`from:("${sender}")`) ? crowded.filter((t) => t.sender === sender) : crowded;
    return { threads: candidates.slice(0, 40).map(({ id }) => ({ id })) };
  });
  expect((await readFollowupBatch(client, ctx, now)).map((row) => row.threadId)).toEqual(["known"]);
});

it("uses at most eight ten-sender searches and rotates the group cursor", async () => {
  const contacts = Array.from({ length: 100 }, (_, n) => ({
    email: `person${String(n).padStart(3, "0")}@external.synthetic.test`, personId,
  }));
  const { client, request } = fixture({});
  await readFollowupBatch(client, { ...ctx, contacts, senderGroupOffset: 8 }, now);
  expect(request).toHaveBeenCalledTimes(8);
  const queries = request.mock.calls.map(([, url]) => new URL(url, "https://synthetic.test").searchParams.get("q")!);
  expect(queries[0]).toContain('from:("person080@external.synthetic.test"');
  expect(queries[2]).toContain('from:("person000@external.synthetic.test"');
  expect(queries.every((q) => (q.match(/ OR /g) ?? []).length === 9)).toBe(true);
});

it("shares the forty-detail budget across sender groups", async () => {
  const contacts = Array.from({ length: 11 }, (_, n) => ({ email: `person${String(n).padStart(2,"0")}@external.synthetic.test`, personId }));
  const ids = Array.from({ length: 40 }, (_, n) => `busy${n}`);
  const { client, request } = fixture(Object.fromEntries([...ids.map((id) => [id,[msg("m",id,contacts[0].email)]]),
    ["quiet",[msg("m","quiet",contacts[10].email)]]]));
  const detail = request.getMockImplementation()!;
  request.mockImplementation(async (service,path,options) => {
    if (!path.startsWith("/threads?")) return detail(service,path,options);
    const q = new URL(path,"https://synthetic.test").searchParams.get("q") ?? "";
    return { threads: (q.includes(contacts[10].email) ? ["quiet"] : ids).map((id) => ({ id })) };
  });
  const rows = await readFollowupBatch(client, { ...ctx, contacts }, now);
  expect(rows).toHaveLength(40);
  expect(rows.map((r) => r.threadId)).toContain("quiet");
});

it("rejects two From headers even when the first is a valid known contact", async () => {
  const duplicate = msg("m","duplicate");
  duplicate.payload.headers.push({ name: "fRoM", value: "other@external.synthetic.test" });
  const { client } = fixture({ duplicate: [duplicate], good: [msg("m","good")] });
  expect((await readFollowupBatch(client, ctx, now)).map((r) => r.threadId)).toEqual(["good"]);
});

it("counts Inbox delivery even without a direct To address (Cc or Bcc)", async () => {
  const cc = msg("m","cc",sender,5,["INBOX"],{ To: "another@external.synthetic.test", Cc: ownEmail });
  const bcc = msg("m","bcc",sender,5,["INBOX"],{ To: "another@external.synthetic.test" });
  const { client } = fixture({ cc:[cc],bcc:[bcc] });
  expect((await readFollowupBatch(client,ctx,now)).map((r)=>r.threadId)).toEqual(["cc","bcc"]);
});

it("keeps a 512 KB transport byte bound on one oversized thread without dropping its valid neighbor", async () => {
  const { client, request } = fixture({ big: [msg("m","big")], good: [msg("m","good")] });
  const detail = request.getMockImplementation()!;
  request.mockImplementation(async (service,url,options) => {
    if (url.startsWith("/threads/big?") && options?.responseType === "text" && options.maxBytes === 512_000)
      throw new Error("File exceeds the processing size limit.");
    return detail(service,url,options);
  });
  expect((await readFollowupBatch(client,ctx,now)).map((r)=>r.threadId)).toEqual(["good"]);
});

it("never has more than five concurrent Gmail thread reads", async () => {
  const ids = Array.from({ length: 13 }, (_, n) => `thread${n}`);
  const { client, request } = fixture(Object.fromEntries(ids.map((id) => [id,[msg("m",id)]])));
  const detail = request.getMockImplementation()!;
  let active = 0;
  let peak = 0;
  request.mockImplementation(async (service,path,options) => {
    if (path.startsWith("/threads?")) return detail(service,path,options);
    peak = Math.max(peak,++active);
    await Promise.resolve();
    active--;
    return detail(service,path,options);
  });
  expect(await readFollowupBatch(client,ctx,now)).toHaveLength(13);
  expect(peak).toBe(5);
});

it("keeps the SQL free-provider mirror aligned with the shared scouting list", () => {
  const sql = readFileSync("supabase/migrations/20261107100000_unanswered_email_reminders.sql","utf8");
  const list = sql.match(/own_domain<>all\(array\[([^\]]+)\]\)/)?.[1] ?? "";
  expect(list.split(",").map((value) => value.replaceAll("'","")).sort()).toEqual([...FREE_MAIL_DOMAINS].sort());
});

it("does not put malformed quoted mailbox atoms into a Gmail query", async () => {
  const { client, request } = fixture({});
  await readFollowupBatch(client,{ ...ctx, contacts:[...ctx.contacts, { email:'mal"formed@external.synthetic.test',personId }] },now);
  expect(request).toHaveBeenCalledTimes(1);
  expect(new URL(request.mock.calls[0][1],"https://synthetic.test").searchParams.get("q")).toContain(`from:("${sender}")`);
});

it("stops at forty candidate reads even mid-round across three full sender groups", async () => {
  const contacts = Array.from({ length:21 }, (_, n) => ({ email:`contact${String(n).padStart(2,"0")}@external.synthetic.test`,personId }));
  const threads = Object.fromEntries([0,10,20].flatMap((group) => Array.from({length:40},(_,n) => {
    const id = `g${group}t${n}`;
    return [id,[msg("m",id,contacts[group].email)]];
  })));
  const { client,request } = fixture(threads);
  const detail = request.getMockImplementation()!;
  request.mockImplementation(async (service,path,options) => {
    if (!path.startsWith("/threads?")) return detail(service,path,options);
    const q = new URL(path,"https://synthetic.test").searchParams.get("q") ?? "";
    const group = [0,10,20].find((index) => q.includes(contacts[index].email))!;
    return { threads: Array.from({length:40},(_,n)=>({ id:`g${group}t${n}` })) };
  });
  expect(await readFollowupBatch(client,{ ...ctx,contacts },now)).toHaveLength(40);
  expect(request).toHaveBeenCalledTimes(43);
});
