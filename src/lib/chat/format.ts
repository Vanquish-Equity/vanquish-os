// Pure helpers for chat: names, conversation titles and explicit mentions.

export type DirectoryEntry = { email: string; name: string; active: boolean };
export type Directory = Map<string, DirectoryEntry>;

export function toDirectory(rows: { email: string; display_name: string | null; is_active: boolean }[]): Directory {
  return new Map(
    rows.map((row) => [row.email, { email: row.email, name: row.display_name?.trim() || row.email, active: row.is_active }])
  );
}

export function memberName(directory: Directory, email: string) {
  return directory.get(email)?.name ?? email;
}

export type ConversationSummary = {
  id: string;
  kind: "direct" | "group";
  title: string | null;
  participants: { email: string; leftAt: string | null }[];
};

// Direct: the other person's name. Group: its title.
export function conversationTitle(conversation: ConversationSummary, me: string, directory: Directory) {
  if (conversation.kind === "group") return conversation.title ?? "Group";
  const other = conversation.participants.find((p) => p.email !== me);
  return other ? memberName(directory, other.email) : "Conversation";
}

export function activeParticipants(conversation: ConversationSummary) {
  return conversation.participants.filter((p) => !p.leftAt);
}

// Mentions are chosen explicitly in the composer (a picker inserts
// "@Name" and records the member). On send, a chosen mention is kept only if
// its "@Name" token is still in the text; nothing is inferred from text alone.
export function mentionToken(name: string) {
  return `@${name}`;
}

export function keptMentions(body: string, selected: { email: string; name: string }[]) {
  const seen = new Set<string>();
  return selected
    .filter((member) => body.includes(mentionToken(member.name)))
    .filter((member) => (seen.has(member.email) ? false : (seen.add(member.email), true)))
    .map((member) => member.email);
}

export type BodySegment = { text: string; mention?: string };

// Splits a message into text and highlighted mentions, using only the
// mentions stored with the message.
export function mentionSegments(body: string, mentions: string[], directory: Directory): BodySegment[] {
  const tokens = mentions
    .map((email) => ({ email, token: mentionToken(memberName(directory, email)) }))
    .sort((a, b) => b.token.length - a.token.length);
  if (tokens.length === 0) return [{ text: body }];
  const segments: BodySegment[] = [];
  let rest = body;
  while (rest.length > 0) {
    let best: { index: number; email: string; token: string } | null = null;
    for (const t of tokens) {
      const index = rest.indexOf(t.token);
      if (index >= 0 && (!best || index < best.index)) best = { index, ...t };
    }
    if (!best) {
      segments.push({ text: rest });
      break;
    }
    if (best.index > 0) segments.push({ text: rest.slice(0, best.index) });
    segments.push({ text: best.token, mention: best.email });
    rest = rest.slice(best.index + best.token.length);
  }
  return segments;
}

// The "@query" being typed just before the caret, if any.
export function activeMentionQuery(text: string, caret: number) {
  const before = text.slice(0, caret);
  const match = before.match(/(?:^|\s)@([^\s@]{0,30})$/);
  return match ? { query: match[1], start: caret - match[1].length - 1 } : null;
}
