import { createHash } from "node:crypto";

export function mailOpenOrigin() {
  const configured = process.env.MAIL_OPEN_SIGNAL_ORIGIN;
  if (!configured) return null;
  try {
    const url = new URL(configured);
    return url.protocol === "https:" && url.origin === configured ? url.origin : null;
  } catch { return null; }
}

export function mailOpenDigest(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function appendMailOpenPixel(html: string, origin: string, token: string) {
  if (new URL(origin).origin !== origin || !origin.startsWith("https://") || !/^[a-f0-9]{64}$/.test(token)) throw Error("Invalid tracking pixel");
  return `${html}<img src="${origin}/api/mail/open/${token}/pixel.gif" width="1" height="1" alt="">`;
}
