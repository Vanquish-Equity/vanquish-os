import { describe,it,expect } from "vitest";
import { requireMachineToken } from "./machine-token";
const now=1_800_000_000_000;
function jwt(claims:object){return `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.fixture`;}
describe("machine JWT lifetime",()=>{
  it("accepts an hour-long worker token",()=>expect(()=>requireMachineToken(jwt({role:"vanquish_worker",exp:now/1000+3600}),"vanquish_worker",now)).not.toThrow());
  it.each([{}, {exp:now/1000-1}, {exp:now/1000+86401}, {exp:"tomorrow"}])("rejects absent, expired or excessive expiry",claims=>expect(()=>requireMachineToken(jwt({role:"vanquish_worker",...claims}),"vanquish_worker",now)).toThrow());
  it("rejects the worker identity at the push endpoint",()=>expect(()=>requireMachineToken(jwt({role:"vanquish_worker",exp:now/1000+3600}),"vanquish_gmail_push",now)).toThrow(/role/));
});
