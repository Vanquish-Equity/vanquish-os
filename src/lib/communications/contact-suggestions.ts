export type RecipientContact = { name: string; email: string | null };
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
export function recipientFragment(value: string, caret: number) {
  const separators: number[] = [-1];
  let quoted = false, angle = false, escaped = false;
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (escaped) { escaped = false; continue; }
    if (quoted && char === "\\") { escaped = true; continue; }
    if (char === '"') quoted = !quoted;
    if (!quoted && char === "<") angle = true;
    if (!quoted && char === ">") angle = false;
    if (!quoted && !angle && /[,;]/.test(char)) separators.push(i);
  }
  const start = (separators.filter((index) => index < caret).at(-1) ?? -1) + 1;
  const end = separators.find((index) => index >= caret) ?? value.length;
  return { start, end, query: value.slice(start, end).trim() };
}
export function suggestRecipients(contacts: RecipientContact[], value: string, caret: number) {
  const fragment = recipientFragment(value, caret);
  const query = normalize(fragment.query);
  if (!query) return [];
  const other = normalize(value.slice(0, fragment.start) + "," + value.slice(fragment.end));
  const seen = new Set<string>();
  return contacts.filter((contact) => {
    const email = contact.email?.trim().toLowerCase();
    if (!email || seen.has(email) || query === email || other.split(/[,;]/).some((token) => token.trim() === email || token.includes(`<${email}>`))) return false;
    if (!normalize(`${contact.name} ${email}`).includes(query)) return false;
    seen.add(email);
    return true;
  }).slice(0, 8);
}
export function insertRecipient(value: string, caret: number, email: string) {
  const { start, end } = recipientFragment(value, caret);
  const prefix = value.slice(0, start);
  const inserted = `${prefix}${prefix ? " " : ""}${email.trim()}`;
  const suffix = value.slice(end);
  return { value: inserted + (suffix || ", "), caret: inserted.length + (suffix ? 0 : 2) };
}
