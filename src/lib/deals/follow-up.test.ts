import { expect, it } from "vitest";
import { followUpReasons } from "./follow-up";

const now = Date.parse("2026-11-03T15:00:00Z");

it("does not treat an incomplete read as evidence of missing work", () => {
  expect(followUpReasons({ task: undefined, contact: undefined, now })).toEqual([]);
  expect(followUpReasons({ task: null, contact: false, now })).toEqual([
    "No next step", "No deal contact logged in 30 days",
  ]);
});

it("flags a past due task but not an open task due today", () => {
  expect(followUpReasons({ task: { due_at: "2026-11-02" }, contact: true, now })).toEqual(["Task overdue"]);
  expect(followUpReasons({ task: { due_at: "2026-11-03" }, contact: true, now })).toEqual([]);
});
