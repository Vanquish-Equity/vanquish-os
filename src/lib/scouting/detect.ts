// Turns mailbox headers into "companies you talk to that aren't in the CRM
// yet". Pure: no Google or database calls, so it is unit-tested directly.

export type ScoutMessage = { threadId: string; at: string; from: string; to: string; cc: string };
export type ScoutContact = { email: string; name: string };
export type DetectedCompany = {
  domain: string;
  suggestedName: string;
  threadCount: number;
  twoWay: boolean;
  firstSeen: string;
  lastSeen: string;
  contacts: ScoutContact[];
};

// Personal mailbox providers never stand for a company.
export const FREE_MAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com",
  "yahoo.com", "ymail.com", "icloud.com", "me.com", "mac.com", "aol.com", "proton.me",
  "protonmail.com", "gmx.com", "gmx.net", "zoho.com", "yandex.com", "mail.com",
  "hotmail.es", "yahoo.es", "outlook.es", "live.com.mx", "hotmail.co.uk", "yahoo.co.uk",
]);

// Automated senders: they don't make a relationship.
const AUTOMATED = /^(no-?reply|do-?not-?reply|notifications?|mailer-daemon|postmaster|bounce[s]?|alerts?|news(letter)?|marketing|updates?|billing|invoices?|receipts?|support|help|info|hello|team|calendar-notification)([+._-].*)?$/i;

const SECOND_LEVEL = new Set(["co", "com", "org", "net", "ac", "gov", "edu", "or", "ne", "go"]);

// "mail.acme.co.uk" -> "acme.co.uk"; "eu.acme.com" -> "acme.com".
export function registrableDomain(host: string) {
  const labels = host.toLowerCase().replace(/\.$/, "").split(".").filter(Boolean);
  if (labels.length <= 2) return labels.join(".");
  const tld = labels[labels.length - 1];
  const second = labels[labels.length - 2];
  const take = tld.length === 2 && SECOND_LEVEL.has(second) ? 3 : 2;
  return labels.slice(-take).join(".");
}

export function suggestedNameFor(domain: string) {
  const labels = domain.split(".");
  const base = labels.length >= 3 && SECOND_LEVEL.has(labels[labels.length - 2]) ? labels[labels.length - 3] : labels[0];
  return base
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

// Parses "Ana Pérez <ana@acme.com>, bo@acme.com" into names and emails.
export function parseNamedAddresses(header: string): ScoutContact[] {
  const result: ScoutContact[] = [];
  const pattern = /(?:"([^"]*)"|([^,<"]*?))\s*<([^<>\s]+@[^<>\s]+)>|([^\s,<>"]+@[^\s,<>"]+)/g;
  for (const match of header.matchAll(pattern)) {
    const email = (match[3] ?? match[4] ?? "").trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) continue;
    const name = (match[1] ?? match[2] ?? "").trim().replace(/^'+|'+$/g, "");
    result.push({ email, name: name.includes("@") ? "" : name });
  }
  return result;
}

export function detectCompanies(
  messages: ScoutMessage[],
  options: { ownEmail: string; excludedDomains: Set<string>; knownEmails: Set<string> },
): DetectedCompany[] {
  const own = options.ownEmail.toLowerCase();
  const ownDomain = registrableDomain(own.split("@")[1] ?? "");
  type Bucket = {
    threads: Set<string>;
    fromMe: boolean;
    fromThem: boolean;
    first: string;
    last: string;
    contacts: Map<string, { name: string; count: number }>;
  };
  const buckets = new Map<string, Bucket>();

  for (const message of messages) {
    const at = new Date(Date.parse(message.at)).toISOString();
    if (at === "Invalid Date") continue;
    const sender = parseNamedAddresses(message.from)[0];
    const fromMe = sender?.email === own;
    const participants = [
      ...(sender ? [{ ...sender, isSender: true }] : []),
      ...parseNamedAddresses(`${message.to}, ${message.cc}`).map((contact) => ({ ...contact, isSender: false })),
    ];
    for (const person of participants) {
      const [local, host] = person.email.split("@");
      if (!host || person.email === own || AUTOMATED.test(local)) continue;
      const domain = registrableDomain(host);
      if (!domain.includes(".") || domain === ownDomain || FREE_MAIL_DOMAINS.has(domain) || options.excludedDomains.has(domain)) continue;
      const bucket = buckets.get(domain) ?? {
        threads: new Set<string>(),
        fromMe: false,
        fromThem: false,
        first: at,
        last: at,
        contacts: new Map(),
      };
      bucket.threads.add(message.threadId);
      if (fromMe) bucket.fromMe = true;
      if (person.isSender) bucket.fromThem = true;
      if (at < bucket.first) bucket.first = at;
      if (at > bucket.last) bucket.last = at;
      const contact = bucket.contacts.get(person.email) ?? { name: "", count: 0 };
      contact.count += 1;
      if (!contact.name && person.name) contact.name = person.name;
      bucket.contacts.set(person.email, contact);
      buckets.set(domain, bucket);
    }
  }

  const result: DetectedCompany[] = [];
  for (const [domain, bucket] of buckets) {
    // Anyone already in People means the company is known to the CRM.
    if ([...bucket.contacts.keys()].some((email) => options.knownEmails.has(email))) continue;
    const twoWay = bucket.fromMe && bucket.fromThem;
    if (!twoWay && bucket.threads.size < 2) continue;
    result.push({
      domain,
      suggestedName: suggestedNameFor(domain),
      threadCount: bucket.threads.size,
      twoWay,
      firstSeen: bucket.first,
      lastSeen: bucket.last,
      contacts: [...bucket.contacts.entries()]
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 10)
        .map(([email, contact]) => ({ email, name: contact.name })),
    });
  }
  return result.sort(
    (a, b) => Number(b.twoWay) - Number(a.twoWay) || b.threadCount - a.threadCount || b.lastSeen.localeCompare(a.lastSeen),
  );
}

// Domain of a company website ("https://www.acme.com/about" -> "acme.com").
export function websiteDomain(website: string | null) {
  if (!website) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`);
    return registrableDomain(url.hostname.replace(/^www\./, ""));
  } catch {
    return null;
  }
}
