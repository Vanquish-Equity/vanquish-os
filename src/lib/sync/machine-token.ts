import { decodeJwt } from "jose";

// Preflight only: Supabase verifies the signature and trusted issuer. Do not log
// this token or claim values. A one-day ceiling also applies to the push role.
export const MAX_MACHINE_TOKEN_DAYS = 1;
export class MachineTokenError extends Error {}
export function requireMachineToken(token: string, role: "vanquish_worker" | "vanquish_gmail_push", now = Date.now()) {
  let claims;
  try { claims = decodeJwt(token); } catch { throw new MachineTokenError("Machine JWT is malformed."); }
  if (claims.role !== role) throw new MachineTokenError(`Machine JWT must use role ${role}.`);
  if (typeof claims.exp !== "number" || !Number.isFinite(claims.exp)) throw new MachineTokenError("Machine JWT requires an exp claim.");
  const remaining = claims.exp - now / 1000;
  if (remaining <= 0) throw new MachineTokenError("Machine JWT has expired; rotate it in the secret manager.");
  if (remaining > MAX_MACHINE_TOKEN_DAYS * 86400) throw new MachineTokenError(`Machine JWT must expire within ${MAX_MACHINE_TOKEN_DAYS} day; issue a short-lived replacement.`);
}
