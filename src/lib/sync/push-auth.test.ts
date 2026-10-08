import { it,expect,vi,beforeAll } from "vitest";
import { generateKeyPair,exportJWK,createLocalJWKSet,SignJWT } from "jose";
const state=vi.hoisted(()=>({keys:undefined as ReturnType<typeof createLocalJWKSet> | undefined}));
vi.mock("jose",async original=>({...await original<typeof import("jose")>(),createRemoteJWKSet:()=>(...args: Parameters<ReturnType<typeof createLocalJWKSet>>)=>state.keys!(...args)}));
import { verifyGmailPush } from "./push-auth";
let key:Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];
beforeAll(async()=>{const pair=await generateKeyPair("RS256");key=pair.privateKey;state.keys=createLocalJWKSet({keys:[{...await exportJWK(pair.publicKey),kid:"test",alg:"RS256"}]});});
const audience="https://fixture.example/api/integrations/gmail/push",email="push@fixture.iam.gserviceaccount.com";
async function token(overrides:Record<string,unknown>={}){return new SignJWT({iss:"https://accounts.google.com",aud:audience,email,email_verified:true,iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+300,...overrides}).setProtectedHeader({alg:"RS256",kid:"test"}).sign(key);}
it("accepts only the configured signed Google identity",async()=>expect(await verifyGmailPush(await token(),audience,email)).toBe(true));
it.each([{iss:"https://attacker.example"},{aud:"other"},{email:"other@example.com"},{email_verified:false},{exp:1},{exp:undefined},{iat:undefined}])("rejects invalid issuer, audience, account or lifetime",async claims=>expect(await verifyGmailPush(await token(claims),audience,email)).toBe(false));
it("rejects forged and malformed tokens",async()=>{expect(await verifyGmailPush("bad",audience,email)).toBe(false);const signed=await token();expect(await verifyGmailPush(signed.slice(0,-20)+"invalid",audience,email)).toBe(false);});
