import { decodeJwt } from "jose";
import type { Session, SupabaseClient } from "@supabase/supabase-js";

export class WorkerIdentityError extends Error {}
export type WorkerCredentials = { email: string; password: string; userId: string };
export function workerCredentials(env: Readonly<Record<string, string | undefined>>): WorkerCredentials {
  const email = env.SUPABASE_WORKER_EMAIL?.trim();
  const password = env.SUPABASE_WORKER_PASSWORD;
  const userId = env.SUPABASE_WORKER_USER_ID;
  if (!email || !password || !userId || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(userId)) {
    throw new WorkerIdentityError("Worker Auth email, password and expected user UUID are required.");
  }
  return { email, password, userId };
}
export function validateWorkerSession(session: Session | null, expected: WorkerCredentials, now = Date.now()): Session {
  try {
    if (!session || session.user.id !== expected.userId || session.user.email?.toLowerCase() !== expected.email.toLowerCase()) throw new Error();
    const claims = decodeJwt(session.access_token);
    if (claims.sub !== expected.userId || claims.role !== "authenticated" || typeof claims.exp !== "number" || !Number.isFinite(claims.exp) || claims.exp <= now / 1000) throw new Error();
    return session;
  } catch { throw new WorkerIdentityError("Worker Auth session is invalid, expired or belongs to another identity."); }
}
export async function signInWorker(db: SupabaseClient, credentials: WorkerCredentials) {
  const { data, error } = await db.auth.signInWithPassword({ email: credentials.email, password: credentials.password });
  if (error) throw new WorkerIdentityError("Worker Auth sign-in failed.");
  validateWorkerSession(data.session, credentials);
}
export async function renewWorkerSession(db: SupabaseClient, credentials: WorkerCredentials, now = Date.now()) {
  const { data, error } = await db.auth.getSession();
  if (error) throw new WorkerIdentityError("Worker Auth session unavailable.");
  // Refresh an expiring session rather than persisting credentials or tokens.
  const session = validateWorkerSession(data.session, credentials, now);
  let expiry: unknown;
  try { expiry = session ? decodeJwt(session.access_token).exp : undefined; } catch { /* fails closed below */ }
  if (session && typeof expiry === "number" && expiry > now / 1000 && expiry <= now / 1000 + 120) {
    const refreshed = await db.auth.refreshSession();
    if (refreshed.error) throw new WorkerIdentityError("Worker Auth refresh failed; stop and sign in again.");
    validateWorkerSession(refreshed.data.session, credentials, now);
  } else validateWorkerSession(session, credentials, now);
}

export function validateWorkerApiKey(key: string) {
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return;
  try { if (decodeJwt(key).role === "anon") return; } catch { /* reject below */ }
  throw new WorkerIdentityError("Worker requires an anon or publishable API key; secret/service-role keys are forbidden.");
}
