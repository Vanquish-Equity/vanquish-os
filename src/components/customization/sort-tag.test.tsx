import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Definition } from "@/lib/customization/spec";
import ViewsTable, { sortTag } from "./ViewsTable";

const def = (field_type: string): Definition => ({
  id: "d1",
  name: "Synthetic field",
  field_type,
  version: 1,
  options: [],
});

describe("sortTag", () => {
  it("uses A–Z for text columns and text fields", () => {
    for (const key of ["name", "company", "email", "linkedin"]) {
      expect(sortTag(key, null, "asc")).toBe("A–Z");
      expect(sortTag(key, null, "desc")).toBe("Z–A");
    }
    expect(sortTag("cf:d1", def("text"), "asc")).toBe("A–Z");
  });

  it("uses Low–High for numbers and Old–New for dates", () => {
    expect(sortTag("cf:d1", def("number"), "asc")).toBe("Low–High");
    expect(sortTag("cf:d1", def("number"), "desc")).toBe("High–Low");
    expect(sortTag("cf:d1", def("date"), "asc")).toBe("Old–New");
    expect(sortTag("cf:d1", def("date"), "desc")).toBe("New–Old");
  });

  it("stays neutral for Stage, selects, booleans and unknown types", () => {
    for (const [key, d] of [
      ["stage", null],
      ["cf:d1", def("boolean")],
      ["cf:d1", def("single_select")],
      ["cf:d1", def("multi_select")],
      ["cf:d1", null],
      ["cf:d1", def("future_type")],
    ] as const) {
      expect(sortTag(key, d, "asc")).toBe("Asc");
      expect(sortTag(key, d, "desc")).toBe("Desc");
    }
  });

  it("labels each active header by its own column type", () => {
    const html = renderToStaticMarkup(
      <ViewsTable
        kind="people"
        columns={["name", "cf:d1"]}
        sort={{ key: "cf:d1", direction: "desc" }}
        rows={[]}
        definition={def("number")}
        partial={false}
        warning={false}
        pendingField={false}
        sortedLocally={false}
        fieldName="Synthetic field"
        onSort={() => {}}
      />,
    );
    expect(html).toContain("High–Low");
    expect(html).toContain('aria-sort="descending"');
    expect(html).toContain('aria-label="Sort by Synthetic field"');
  });
});
