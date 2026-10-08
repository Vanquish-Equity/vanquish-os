import { describe,it,expect } from "vitest";
import { warmPaths } from "./paths";
describe("warm introduction evidence",()=>{
  it("counts distinct days, not duplicate email and meeting records",()=>{
    const rows=[{person_id:"p",member_email:"a",kind:"email",last_at:"2026-10-01T12:00:00Z"},{person_id:"p",member_email:"a",kind:"meeting",last_at:"2026-10-01T15:00:00Z"}];
    expect(warmPaths(rows,new Date("2026-10-08T00:00:00Z"))).toEqual([{personId:"p",member:"a",days:1,lastAt:"2026-10-01T15:00:00Z",strength:"recent"}]);
  });
  it("keeps old relationships historical and discards invalid timestamps",()=>{
    expect(warmPaths([{person_id:"p",member_email:"a",kind:"email",last_at:"2025-01-01T00:00:00Z"},{person_id:"p",member_email:"b",kind:"email",last_at:"invalid"}],new Date("2026-10-08"))).toHaveLength(1);
    expect(warmPaths([{person_id:"p",member_email:"a",kind:"email",last_at:"2025-01-01T00:00:00Z"}],new Date("2026-10-08"))[0].strength).toBe("historical");
  });
});
