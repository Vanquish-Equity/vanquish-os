import { expect, it } from "vitest";
import { matchesPeopleFieldFilters } from "./grid-fields";
import type { FieldValue } from "@/lib/custom-fields/model";

it("matches any label within a column and requires a match in every filtered column", () => {
  const tags = (multi_value: string[]) => ({ is_set: true, multi_value }) as FieldValue;
  const filters = new Map([["industry", new Set(["healthcare", "tech"])]]);
  for (const option of ["healthcare", "tech"]) {
    expect(matchesPeopleFieldFilters(new Map([["industry", tags([option])]]), filters)).toBe(true);
  }
  expect(matchesPeopleFieldFilters(new Map([["industry", tags(["energy"])]]), filters)).toBe(false);
  filters.set("region", new Set(["americas"]));
  expect(matchesPeopleFieldFilters(new Map([["industry", tags(["tech"])]]), filters)).toBe(false);
  expect(matchesPeopleFieldFilters(new Map([["industry", tags(["tech"])], ["region", tags(["americas"])]]), filters)).toBe(true);
});
