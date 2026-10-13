import {describe,it,expect,vi} from "vitest";
import {POST} from "./route";
const spy=vi.fn();
vi.mock("@supabase/supabase-js",()=>({createClient:spy}));
describe("Gmail push is disabled",()=>{
 it("returns 503 even when old push credentials are configured, without initializing Supabase",async()=>{
  vi.stubEnv("GMAIL_PUSH_JWT","synthetic-old-token");vi.stubEnv("GMAIL_PUSH_AUDIENCE","https://fixture.test");
  try{const result=await POST();expect(result.status).toBe(503);expect(await result.json()).toEqual({error:"Gmail push is disabled; use polling."});expect(spy).not.toHaveBeenCalled();}finally{vi.unstubAllEnvs();}
 });
});
