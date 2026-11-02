import { describe, expect, it } from "vitest";
import { viewHref } from "@/lib/views/queries";
import { listAriaSort, nextListSort, parseListSort, sortListRows, withListSort } from "./list-sort";

const KEYS = ["name", "company", "email"] as const;

describe("parseListSort", () => {
  it("accepts whitelisted keys and directions", () => {
    expect(parseListSort(KEYS, "name", "desc")).toEqual({ key: "name", dir: "desc" });
    expect(parseListSort(KEYS, "email", "asc")).toEqual({ key: "email", dir: "asc" });
  });

  it("defaults to ascending when dir is missing", () => {
    expect(parseListSort(KEYS, "company", undefined)).toEqual({ key: "company", dir: "asc" });
  });

  it("ignores unknown keys, bad directions and odd shapes", () => {
    expect(parseListSort(KEYS, "last_email", "asc")).toBeNull();
    expect(parseListSort(KEYS, "name; drop table people", "asc")).toBeNull();
    expect(parseListSort(KEYS, "NAME", "asc")).toBeNull();
    expect(parseListSort(KEYS, "name", "sideways")).toBeNull();
    expect(parseListSort(KEYS, "name", ["asc", "desc"])).toBeNull();
    expect(parseListSort(KEYS, ["name", "email"], "asc")).toBeNull();
    expect(parseListSort(KEYS, undefined, "asc")).toBeNull();
    expect(parseListSort(KEYS, "toString", "asc")).toBeNull();
    expect(parseListSort(KEYS, "name", "asc,desc")).toBeNull();
  });

  it("treats an empty dir as ascending", () => {
    expect(parseListSort(KEYS, "name", "")).toEqual({ key: "name", dir: "asc" });
  });
});

describe("nextListSort", () => {
  it("cycles ascending, descending, off", () => {
    const first = nextListSort(null, "name");
    expect(first).toEqual({ key: "name", dir: "asc" });
    const second = nextListSort(first, "name");
    expect(second).toEqual({ key: "name", dir: "desc" });
    expect(nextListSort(second, "name")).toBeNull();
  });

  it("starts a different column ascending", () => {
    expect(nextListSort({ key: "name", dir: "desc" }, "email")).toEqual({ key: "email", dir: "asc" });
  });
});

describe("withListSort", () => {
  const filters = { view: "lps" as const, groupId: "g 1", q: "ana maría", cols: ["company", "email"] as ("company" | "email")[] };

  it("keeps every other parameter", () => {
    const base = viewHref("/people", filters);
    const href = withListSort(base, { key: "name", dir: "desc" });
    const params = new URL(href, "http://x").searchParams;
    expect(params.get("view")).toBe("lps");
    expect(params.get("group")).toBe("g 1");
    expect(params.get("q")).toBe("ana maría");
    expect(params.get("cols")).toBe("1");
    expect(params.getAll("col")).toEqual(["company", "email"]);
    expect(params.get("sort")).toBe("name");
    expect(params.get("dir")).toBe("desc");
  });

  it("does not confuse an encoded &sort= inside q with the real sort", () => {
    const base = viewHref("/people", { view: "all", groupId: null, q: "a&sort=email&dir=desc", cols: null });
    const params = new URL(withListSort(base, { key: "name", dir: "asc" }), "http://x").searchParams;
    expect(params.get("q")).toBe("a&sort=email&dir=desc");
    expect(params.getAll("sort")).toEqual(["name"]);
    expect(params.getAll("dir")).toEqual(["asc"]);
  });

  it("replaces an earlier sort and removes it when off", () => {
    const sorted = withListSort("/people?view=lps", { key: "name", dir: "asc" });
    expect(withListSort(sorted, { key: "email", dir: "desc" })).toBe("/people?view=lps&sort=email&dir=desc");
    expect(withListSort(sorted, null)).toBe("/people?view=lps");
    expect(withListSort("/people", null)).toBe("/people");
  });

  it("saved-view links stay as they are (no sort)", () => {
    expect(viewHref("/people", { view: "all", groupId: null, q: null, cols: null })).toBe("/people");
  });
});

describe("listAriaSort", () => {
  it("is set only on the active column", () => {
    expect(listAriaSort({ key: "name", dir: "asc" }, "name")).toBe("ascending");
    expect(listAriaSort({ key: "name", dir: "desc" }, "name")).toBe("descending");
    expect(listAriaSort({ key: "name", dir: "desc" }, "email")).toBeUndefined();
    expect(listAriaSort(null, "name")).toBeUndefined();
  });
});

describe("sortListRows", () => {
  type Row = { id: string; name: string | null };
  const rows: Row[] = [
    { id: "5", name: "zoe" },
    { id: "2", name: "Álvaro" },
    { id: "4", name: null },
    { id: "1", name: "alvaro" },
    { id: "3", name: "  " },
    { id: "6", name: "Beto" },
  ];
  const run = (dir: "asc" | "desc") =>
    sortListRows(rows, { key: "name" as const, dir }, (r) => r.name, (r) => r.id).map((r) => r.id);

  it("ignores case and accents, breaks ties by id, empties last", () => {
    expect(run("asc")).toEqual(["1", "2", "6", "5", "3", "4"]);
  });

  it("puts empties last when descending too, ties still by id", () => {
    expect(run("desc")).toEqual(["5", "6", "1", "2", "3", "4"]);
  });

  it("is a copy: no sort returns the same order and input is untouched", () => {
    const before = rows.map((r) => r.id);
    expect(sortListRows(rows, null, (r) => r.name, (r) => r.id).map((r) => r.id)).toEqual(before);
    run("asc");
    expect(rows.map((r) => r.id)).toEqual(before);
  });
});
