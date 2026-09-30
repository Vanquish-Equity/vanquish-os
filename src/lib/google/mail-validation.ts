import type { ComposeInput } from "./mail-types";
export function parseAddresses(input: string): string[] {
  if (typeof input !== "string" || input.length > 30000 || /[\r\n]/.test(input))
    throw new Error("Invalid recipients.");
  const tokens: string[] = [];
  let token = "",
    quoted = false,
    angle = false,
    escaped = false;
  for (const char of input) {
    if (escaped) {
      token += char;
      escaped = false;
      continue;
    }
    if (char === "\\" && quoted) {
      token += char;
      escaped = true;
      continue;
    }
    if (char === '"') quoted = !quoted;
    if (!quoted && char === "<") angle = true;
    if (!quoted && char === ">") angle = false;
    if (!quoted && !angle && (char === "," || char === ";")) {
      tokens.push(token);
      token = "";
    } else token += char;
  }
  if (quoted || angle) throw new Error("Invalid recipients.");
  tokens.push(token);
  const addresses = tokens
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.match(/<([^<>]+)>$/)?.[1] ?? s);
  if (
    addresses.some(
      (s) =>
        !/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(s) || s.length > 254,
    )
  )
    throw new Error("Invalid email address.");
  return [...new Set(addresses)];
}
export function validateCompose(input: ComposeInput, requireRecipients = true) {
  const to = parseAddresses(input.to),
    cc = parseAddresses(input.cc),
    bcc = parseAddresses(input.bcc);
  if (
    (requireRecipients && to.length + cc.length + bcc.length === 0) ||
    to.length + cc.length + bcc.length > 200
  )
    throw new Error("Choose between 1 and 200 recipients.");
  if (
    typeof input.subject !== "string" ||
    /[\r\n]/.test(input.subject) ||
    input.subject.length > 500 ||
    typeof input.html !== "string" ||
    input.html.length > 200000
  )
    throw new Error("Invalid message.");
  return { to, cc, bcc };
}
