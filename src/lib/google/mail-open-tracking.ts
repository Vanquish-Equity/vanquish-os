import { createHash, randomBytes } from "node:crypto";

export function mailTrackingOrigin() {
  try {
    const url = new URL(process.env.MAIL_TRACKING_ORIGIN ?? "");
    return url.protocol === "https:" && url.href === url.origin + "/" ? url.origin : null;
  } catch {
    return null;
  }
}

export function trackingHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function createOpenPixel(origin: string) {
  const token = randomBytes(32).toString("base64url");
  return {
    hash: trackingHash(token),
    html: `<img src="${origin}/api/mail/open/${token}/pixel.gif" width="1" height="1" alt="">`,
  };
}

export function suspectedAutomatedOpen(userAgent: string) {
  return /bot|crawl|scanner|prefetch|applemail/i.test(userAgent);
}
