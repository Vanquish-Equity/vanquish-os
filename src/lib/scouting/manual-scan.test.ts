import { beforeEach, expect, it, vi } from "vitest";
import { configureCompanyScouting, maybeScanMailbox, scanMailboxNow } from "./actions";
const { getAccess, createClient, rpc, googleClient, readCompanyScan, revalidatePath } = vi.hoisted(() => ({
 getAccess: vi.fn(), createClient: vi.fn(), rpc: vi.fn(), googleClient: vi.fn(), readCompanyScan: vi.fn(), revalidatePath: vi.fn(),
}));
vi.mock("@/lib/auth/access",()=>({getAccess}));
vi.mock("@/lib/supabase/server",()=>({createClient}));
vi.mock("@/lib/google/client",()=>({googleClient,GoogleError:class extends Error {}}));
vi.mock("@/lib/scouting/reader",()=>({readCompanyScan}));
vi.mock("next/cache",()=>({revalidatePath}));
const job={id:"10000000-0000-4000-8000-000000000001",lease:"10000000-0000-4000-8000-000000000002"};
beforeEach(()=>{
 vi.resetAllMocks();getAccess.mockResolvedValue({status:"member",email:"owner@synthetic.test"});
 const query={select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),maybeSingle:vi.fn().mockResolvedValue({data:{permission:"email_scouting"}})};
 createClient.mockResolvedValue({from:()=>query,rpc});
 googleClient.mockResolvedValue({});readCompanyScan.mockResolvedValue({rows:[],capped:false});
 rpc.mockImplementation(async(name:string)=>({data:name==="claim_my_company_scan"?[job]:name==="my_company_scan_context"?{ownEmail:"owner@synthetic.test"}:2,error:null}));
});
it("browser auto-scan is neutralized without querying Google or the database",async()=>{
 expect(await maybeScanMailbox()).toEqual({scanned:false});expect(createClient).not.toHaveBeenCalled();expect(googleClient).not.toHaveBeenCalled();
});
it("manual scan acquires, reads and commits the shared lease",async()=>{
 expect(await scanMailboxNow()).toMatchObject({ok:true,message:"2 new suggestions."});
 expect(rpc.mock.calls.map(([name])=>name)).toEqual(["claim_my_company_scan","my_company_scan_context","commit_my_company_scan"]);
 expect(rpc).toHaveBeenLastCalledWith("commit_my_company_scan",{p_id:job.id,p_lease:job.lease,p_rows:[],p_capped:false});
});
it("does not read Gmail if another runner holds the lease",async()=>{
 rpc.mockResolvedValue({data:[],error:null});expect(await scanMailboxNow()).toMatchObject({ok:false});expect(googleClient).not.toHaveBeenCalled();expect(readCompanyScan).not.toHaveBeenCalled();
});
it("fails closed if context authorization was withdrawn",async()=>{
 rpc.mockImplementation(async(name:string)=>name==="claim_my_company_scan"?{data:[job],error:null}:{data:null,error:{code:"42501"}});
 expect(await scanMailboxNow()).toMatchObject({ok:false});expect(readCompanyScan).not.toHaveBeenCalled();expect(rpc).toHaveBeenCalledWith("fail_my_company_scan",{p_id:job.id,p_lease:job.lease});expect(rpc).not.toHaveBeenCalledWith("commit_my_company_scan",expect.anything());
});
it("does not claim success after commit authorization is withdrawn",async()=>{
 rpc.mockImplementation(async(name:string)=>({data:name==="claim_my_company_scan"?[job]:{},error:name==="commit_my_company_scan"?{code:"42501"}:null}));
 expect(await scanMailboxNow()).toMatchObject({ok:false});expect(revalidatePath).not.toHaveBeenCalled();expect(rpc).toHaveBeenCalledWith("fail_my_company_scan",{p_id:job.id,p_lease:job.lease});
});
it("background opt-in derives the member from the session instead of sending an email",async()=>{
 expect(await configureCompanyScouting(true)).toMatchObject({ok:true});expect(rpc).toHaveBeenCalledWith("configure_company_scouting",{p_enabled:true});
});

it("shows pending administrator activation after opt-in without worker capability",async()=>{
 rpc.mockResolvedValue({data:{workerAvailable:false},error:null});
 expect(await configureCompanyScouting(true)).toMatchObject({ok:true,message:"Consent saved. Pending activation by the administrator."});
});
it("only confirms enabled when the state reports an authorized worker",async()=>{
 rpc.mockResolvedValue({data:{workerAvailable:true},error:null});
 expect(await configureCompanyScouting(true)).toMatchObject({ok:true,message:"Background company scanning enabled."});
});
it("distinguishes SQL row validation from revoked authorization and releases its lease",async()=>{
 rpc.mockImplementation(async(name:string)=>({data:name==="claim_my_company_scan"?[job]:{},error:name==="commit_my_company_scan"?{code:"22023"}:null}));
 expect(await scanMailboxNow()).toMatchObject({ok:false,message:"Scan data could not be validated. No suggestions were saved."});
 expect(rpc).toHaveBeenCalledWith("fail_my_company_scan",{p_id:job.id,p_lease:job.lease});
});
