import { afterEach,it,expect,vi } from "vitest";
import { buildGoogleAuthUrl } from "./google-oauth";
afterEach(()=>vi.unstubAllEnvs());
function scopes(drive?:"read"|"write") {vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID","fixture");return new URL(buildGoogleAuthUrl({redirectUri:"https://fixture.example/callback",state:"fixture",drive})).searchParams.get("scope")!.split(" ");}
it("ordinary connection never requests full Drive write",()=>{expect(scopes()).not.toContain("https://www.googleapis.com/auth/drive");});
it("Drive import and monitoring request readonly only",()=>{const requested=scopes("read");expect(requested).toContain("https://www.googleapis.com/auth/drive.readonly");expect(requested).not.toContain("https://www.googleapis.com/auth/drive");});
it("only explicit rename/move consent requests full Drive",()=>expect(scopes("write")).toContain("https://www.googleapis.com/auth/drive"));
