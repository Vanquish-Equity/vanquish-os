import {createRemoteJWKSet,jwtVerify} from "jose";
const keys=createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"),{timeoutDuration:5000});
export async function verifyGmailPush(token:string,audience:string,serviceAccount:string) {
  if(!token||token.length>16000||!audience||!serviceAccount)return false;
  try {
    const {payload}=await jwtVerify(token,keys,{issuer:["https://accounts.google.com","accounts.google.com"],audience,algorithms:["RS256"],requiredClaims:["exp","iat"]});
    return payload.email===serviceAccount&&payload.email_verified===true;
  }catch{return false;}
}
