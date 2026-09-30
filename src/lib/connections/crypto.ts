import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Encrypts the Google refresh token before it is ever sent to the
// database. MAILBOX_TOKEN_ENCRYPTION_KEY is a server-only secret (base64,
// decoding to 32 bytes) set in Vercel/`.env.local`, never in the database
// or the client bundle — this module must only be imported from a route
// handler or server action, never from client code.

function getKey(): Buffer {
  const raw = process.env.MAILBOX_TOKEN_ENCRYPTION_KEY;
  if (!raw) throw new Error("MAILBOX_TOKEN_ENCRYPTION_KEY is not configured.");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("MAILBOX_TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes.");
  return key;
}

export type EncryptedToken = { encrypted: string; iv: string; tag: string };

export function encryptToken(plaintext: string): EncryptedToken {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return { encrypted: encrypted.toString("base64"), iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64") };
}

export function decryptToken({ encrypted, iv, tag }: EncryptedToken): string {
  const decipher = createDecipheriv("aes-256-gcm", getKey(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64")), decipher.final()]).toString("utf8");
}
