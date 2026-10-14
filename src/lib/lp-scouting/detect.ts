import {
  parseNamedAddresses,
  registrableDomain,
  FREE_MAIL_DOMAINS,
} from "../scouting/detect";
export type Keyword = {
  phrase: string;
  kind: "mail" | "calendar";
  strong: boolean;
  enabled?: boolean;
};
export type Evidence = {
  id: string;
  threadId: string;
  at: string;
  email: string;
  name: string;
  direction: "outbound" | "reply" | "meeting";
  strong: boolean;
  metadata?: string;
  contacts?: { email: string; name: string }[];
};
export type DetectionContext = {
  mailboxAddress: string;
  ignoredDomains: string[];
  internalDomains: string[];
  knownDomains: string[];
  keywords: Keyword[];
  shareMetadata: boolean;
};
const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
const automatic =
  /^(no-?reply|notifications?|mailer-daemon|postmaster|bounce[s]?|newsletter|marketing|billing|support)([+._-]|$)/i;
function external(email: string, c: DetectionContext) {
  const [local, host] = email.toLowerCase().split("@");
  const ownDomain = registrableDomain(c.mailboxAddress.split("@")[1] ?? "");
  return Boolean(
    email.length <= 254 &&
    host &&
    email.toLowerCase() !== c.mailboxAddress.toLowerCase() &&
    !automatic.test(local) &&
    (FREE_MAIL_DOMAINS.has(ownDomain) ||
      registrableDomain(host) !== ownDomain) &&
    ![
      ...c.ignoredDomains,
      ...c.internalDomains.filter((d) => !FREE_MAIL_DOMAINS.has(d)),
    ].some(
      (d) =>
        host === d || host.endsWith(`.${d}`) || registrableDomain(host) === d,
    ),
  );
}
function terms(text: string, kind: Keyword["kind"], c: DetectionContext) {
  const words = ` ${normalize(text).replace(/[^a-z0-9]+/g, " ")} `;
  return c.keywords.filter(
    (k) =>
      k.enabled !== false &&
      k.kind === kind &&
      words.includes(` ${normalize(k.phrase).replace(/[^a-z0-9]+/g, " ")} `),
  );
}
function known(email: string, c: DetectionContext) {
  return c.knownDomains.includes(registrableDomain(email.split("@")[1] ?? ""));
}
export function detectMail(
  m: {
    id: string;
    threadId: string;
    at: string;
    from: string;
    to: string;
    subject: string;
    filenames: string[];
    sent: boolean;
    excluded?: boolean;
    deliveredTo?: string;
  },
  c: DetectionContext,
): Evidence[] {
  if (m.excluded || !Number.isFinite(Date.parse(m.at))) return [];
  const sender = parseNamedAddresses(m.from)[0];
  if (!sender) return [];
  const recipients = parseNamedAddresses(m.to),
    outbound = sender.email === c.mailboxAddress.toLowerCase() || m.sent;
  if (!outbound) {
    if (
      !external(sender.email, c) ||
      (!recipients.some((p) => p.email === c.mailboxAddress.toLowerCase()) &&
        m.deliveredTo?.toLowerCase() !== c.mailboxAddress.toLowerCase())
    )
      return [];
    return [
      {
        id: m.id,
        threadId: m.threadId,
        at: m.at,
        ...sender,
        direction: "reply",
        strong: false,
      },
    ];
  }
  const found = terms([m.subject, ...m.filenames].join(" "), "mail", c);
  if (!found.length) return [];
  const strong = found.some((k) => k.strong);
  return recipients
    .filter(
      (p) =>
        p.email !== sender.email &&
        external(p.email, c) &&
        (!known(p.email, c) || strong),
    )
    .slice(0, 10)
    .map((p) => ({
      id: m.id,
      threadId: m.threadId,
      at: m.at,
      ...p,
      name: p.name.slice(0, 200),
      direction: "outbound",
      strong,
      metadata: c.shareMetadata
        ? [m.subject, ...m.filenames].join(" · ").slice(0, 500)
        : undefined,
      contacts: FREE_MAIL_DOMAINS.has(p.email.split("@")[1])
        ? []
        : recipients
            .filter(
              (other) =>
                other.email !== p.email &&
                external(other.email, c) &&
                other.email.split("@")[1] === p.email.split("@")[1],
            )
            .slice(0, 10)
            .map((other) => ({
              ...other,
              name: (other.name || other.email).slice(0, 200),
            })),
    }));
}
export function detectMeeting(
  e: {
    id: string;
    at: string;
    title: string;
    cancelled: boolean;
    declined: boolean;
    contacts: { email: string; name: string; declined?: boolean }[];
  },
  c: DetectionContext,
): Evidence[] {
  if (e.cancelled || e.declined || !Number.isFinite(Date.parse(e.at)))
    return [];
  const found = terms(e.title, "calendar", c);
  if (!found.length) return [];
  const strong = found.some((k) => k.strong);
  return e.contacts
    .filter(
      (p) =>
        !p.declined && external(p.email, c) && (!known(p.email, c) || strong),
    )
    .slice(0, 20)
    .map((p) => ({
      id: e.id,
      threadId: e.id,
      at: e.at,
      email: p.email.toLowerCase(),
      name: p.name,
      direction: "meeting",
      strong,
      metadata: c.shareMetadata ? e.title.slice(0, 500) : undefined,
    }));
}
