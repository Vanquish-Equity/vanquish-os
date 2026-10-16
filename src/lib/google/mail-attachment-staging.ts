import "server-only";
import { randomUUID } from "node:crypto";
import {
  MAIL_ATTACHMENT_LIMIT,
  MAIL_CHUNK_LIMIT,
} from "./mail-completion-types";
type Meta = { name: string; type: string; size: number };
type Session = {
  owner: string;
  connection: string;
  expires: number;
  files: (Meta & { chunks: Buffer[]; received: number })[];
};
// TRANSIENT RAM ONLY. Never a body cache, filesystem, shared CRM row or provider URL.
const sessions = new Map<string, Session>();
const TTL = 10 * 60 * 1000,
  GLOBAL_LIMIT = 16 * 1024 * 1024;
function erase(id: string) {
  const s = sessions.get(id);
  s?.files.forEach((f) => f.chunks.forEach((b) => b.fill(0)));
  sessions.delete(id);
}
export function cleanMailUploads(now = Date.now()) {
  for (const [id, s] of sessions) if (s.expires <= now) erase(id);
}
export function beginMailUpload(
  owner: string,
  connection: string,
  files: Meta[],
) {
  cleanMailUploads();
  if (
    !Array.isArray(files) ||
    !files.length ||
    files.length > 10 ||
    files.some(
      (f) =>
        !f ||
        typeof f.name !== "string" ||
        f.name.length > 200 ||
        /[\r\n"]/.test(f.name) ||
        typeof f.type !== "string" ||
        f.type.length > 100 ||
        !Number.isSafeInteger(f.size) ||
        f.size < 0,
    ) ||
    files.reduce((n, f) => n + f.size, 0) > MAIL_ATTACHMENT_LIMIT
  )
    throw Error("Attachment budget exceeded");
  const owned = [...sessions.values()].filter((s) => s.owner === owner);
  if (
    owned.length >= 4 ||
    owned.reduce((n, s) => n + s.files.reduce((a, f) => a + f.size, 0), 0) +
      files.reduce((n, f) => n + f.size, 0) >
      MAIL_ATTACHMENT_LIMIT ||
    [...sessions.values()].reduce(
      (n, s) => n + s.files.reduce((a, f) => a + f.size, 0),
      0,
    ) +
      files.reduce((n, f) => n + f.size, 0) >
      GLOBAL_LIMIT
  )
    throw Error("Attachment capacity reached");
  const id = randomUUID();
  sessions.set(id, {
    owner,
    connection,
    expires: Date.now() + TTL,
    files: files.map((f) => ({ ...f, chunks: [], received: 0 })),
  });
  setTimeout(() => erase(id), TTL).unref();
  return id;
}
function session(owner: string, connection: string, id: string) {
  cleanMailUploads();
  const s = sessions.get(id);
  if (!s || s.owner !== owner || s.connection !== connection)
    throw Error("Upload unavailable; select files again");
  return s;
}
export function appendMailChunk(
  owner: string,
  connection: string,
  id: string,
  index: number,
  offset: number,
  bytes: Uint8Array,
) {
  const s = session(owner, connection, id),
    f = s.files[index];
  if (
    !(bytes instanceof Uint8Array) ||
    !Number.isInteger(index) ||
    !f ||
    offset !== f.received ||
    bytes.length > MAIL_CHUNK_LIMIT ||
    !bytes.length ||
    f.received + bytes.length > f.size
  )
    throw Error("Invalid attachment chunk");
  f.chunks.push(Buffer.from(bytes));
  f.received += bytes.length;
}
export function readMailUpload(owner: string, connection: string, id: string) {
  const s = session(owner, connection, id);
  if (s.files.some((f) => f.received !== f.size))
    throw Error("Attachment upload incomplete");
  return s.files.map((f) => ({
    name: f.name,
    type: f.type,
    data: Buffer.concat(f.chunks),
  }));
}
export function releaseMailUpload(owner: string, id: string) {
  const s = sessions.get(id);
  if (s && s.owner === owner) erase(id);
}
